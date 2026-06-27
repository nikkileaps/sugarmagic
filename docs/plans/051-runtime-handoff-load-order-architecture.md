# Plan 051: Runtime Handoff Load-Order Architecture

**Status:** Proposed
**Date:** 2026-06-27

> Surfaced during Plan 047 §47.10 boot-ordering verification.
> When plugin bootstrap moved to the top of `host.start`,
> `onProvidersResolved` started firing **before** Studio Preview's
> React `useEffect` had attached its "change" listener — so the
> overlay missed the only event ever dispatched and silently
> rendered nothing. Took an hour of "no errors, no modal, why" to
> track down. A textbook late-subscriber race. This plan replaces
> the one-shot EventTarget handoff with patterns that make this
> class of bug structurally impossible.

## Epic

### Title

A snapshot-plus-subscribe model for runtime-host handoffs, so any
subscriber — early, late, async, React, non-React — always reads
the correct current state.

### Why this matters

The bug pattern is recurring. Three different `host.start`
side-channels currently use one-shot push notifications:

- `onProvidersResolved(resolved)` — identity / save store handoff
- `savedGamePromise` — caller-supplied save load (47.10
  boot-ordering)
- `notifyAutosaveWritten(snapshot)` — autosave → HUD signal
- (implicit) gateway client construction — closes over a token
  getter that reads a module-level registry

Each is an ad-hoc shape. Adding the next one (region transitions?
camera mode? input mode from Plan 050?) means another bespoke
event + another race risk + another debugging session. We have a
generic "handoff between async boot steps and many subscribers"
problem; we should solve it once.

### Goal

- **No late-subscriber races.** A subscriber attached at any
  point in the host lifetime sees the current state immediately
  AND every subsequent change. No "I missed the only event"
  failure mode.
- **One pattern, applied uniformly.** The same shape works for
  React components, for non-React runtime code (HUD card,
  gateway clients), and for code that only needs to peek at the
  current value (not subscribe).
- **Phase-aware.** Some state is "available after phase X." The
  host advances through phases (loading → plugins-resolved →
  save-loaded → world-ready → running); subscribers can wait on
  a specific phase or read state that's only meaningful from
  that phase onward.
- **Debuggable.** A misfiring subscriber should be diagnosable
  by reading the current store snapshot — not by adding
  diagnostic `console.info` and reasoning about microtask /
  postMessage timing.

## Context

### The pattern we have today

`apps/studio/src/preview.tsx` (and `targets/web/src/App.tsx`)
both use an `EventTarget` + module-level state:

```ts
let resolvedBindings: ProviderBindings | null = null;
const providerEvents = new EventTarget();

function publishResolvedBindings(next: ProviderBindings) {
  resolvedBindings = next;
  providerEvents.dispatchEvent(new Event("change"));
}

// React subscriber:
useEffect(() => {
  const handler = () => setActive(resolvedBindings);
  providerEvents.addEventListener("change", handler);
  return () => providerEvents.removeEventListener("change", handler);
}, []);
```

This is RxJS's `Subject` ([learnrxjs.io][rxjs-subject]) — emits
to *active* subscribers only, no replay. The well-known fix is
`BehaviorSubject`: store the current value, replay it on
subscribe. Subscribers always get the current value at
subscribe time.

[rxjs-subject]: https://www.learnrxjs.io/learn-rxjs/subjects/behaviorsubject

The bug we just hit:

1. PREVIEW_BOOT message arrives → `host.start` runs.
2. Plugin bootstrap runs at the top of `host.start` (Plan 047
   §47.10 boot-ordering) → fires `onProvidersResolved`
   synchronously → `publishResolvedBindings` →
   `dispatchEvent("change")`.
3. PreviewOverlay's `useEffect` HAD NOT YET ATTACHED its "change"
   listener — React commits + queues effects, effects run after
   the current task. In some boot paths (HMR warm-up, fast
   bootstrap), the order flipped.
