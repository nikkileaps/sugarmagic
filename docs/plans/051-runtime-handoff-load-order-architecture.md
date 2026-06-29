# Plan 051: Runtime Handoff Load-Order Architecture

**Status:** Proposed
**Date:** 2026-06-27 (scoped down 2026-06-29)

> Surfaced during Plan 047 §47.10 boot-ordering verification.
> When plugin bootstrap moved to the top of `host.start`,
> `onProvidersResolved` started firing **before** Studio Preview's
> React `useEffect` had attached its "change" listener — so the
> overlay missed the only event ever dispatched and silently
> rendered nothing. Took an hour of "no errors, no modal, why" to
> track down. A textbook late-subscriber race. This plan replaces
> the one-shot EventTarget handoff with a snapshot+subscribe
> pattern that makes this class of bug structurally impossible.

## Epic

### Title

A snapshot-plus-subscribe model for runtime-host handoffs, so
any subscriber — early, late, async, React, non-React — always
reads the correct current state.

### Why this matters

The bug pattern is recurring. Two concrete incidents in the
last sprint:

- **47.10 late-subscriber race**: hour of "no errors, no modal,
  why" debugging because Studio Preview's React effect attached
  AFTER `onProvidersResolved` fired. Band-aided by reading
  `resolvedBindings` defensively when the effect first attached;
  every future subscriber would have to remember the same
  dance.
- **47.10 `latestUser = state.currentUser ?? latestUser`
  overwrite bug**: Session HUD's module-level `latestUser`
  state got clobbered by a stale value during sign-in; only
  caught because nikki noticed the "Anon: yes" badge while
  signed in.

Same root cause both times: ad-hoc state mirroring with
push-only events + module-level "last known value." AGENTS.md
"single enforcer" says state should have ONE observable home.

The handoffs DOING this DIY today:

- `onProvidersResolved(resolved)` (identity + save store)
- `savedGamePromise` (save load)
- `notifyAutosaveWritten(snapshot)` (HUD signal)
- the access-token registry module-level state

Four shapes for one problem. Solve it once.

### Goal

- **No late-subscriber races.** A subscriber attached at any
  point in the host lifetime sees the current state immediately
  AND every subsequent change. "I missed the only event" stops
  being a failure mode.
- **One pattern across React + non-React.** React subscribers
  use `useSyncExternalStore` (purpose-built for this). Non-
  React subscribers (HUD card getters, gateway clients) read
  `getSnapshot()` directly. Both see the same canonical store.
- **Debuggable.** A misfiring subscriber is diagnosable by
  inspecting the current snapshot — no more
  `console.info("about to dispatch")` + microtask timing
  reasoning.

### Context

`apps/studio/src/preview.tsx` and `targets/web/src/App.tsx`
both use an `EventTarget` + module-level state today:

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

This is RxJS's `Subject` shape — emits to *active* subscribers
only, no replay. The well-known fix is `BehaviorSubject`:
store the current value, replay it on subscribe. React's
`useSyncExternalStore` ([docs][react-uses]) implements that
contract directly.

[react-uses]: https://react.dev/reference/react/useSyncExternalStore

### What is NOT in scope

