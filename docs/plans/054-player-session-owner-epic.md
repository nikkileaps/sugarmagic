# Plan 054 — Player Session owner (epic)

Status: proposed
Owner: nikki + claude
Related: Plan 047 (SugarProfile), Plan 051 (runtime handoff), [[stale-closure-react-state-in-effects]]

## Problem

We have all the ingredients of a player session — `UserIdentityProvider`, `GameSaveStore` (now `SerializedSaveStore`), `UserProfileStore`, the `ProviderBindings` pair held by `WebRuntimeHost.state.activeProviders` — but no single owner with a lifecycle that other code (or plugins) can hook into. Lifecycle ops are scattered: sign-out, account deletion, New Game reset, anon-to-cloud migration each live at their own callsite, gluing identity + save by hand. Three symptoms:

1. The recent New Game bug (sessions on 2026-06-28 / 06-29) gated on a **stale closure** in `App.tsx:onStartNewGame` reading React state that had captured `null` at effect-run time. The destructive op silently skipped, the save survived every click, the player came back to the saved position. Diagnosed at length; fixed by reading `host.state.activeProviders.getSnapshot()`. The same shape can appear at any future destructive callsite that glues identity + save by hand.
2. `freshStart.ts` exists as a small target-web helper because no other module owns the cross-reload handshake. It's pragmatic but not the right home — `sessionStorage` flag + reload is a *session-lifecycle* concern, not a save-store concern.
3. Plugins beyond SugarProfile can't hook into lifecycle events. If a future plugin (e.g. SugarInventory) wants to react to "user just signed out, dump my IndexedDB cache" or "user just clicked New Game, also reset my plugin-local state", it has to subscribe to `identityProvider.onChange` and infer from user diffs. There's no `onSessionReset`, no `onSignedIn`, no `onAccountDeleted`.

The existing plugin contract — three independent contribution kinds (`identity.provider`, `save.store`, `profile.store`) — gives us the atomic ingredients. What's missing is the *aggregator*: the thing that says "these three plus the lifecycle ops together are the player's session, here are the events, here's how a plugin participates."

## What this is, what it isn't

**This is:**
- A target-side owner (`PlayerSession`) that aggregates the bindings + provides lifecycle ops as methods + emits lifecycle events.
- A new plugin contribution kind, `playerSession.participant`, that lets plugins observe the lifecycle. Participants don't replace identity/save providers; they piggyback on the existing resolved pair.
- A migration of `App.tsx`, `preview.tsx`, `useUserContext`, and `freshStart.ts` to go through the session.

**This isn't:**
- A replacement for `identity.provider` / `save.store` / `profile.store`. Those stay as the contribution kinds plugins use to provide BACKING. SugarProfile changes nothing.
- A new in-runtime concept. The runtime (three.js canvas, ECS world) doesn't change; it still reads `userId` and `savedGame` during `host.start`. The session is the *target-side* glue around the runtime.
- A general-purpose event bus. The lifecycle events are a small fixed enum; plugins that need anything outside that subscribe to the relevant individual contracts directly.

## Shape

### Lifecycle (enum)

```
type PlayerSessionLifecycleEvent =
  | { kind: "ready"; bindings: ProviderBindings; user: User }
  | { kind: "signedIn"; bindings: ProviderBindings; user: User; prevUser: User }
  | { kind: "signedOut"; bindings: ProviderBindings; user: User }     // user is the new (anon) user
  | { kind: "resetForNewGame"; bindings: ProviderBindings; user: User }
  | { kind: "deletedAccount"; bindings: ProviderBindings }
```

`ready` fires once after providers resolve. `signedIn`/`signedOut` fire on identity transitions. `resetForNewGame` fires AFTER the save store's `resetForNewGame` returns (i.e. the freeze has landed) and BEFORE the reload — so a participant can do its own clear synchronously. `deletedAccount` fires after the row in `auth.users` is deleted (SugarProfile-specific, fired by the SugarProfile-contributed flow).

### PlayerSession interface (target-web)

