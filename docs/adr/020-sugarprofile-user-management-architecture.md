# ADR 020: SugarProfile User Management Architecture

## Status

Accepted.

## Context

[Plan 047](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
introduced sugarmagic's user-management surface — identity (who is
playing) plus cross-plugin save state (where they are) — as a
first-party plugin (SugarProfile) layered on contracts defined in
runtime-core. The decisions below are the architectural rules the
implementation settled on across §47.1–§47.10.5. They are not
aspirational; they are the rules new contributors and future
agents should read before adding a competing identity provider,
extending the save record, or changing how per-user state is
keyed.

## Decision

### Two core contracts; everything else is a plugin

`UserIdentityProvider` (who is playing) and `GameSaveStore` (where
they are) are the two runtime-core contracts every other piece of
the user-management story builds on. They live in
`packages/runtime-core/src/identity/` and
`packages/runtime-core/src/save/` respectively. Both come with a
sensible default — `AnonymousLocalIdentityProvider` (UUID in
`localStorage`) and `IndexedDBGameSaveStore` — so a bare
sugarmagic game runs end-to-end with no plugin installed. A
plugin (today: SugarProfile + Supabase; tomorrow: anyone) can
override one or both via the runtime contribution kinds
`identity.provider` and `save.store`, resolved at boot by
`resolveActiveIdentityProvider` / `resolveActiveGameSaveStore`.

### One plugin contributes identity + save store together

SugarProfile is a single plugin that ships both a Supabase-backed
identity provider and a Supabase-backed save store, sharing one
`SupabaseClient` instance across them. This avoids the two-clients
problem (separate auth state, separate refresh loops, racy token
state on outgoing requests). Future provider plugins (Auth0,
Firebase, custom) follow the same shape: one plugin, both
contributions, one shared client.

### User-related data lives in SugarProfile; plugin-domain data stays with the plugin, keyed on `userId`

Per the boundary rule in Plan 047 §"What is NOT in scope":
SugarProfile owns identity, the cross-plugin `GameSavePayload`
(region / position / tracked quest), and per-user profile fields
(display_name, locale, preferences). Anything that's plugin-domain
state (sugaragent's conversation memory, sugarlang's learner
blackboard) lives with that plugin in its OWN store, keyed on the
`userId` the active `UserIdentityProvider` hands out. This keeps
the runtime-core save record small and stable, and lets plugins
evolve their domain state independently.

### Anonymous-first by default; sign-in is an upgrade