4. The "change" event fired to zero listeners.
5. The listener attached AFTER the event. Forever waiting for an
   event that already happened. Overlay returns `null`. No
   login modal. Hour of debugging.

Workaround landed (preview.tsx + App.tsx now read `resolvedBindings`
defensively when their effect first attaches), but it's a
band-aid. Every future subscriber would have to remember the
same dance.

### The patterns to adopt

**1. Snapshot + subscribe** ([React's
useSyncExternalStore][react-uses]). Subscribers always read the
current value via `getSnapshot()` at subscribe time, plus a
`subscribe(callback)` for change notifications. No race
possible — the store IS the source of truth, events are derived
from state transitions.

[react-uses]: https://react.dev/reference/react/useSyncExternalStore

```ts
interface ObservableStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
```

**2. Phase-aware lifecycle**. The host advances through known
phases. Subscribers can `await` a specific phase or read state
that's only defined after a phase.

This is VS Code's [activation events][vscode-events] pattern,
generalized: extensions declare WHEN they should activate; the
host fires phases deterministically.

[vscode-events]: https://code.visualstudio.com/api/references/activation-events

```ts
type RuntimeBootPhase =
  | "loading"          // host.start called, nothing resolved yet
  | "plugins-resolved" // active identity + save providers known
  | "save-loaded"      // savedGamePromise resolved
  | "world-ready"      // scene + region + player spawned
  | "running"          // render loop running
  | "disposed";

interface RuntimeBootStore {
  getPhase(): RuntimeBootPhase;
  subscribePhase(listener: (phase: RuntimeBootPhase) => void): () => void;
  whenPhase(phase: RuntimeBootPhase): Promise<void>;
}
```

## Proposed Architecture

### A small `ObservableValue<T>` primitive in runtime-core

```ts
// packages/runtime-core/src/util/observable-value.ts
export interface ObservableValue<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface MutableObservableValue<T> extends ObservableValue<T> {
  set(next: T): void;
}

export function createObservableValue<T>(
  initial: T
): MutableObservableValue<T> { ... }
```

Tiny. Zero deps. Replaces every `EventTarget`-plus-module-let in
the codebase.

### Host exposes named stores

`WebRuntimeHost` gains a `state` field whose shape mirrors the
boot phases. Each entry is an `ObservableValue` the host
mutates as it progresses.

```ts
interface WebRuntimeHost {
  readonly boot: RuntimeBootModel;
  readonly state: {
    phase: ObservableValue<RuntimeBootPhase>;
    activeProviders: ObservableValue<ProviderBindings | null>;
    savedGame: ObservableValue<GameSave | null>;
    user: ObservableValue<User | null>;
    latestAutosave: ObservableValue<SessionHudSavedGameSnapshot | null>;
  };
  start(state: WebRuntimeStartState): Promise<void>;
  dispose(): void;
}
```

Subscribers query and subscribe at any time. The current
`onProvidersResolved` callback, `savedGamePromise`,
`notifyAutosaveWritten` shapes all collapse into "mutate the
right store."

### React subscribers use `useSyncExternalStore`

```ts
const active = useSyncExternalStore(
  host.state.activeProviders.subscribe,
  host.state.activeProviders.getSnapshot
);
```

One line replaces the `useEffect` + `useState` +
`addEventListener` + race-prone catch-up dance. React's hook
already handles the snapshot-at-subscribe semantics correctly.

### Non-React subscribers (HUD, gateway clients) use the same store

The Session HUD card's `getUser` getter currently reads a
module-level `latestUser` mutated by host code. Replace with:

```ts
createSessionHudCard({
  getUser: () => host.state.user.getSnapshot(),
  getSavedGameSnapshot: () => host.state.latestAutosave.getSnapshot()
});
```

Same shape. No more `latestUser = state.currentUser ?? latestUser`
overwrite bug.

The access-token registry (`packages/runtime-core/src/identity/
access-token-registry.ts`) is the same pattern, ad-hoc'd. Move
its state into `host.state.user` and have gateway clients pull
the token via the user's `getAccessToken()`.

### Promise-based phase waits