```
interface PlayerSession {
  readonly state: ObservableValue<PlayerSessionSnapshot | null>;
  // Snapshot is { bindings, user, phase: "booting" | "ready" }

  signIn(input: SignInInput): Promise<User>;
  signOut(): Promise<void>;
  startNewGame(): Promise<void>;       // calls saveStore.resetForNewGame -> emits resetForNewGame -> reloads
  deleteAccount(): Promise<void>;      // sugarprofile-gated; throws if not supported

  on(event: PlayerSessionLifecycleEvent["kind"], listener): Unsubscribe;
  // OR: subscribe(listener) where listener receives any event
}
```

Constructed by the target (target-web). Internally owns the `freshStart.ts` machinery (`sessionStorage` key, `consumeFreshStartFlag` at module load, the post-reset `window.location.reload`). `App.tsx` and `preview.tsx` build a `PlayerSession` instance, hand it to `host.start({ onStartNewGame: () => session.startNewGame() })`, and pass it down via `UserContext` for React UI.

### New plugin contribution: `playerSession.participant`

```
type PlayerSessionParticipantContribution = {
  kind: "playerSession.participant";
  payload: {
    participantId: string;
    onEvent(event: PlayerSessionLifecycleEvent): void | Promise<void>;
  };
};
```

The session, after constructing itself from the resolved providers, fetches all `playerSession.participant` contributions from the plugin manager and registers them. On each lifecycle event the session awaits every participant's `onEvent` (with a Promise.all + bounded timeout) so the event "completes" only after every participant has had a chance to react. Failures log and continue — one participant can't poison the others.

This is how a future SugarInventory or SugarQuestProgress plugin attaches state to the session lifecycle without each one re-inventing identity subscription + save subscription + reset coordination.

## Story breakdown

**054.1 — PlayerSession interface + target-web implementation**

Land the `PlayerSession` class in `targets/web/src/session/`. Subsumes `freshStart.ts`. Constructor takes the resolved `ProviderBindings` (the host's existing output), exposes `state` (observable), `signIn`/`signOut`/`startNewGame`/`deleteAccount`, and an `on(...)` subscription surface. No plugin participation yet — `playerSession.participant` contributions are read but not yet fired (story 054.3).

**054.2 — Migrate App.tsx and preview.tsx**

Both build a `PlayerSession` at boot. The session is what `useUserContext` exposes (the React context wraps `session.state`). `host.start({ onStartNewGame: () => session.startNewGame() })`. SugarProfile UI (`SignedInBadge`, `LoginModal`) reads from the session instead of from the bindings directly. `freshStart.ts` deleted.

**054.3 — `playerSession.participant` contribution kind**

Add the new kind to `RuntimePluginContributionKind`. Session fetches participants from the plugin manager during construction, dispatches events to them. Add a vitest covering: participant receives `ready`, `signedIn`, `signedOut`, `resetForNewGame`; failures isolate per-participant.

**054.4 — SugarProfile participant (proof of contract)**

SugarProfile contributes a `playerSession.participant` that owns the anon-to-cloud migration (currently called manually from App.tsx) and the `deleteAccount` flow (currently a one-off UI handler). Now those happen through the session lifecycle, not bespoke.

## Open questions for follow-up

- **Does the runtime need to know about the session?** Today the runtime takes `currentUser` + `savedGame` at `host.start` and that's it. If we want the runtime to react to mid-session sign-in/out (instead of forcing a reload), the host needs a session subscription. Probably yes long-term but out of scope here — sign-in currently triggers a migration which reloads anyway.
- **Should `playerSession.participant` events be cancellable?** E.g. a participant blocks New Game because there's an unsaved edit. Probably not v1; participants are observers, not approvers. If we want approval flow later, add `playerSession.gate` as a separate contribution kind.
- **Server-side participants?** No — the session is target-side. Server hooks (e.g. "user deleted their account on the Supabase side") flow through `identityProvider.onChange` into the session, which then fires the local event.

## Deferred

Until 054 lands, the cross-cutting fix from session ba573c7e (the SerializedSaveStore wrapper + the closure fix in App.tsx) holds. `freshStart.ts` stays as a target-local helper. Do NOT add new destructive callsites that glue identity + save by hand — wait for the session.