Default flow: a brand-new player gets a stable anonymous identity
on first boot — either an anonymous-local UUID (no plugin) or
Supabase's `signInAnonymously` (SugarProfile + `allowAnonymous:
true`). They can play and accumulate save state without ever
seeing a login modal. When they choose to sign in,
`linkAnonymousToCredentials` (Supabase's `updateUser` with email +
password) preserves the underlying `userId`, so all per-user
state — both runtime-core's `GameSave` and every plugin's domain
store — survives the upgrade. The `userId === userId` guard in
`migrateLocalSaveToCloud` enforces this at the transition point:
a save migration only fires when the upgrade preserved the id.

### Supabase + RLS as the v1 backend

SugarProfile ships against Supabase. The `public.saves` and
`public.profiles` tables use row-level security policies keyed on
`auth.uid() = user_id`; every read / write goes through RLS so a
broken client can't accidentally cross-write another user's
state. The `handle_new_user` trigger on `auth.users` INSERT
auto-creates a `profiles` row for every credentialed user (idempotent
via `on conflict (user_id) do nothing`). Schema lives in
`deployment/supabase/migrations/0001_initial.sql`; the Studio
"Apply Migration" host action runs `supabase db push --db-url`
against the project's direct-postgres connection string.

### Gateway authenticates per-user JWTs via JWKS, not a shared secret

When SugarProfile is enabled, the Cloud Run gateway's auth mode
upgrades from `bearer` (shared HS256 token from Plan 045) to
`supabase-jwt`. The gateway emits an async `verifySupabaseJwt(req)`
function inline in `server.mjs` that:

1. Fetches the project's JWKS from
   `<supabaseUrl>/auth/v1/.well-known/jwks.json` (cached 10 min).
2. Looks up the JWT's `kid` in the JWKS.
3. Verifies the signature — ES256 (default on Supabase's new
   asymmetric signing-keys system) or HS256 (legacy projects).
4. Asserts `aud === "authenticated"`, `exp > now`, `sub` non-empty.
5. Attaches `req.user = { userId, email }` for downstream routes.

No shared HS256 secret to manage; new tokens pick up signing-key
rotations automatically via JWKS.

### Gateway-routed clients send per-request session tokens

`SugarAgentGatewayLLMClient` (and siblings) take a
`getBearerToken: () => Promise<string | null>` getter rather than
a static token. The factory chooses the getter by gateway mode:
in `bearer` mode it returns a static closure over the build-time
baked token (45.5.8 unchanged); in `supabase-jwt` mode it delegates
to `getActiveAccessToken` from runtime-core's access-token
registry, which the runtime host populates with the active
`UserIdentityProvider` after resolution. Every fetch reads the
latest token, so supabase-js's background refresh lands on the
wire transparently.

### Boot order is deterministic: providers settle before save loads, save loads before region picks

Plan 047 §47.10's boot-ordering follow-up moved plugin bootstrap
to the top of `WebRuntimeHost.start`. `host.start` is now async;
it (1) creates the plugin manager and resolves the active identity
+ save providers (firing `onProvidersResolved`), (2) awaits a
caller-supplied `savedGamePromise` (caller waits for the active
provider's user to settle via `waitForActiveUser`, then loads the
save from the active store keyed on the credentialed userId), and
(3) only then resolves the spawn region + spawns the player. So a
signed-in returning player reads their cloud save, not a stale
anonymous-local fallback save. The caller's loading overlay
covers the gap.

### `GameSavePayload` lives in domain, not runtime-core

§47.10.5 moved `GameSavePayload` from runtime-core to
`@sugarmagic/domain/save` because `GameProject.defaultGameSavePayload`
(the authored fresh-start record a "New Game" button respawns to)
references it. Runtime-core re-exports the type for back-compat,
so every existing import path keeps working unchanged. The cross-
plugin save record's shape (currentRegionId, currentQuestId,
playerPosition) is purely game-authoring data; placing it in
domain reflects that.

### Save-aware menus via declarative UINode visibility

§47.10.5 added `UINode.visibility: "always" | "hasSave" | "noSave"`,
evaluated at render time against `RuntimeUIState.savePresent`. The
host seeds `savePresent` from the boot save, flips it true on
autosave write (`notifyAutosaveWritten`), and flips it false on
the New Game reset path. GameUILayer skips nodes whose visibility
rule doesn't match — so a "Continue" button tagged
`visibility: "hasSave"` auto-shows when a save lands and auto-
hides when one's cleared. Authors don't write per-game JavaScript
for this; the rule is declarative on the menu definition.

## Consequences

### Easier

- Writing a competing identity provider is "implement the
  `UserIdentityProvider` interface + contribute it via runtime
  contribution kinds." No bespoke wiring to runtime-core.
- Plugin-domain state migrations across sign-in stay tractable:
  every plugin keys on the same `userId`; SugarProfile
  guarantees that id is preserved across the anonymous-to-
  credentialed upgrade.
- Adding fields to the save record is a single change in
  domain's `GameSavePayload`. Both runtime-core's store contract
  and the authored `defaultGameSavePayload` field pick it up.

### Harder

- Anything that wants to know about the cross-plugin save record
  has to live with the nullable-everywhere shape. A fresh-save
  player's payload is `{currentRegionId: null, currentQuestId:
  null, playerPosition: null}`; consumers must handle the null
  case. Trade-off is intentional — a non-nullable shape would
  force a bunch of "we don't have a value yet" sentinels.
- The "save lives where the active store is" model means
  switching providers mid-session (anonymous → SugarProfile) needs
  the `migrateLocalSaveToCloud` carry-over step. We currently only
  migrate on the userId-preserving link path; a non-linking sign-
  in to a different account silently orphans the anonymous save.
  Accepted; the alternative ("merge two users' saves" UX) is
  worse.

### Open / deferred

- **Boot phases as a first-class store.** The current
  `onProvidersResolved` callback + `savedGamePromise` deferred
  pattern works but is one-shot and race-prone (caught and
  documented in [Plan 051](/docs/plans/051-runtime-handoff-load-order-architecture.md)).
  Replacing it with a snapshot+subscribe store would generalize.
- **In-place "New Game" reset.** Today's reset clears the save +
  reloads the page. Plan 051's boot-phase store could enable a
  no-reload reset (teleport player to default spawn, hide menu,
  done). Deferred.
- **Multi-provider arbitration.** Today there's exactly one
  `identity.provider` contribution at a time. If two plugins
  ever contribute one each, `resolveActiveIdentityProvider`
  picks the highest priority but logs a warning. A future
  arbitration UX would let the user pick.

## References

- [Plan 047: SugarProfile User Management Plugin Epic](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
- [Plan 051: Runtime Handoff Load-Order Architecture](/docs/plans/051-runtime-handoff-load-order-architecture.md)
- [ADR 005: Persistence Strata](/docs/adr/005-persistence-strata.md)
- [ADR 017: SugarDeploy Cloud Run Architecture](/docs/adr/017-sugardeploy-cloud-run-architecture.md)