(Permanent exclusions, not deferrals. Truly out of scope; see
`Deferred` below for items we're postponing-with-trigger.)

- **Replacing the existing input-modes registry** (Plan 050).
  Its `subscribe to UIStateStore` mechanism already works on
  the snapshot pattern (it reads `stateStore.getState()`
  synchronously on each keydown, no subscribe-time race
  possible). Leave it alone.
- **A general dependency-injection / IoC container.** This
  plan adds ONE primitive + a handful of named stores on the
  host. Not a framework.

### Resolved Decisions

- **`ObservableValue<T>` shape is `{getSnapshot, subscribe}`**,
  matching React's `useSyncExternalStore` contract verbatim.
  Subscribers receive a notifier (`() => void`), not the
  value — they call `getSnapshot()` to pull. Same shape as
  React's hook needs; same shape Zustand / Jotai / every modern
  store uses.
- **Single value per store**, equality-checked via `Object.is`
  per React's contract. No selectors in the API.
- **Host owns the stores**, plugins / UI / gateway clients
  read them. Plugins do NOT mutate `host.state.*`; only the
  host transitions phases / publishes provider bindings / etc.

### Open Questions (that block the MVP)

- **Where does `ObservableValue<T>` live?** `packages/
  runtime-core/src/util/` is the cleanest home — generic
  utility, used by everything downstream. Resolution: yes,
  put it there.
- **Does `host.state.user` mirror the active provider's user,
  or proxy it?** The provider's `currentUser` + `onChange` is
  already authoritative. Resolution: `host.state.user` proxies
  the active provider via subscription — no parallel mirror.
  Cuts the entire `latestUser = state.currentUser ?? latestUser`
  bug class structurally.

## Stories

### 51.1 — `ObservableValue<T>` primitive

**Files (create):**

- `packages/runtime-core/src/util/observable-value.ts`:
  - `ObservableValue<T>` interface with `getSnapshot()` and
    `subscribe(listener)` returning an unsubscribe fn.
  - `MutableObservableValue<T>` extends with `set(next)`.
  - `createObservableValue<T>(initial: T): MutableObservableValue<T>`.
  - Equality-checked via `Object.is` — subscribers don't fire
    on no-op `set` calls. React's contract requires stable
    snapshots; this gives it directly.
  - **Add an in-file comment at the top of the file pointing
    back to the `Deferred` section of this plan** for anyone
    considering adding selector-based subscription OR
    fine-grained value diffing.

**Tests:** pure-function unit tests:
- initial getSnapshot returns the initial value
- set + getSnapshot reflects the new value
- subscribe fires on set
- subscribe does NOT fire on a set whose `Object.is`-equal
- unsubscribe stops firing
- multiple subscribers all fire

**Exit:** the primitive exists with passing tests; no
consumers yet.

### 51.2 — Migrate Studio Preview's module-scoped EventTarget handoff

**Why only preview, not App.tsx (sharpened during 51.2 design):**
the actual late-subscriber race lives in `preview.tsx` because
its host is constructed at MODULE scope, before any React
component mounts. `App.tsx`'s host is COMPONENT-scoped (created
inside `useEffect`) — its `useState` + `setActive(resolved)` in
the `onProvidersResolved` callback is already race-free because
the callback fires inside the same effect that owns the host.
We add `host.state.activeProviders` for ALL consumers; App.tsx
keeps its existing `useState` mirror (downstream React
subscriber), but the host store is still authoritative for the
non-React reads in 51.3.

**Files (modify):**

- `targets/web/src/runtimeHost.ts` — add
  `host.state.activeProviders: ObservableValue<ProviderBindings | null>`
  and mutate it at the existing `onProvidersResolved` callback
  site (callback continues to fire in parallel for back-compat
  during this story; retires per `Deferred` trigger).
- `apps/studio/src/preview.tsx`:
  - Replace `EventTarget`-based `providerEvents` +
    `resolvedBindings` module-level state with
    `useSyncExternalStore(host.state.activeProviders.subscribe,
    host.state.activeProviders.getSnapshot)`.
  - Drop the catch-up defensive read on first effect attach
    (the 47.10 band-aid).
- `targets/web/src/App.tsx`: NOT migrated. Its `useState`
  pattern stays — locally race-free. The new host store is
  populated for downstream non-React consumers (51.3) to read.

**Tests:**
- Manual: open Studio Preview from a cold start, verify the
  login modal appears (no missed-event silent failure).
- The original race condition is structurally impossible now
  in preview.tsx; no automated test required (the abstraction
  IS the test).

**Exit:** preview.tsx uses `useSyncExternalStore`; the
defensive catch-up read deletes; module-level
`resolvedBindings` + `providerEvents` delete; preview boots
cleanly with the login modal appearing reliably.

### 51.3 — Migrate non-React module-level state

**Files (modify):**