Callers that need to "wait until plugins resolve, then load
save" use a promise interface instead of a callback:

```ts
async function loadSaveAfterProvidersResolve() {
  await host.state.phase.whenPhase("plugins-resolved");
  const active = host.state.activeProviders.getSnapshot()!;
  const user = await waitForActiveUser(active.identityProvider);
  return active.saveStore.load(user!.userId);
}
```

Cleaner than the current `onProvidersResolved` callback
threading a deferred `savedGamePromise`.

## Migration sketch

Not a one-shot rewrite. Land the primitive first, migrate
boot-critical handoffs, leave the rest to incremental clean-up.

### Phase 1: introduce `ObservableValue<T>` + `host.state` skeleton

- Add the primitive in `packages/runtime-core/src/util/`.
- Add `host.state.{phase, activeProviders, savedGame, user,
  latestAutosave}` to `WebRuntimeHost`.
- Host mutates them at the existing transition points.
- Keep the legacy `onProvidersResolved` + `notifyAutosaveWritten`
  callbacks firing in parallel for back-compat.

### Phase 2: migrate Studio Preview + App.tsx subscribers

- Replace `EventTarget`-based `resolvedBindings` with
  `useSyncExternalStore(host.state.activeProviders.{subscribe,
  getSnapshot})`.
- Drop the catch-up branch in preview.tsx / App.tsx.
- Drop the module-level `resolvedBindings` + `providerEvents`.

### Phase 3: migrate Session HUD card + access-token registry

- HUD card reads from `host.state.user` + `host.state.latestAutosave`.
- Delete the `registerActiveIdentityProvider` module-level
  registry; gateway clients read the token via
  `host.state.user.getSnapshot()?.getAccessToken?.()`.

### Phase 4: remove deprecated callbacks

- Delete `onProvidersResolved` from `WebRuntimeStartState`.
- Delete `notifyAutosaveWritten` from `WebRuntimeHost`.
- Delete `savedGamePromise` field (replaced by phase wait).

## Open Questions

- **Where does `ObservableValue<T>` live?** runtime-core is the
  cleanest home (everything depends on it), but it's a generic
  utility. ADR-able decision.
- **Do we need fine-grained selectors?** For now, each store is
  a single value, equality-checked via `Object.is` per React's
  contract. If we later need selector-based subscriptions
  (`subscribe to user.email only`) we can layer on top.
- **Boot phase enum stability.** `running` and `disposed` are
  obvious; the middle phases will firm up as more handoffs
  migrate. Adding a phase is a versioned change — any subscriber
  doing `.whenPhase("save-loaded")` would silently never resolve
  if we renamed the phase.
- **Does `host.state.user` belong on the host or on the
  identity provider?** The provider already exposes `currentUser`
  + `onChange`. Maybe `host.state.user` just proxies the active
  provider's user instead of mirroring it. Reduces the "two
  sources of truth" bug class.
- **React-server-rendering.** `useSyncExternalStore`'s
  `getServerSnapshot` parameter — do we need it? Probably not for
  target-web (CSR only), but worth noting.

## Builds On

- [Plan 047 §47.10 boot-ordering](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
  — the late-subscriber race that motivated this work surfaced
  here.
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md) — "one
  source of truth" applies directly: every piece of resolved
  runtime state should have exactly one observable store; React
  state, HUD cards, and gateway clients all read from the same
  snapshot.

## Followed By

- Plan 050 (input mode / action map system) — the input router
  benefits from the same pattern; the active mode is an
  `ObservableValue<RuntimeMode>` that the input router and any
  HUD overlay can subscribe to.

## References

- [useSyncExternalStore — React docs][react-uses]
- [BehaviorSubject — Learn RxJS][rxjs-bs]
- [Subject vs BehaviorSubject vs ReplaySubject — Learn RxJS][rxjs-subject]
- [Activation Events — VS Code Extension API][vscode-events]

[rxjs-bs]: https://www.learnrxjs.io/learn-rxjs/subjects/behaviorsubject