- `targets/web/src/runtimeHost.ts` — add
  `host.state.user: ObservableValue<User | null>` and
  `host.state.latestAutosave: ObservableValue<SessionHudSavedGameSnapshot | null>`.
  The user store proxies the active provider's `currentUser` +
  `onChange` (per Resolved Decisions — no parallel mirror).
- `packages/runtime-core/src/identity/session-hud-card.ts`:
  - Replace `getUser: () => latestUser` with
    `getUser: () => host.state.user.getSnapshot()`.
  - Replace `getSavedGameSnapshot: () => latestSavedGameSnapshot`
    with `getSavedGameSnapshot: () => host.state.latestAutosave.getSnapshot()`.
  - Delete the module-level `latestUser` /
    `latestSavedGameSnapshot` lets and any
    `latestUser = state.currentUser ?? latestUser`-style
    overwrite logic. (That's the structural fix for the second
    47.10 incident.)
- `packages/runtime-core/src/identity/access-token-registry.ts`:
  - Replace the module-level token getter registry with a
    `host.state.user.getSnapshot()?.getAccessToken?.()` read at
    call time.
  - Delete the `registerActiveIdentityProvider` function and
    its module-level state.

**Tests:**
- Verify Session HUD's "Anon: <yes|no>" badge stays correct
  through sign-in / sign-out / sign-in transitions (the
  scenario that surfaced the 47.10 overwrite bug).
- Verify gateway calls authenticate correctly after a sign-in
  mid-session (the access-token registry replacement).

**Exit:** no module-level "last-known-X" state in runtime-core's
identity / HUD modules; everything reads from `host.state.*`.

## Deferred

(Per the `deferred-scope-triggers` memory rule: each item has
a concrete trigger condition. The natural revisit points in
code carry comments pointing back to this section.)

- **Boot-phase enum + `whenPhase` Promise API.** The full plan
  proposed `host.state.phase` as an `ObservableValue<RuntimeBootPhase>`
  with `whenPhase("save-loaded")`-style awaits. Cut because no
  current handoff demands it — `savedGamePromise` works for
  the one "wait for save load" handoff. **Revisit when**:
  - A second handoff needs to wait for a specific boot phase
    that `savedGamePromise` can't express, OR
  - Three or more deferred-Promise patterns crop up in the
    host (e.g. `regionLoadPromise`, `audioReadyPromise`,
    `pluginsLoadedPromise`) — at that point the ad-hoc shape
    is duplication, generalize into phases.
- **Fine-grained selectors on a store** (`subscribe to
  user.email only`). Cut because each `host.state.*` store
  currently holds a single primitive-ish value. **Revisit
  when**:
  - A single store grows to a structurally complex object AND
  - Multiple subscribers need only a sub-property AND
  - We observe re-render performance issues that would benefit
    from selector-based diffing.
- **"Remove deprecated callbacks" as its own dedicated cleanup
  story.** The legacy `onProvidersResolved`, `savedGamePromise`,
  and `notifyAutosaveWritten` may stick around in parallel
  with the new stores for a bit. Cut because we can retire
  each callback naturally as its last call site migrates.
  **Revisit when**: any of these three callbacks still has
  live callers two PRs after 51.3 lands — at that point, do a
  one-PR sweep to delete them rather than letting them rot.

## Builds On

- [Plan 047 §47.10 boot-ordering](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
  — the late-subscriber race + the `latestUser` overwrite both
  surfaced here.
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md) — "one
  source of truth" applies directly: every piece of resolved
  runtime state should have exactly one observable store; React,
  HUD cards, and gateway clients all read from the same
  snapshot.

## References

- [useSyncExternalStore — React docs](https://react.dev/reference/react/useSyncExternalStore)
- [BehaviorSubject — Learn RxJS](https://www.learnrxjs.io/learn-rxjs/subjects/behaviorsubject)
- [Subject vs BehaviorSubject — Learn RxJS](https://www.learnrxjs.io/learn-rxjs/subjects/behaviorsubject)
