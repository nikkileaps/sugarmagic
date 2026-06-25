# Plan 047: SugarProfile — User Management Plugin (Identity + Saves via Supabase)

**Status:** Proposed
**Date:** 2026-06-25

> Builds on [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
> (Cloud Run gateway) and [Plan 046](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
> (publish productmode + per-game plugin config + gateway runtime
> config contract). Plan 047 was previously scoped to "identity-
> provider plugin model" only; this rewrite broadens it into the
> full user-management + save-state epic and settles on Supabase
> as the backing service so we ship one concrete plugin end-to-end
> rather than a multi-provider abstraction nobody's asked for.
> The pluggable-multi-provider angle returns as a follow-up epic
> when a second provider materializes.

## Epic

### Title

SugarProfile: user identity + game saves as a plugin.

### Goal

- **A sugarmagic game runs without SugarProfile** and still saves
  progress: the player gets an anonymous local UUID stored in
  `localStorage`, the save lives in IndexedDB, and the same shape
  works in a `file://`-hosted bundle. Mirrors the "Package
  workspace works for client-only games" promise from Plan 046.

- **Installing SugarProfile swaps the implementations in place.**
  No game-side code change is required. The game keeps calling
  `useCurrentUser()` and `useGameSave()`; the plugin slot decides
  whether the call hits IndexedDB or Supabase. Same architectural
  shape as the gateway plugin contract (game code talks to the
  abstract proxy URL; the plugin decides what's behind it).

- **A single SugarProfile plugin covers identity + saves.** Splitting
  auth from storage was considered and rejected for now (see
  Resolved Decisions). Supabase Auth + Supabase Postgres are bundled
  in the same project; splitting would mean two plugins to install
  for one user-management story. If a future need to mix Auth0 +
  S3 (or similar) materializes, the contracts already allow it —
  Plan 047 lands two contracts, one plugin.

- **Per-user save data is row-locked.** Supabase Row-Level Security
  policies guarantee a user can only `select` / `update` / `delete`
  their own save row. Service-role calls (gateway-side admin) bypass
  RLS deliberately. No game-author code touches a service-role key
  directly; the gateway is the only consumer.

- **SugarProfile owns user-account data; other plugins own their
  own per-user state.** SugarProfile's `GameSaveStore` holds the
  cross-plugin player record: identity, current region, player
  position, current quest. Plugin-domain state (sugarlang learner
  blackboard, sugaragent conversation memory) lives in whichever
  store the plugin chooses, keyed by the `userId` it reads from
  `UserIdentityProvider`. Rule of thumb: if it's user-related,
  it probably belongs *in* SugarProfile to begin with; if it's
  plugin-domain data that happens to be per-user, the plugin owns
  it and just keys on userId. No central save aggregation, no
  piggyback slot in `payload`, no validator coupling two plugins'
  data shapes through a shared envelope.

- **Gateway routes are SugarProfile-authenticated when the plugin
  is enabled.** The Plan 046 `gatewayBearerToken` shared-token path
  stays the default; SugarProfile contributes a gateway-side JWT
  validation middleware that supersedes the shared token when the
  plugin is enabled. Per-user gateway calls (SugarAgent
  generation / retrieval, future SugarProfile save/load endpoints
  if any) attach the user's Supabase JWT instead of the shared
  token.

### Context

Wordlark deploys end-to-end as of Plan 046, with the Cloud Run
gateway authenticated by a shared bearer token. That's adequate
for "verifiable deploy" but inadequate for "actual game" because:

1. **No persistence story.** A player closing the browser loses
   everything. The current `targets/web/src/App.tsx` boots into a
   fresh game state on every page load.
2. **No identity story.** Every gateway call is anonymous from the
   user's perspective; from the game's perspective every play
   session is a stranger. There's no way to address "this player"
   from any analytics or per-user gateway logic the gateway might
   want.
3. **No upgrade path.** Even if we crammed `localStorage`-based
   persistence in by hand, there's no way for a player to keep
   their progress when they switch devices.

Unity and Unreal both ship a core save abstraction with optional
cloud sync layered on top. Unity Player Prefs / Save System for
local; Unity Authentication SDK + Cloud Save SDK as separate
optional packages. Unreal SaveGame for local; Online Subsystem
(Steam / EOS / Null) as a swappable module. The shape is:

- Game code calls an abstract "save my state" / "who's the player"
  interface.
- A default local-only implementation ships with the engine.
- A plugin swaps in cloud-backed implementations when a developer
  wants persistence across devices.

Plan 047 ports that shape to sugarmagic, anchored by what's already
in place: plugin contracts on `InstalledPluginDefinition`, validators
at discovery time, gateway runtime config plumbing, schema-rendered
settings panels. SugarProfile is the second hosted-deploy plugin
(after SugarDeploy) and the first one to write to a database.

### What is NOT in scope

- **Multiple identity providers.** Plan 047 ships Supabase and only
  Supabase. The contracts allow a future Auth0 / Firebase / custom
  plugin, but landing more than one provider this epic would split
  effort and ship neither well.
- **Multiplayer / shared state / leaderboards / friends.** Single-
  player save/load only. Multi-user social features are a separate
  epic and intentionally outside this one.
- **Multiple save slots / save points.** One save per user, written
  continuously as the player progresses. No "Save Slot 1 / 2 / 3"
  UI. If a need for slots ever surfaces, the `GameSave` shape can
  add a `slotId` field; the v1 contract just doesn't.
- **Achievement system / unlock tracking.** Achievements / badges
  are a related but distinct concern. The save payload carries
  whatever the game-side code wants to track; SugarProfile doesn't
  ship achievements.
- **Server-side save mutation.** The gateway doesn't read or write
  saves directly. SugarProfile's browser client owns save reads +
  writes via the Supabase JS SDK with the user's JWT; the gateway
  remains the LLM proxy it is today.
- **Replacing the shared-token gateway auth for SugarAgent.** Plan
  047 contributes a JWT validation middleware that the gateway runs
  when SugarProfile is enabled; whether SugarAgent's
  `gatewayBearerToken` path stays as a fallback or is removed is
  scoped as a story-level decision, not an epic-level rewrite.
- **Centralized save aggregation across plugins.** Each plugin with
  per-user state owns its own store, keyed by `userId` from
  `UserIdentityProvider`. Sugarlang's learner blackboard, SugarAgent's
  conversation memory — both will eventually grow their own backends
  (Sugarlang's spaced-repetition service, SugarAgent's vector-memory
  service). Trying to aggregate that state into SugarProfile's
  `GameSave` payload up-front creates two sources of truth the
  moment those services land. SugarProfile holds user-account data
  only; everything else stays where it's produced.

## Deliverables

### Core contracts (Studio + runtime-core)

- `packages/runtime-core/src/identity/index.ts` — defines
  `UserIdentityProvider` interface and `User` shape. `User` carries
  `{ userId, displayName: string | null, isAnonymous: boolean,
  email: string | null, createdAt: string }`. The interface:
  `currentUser(): User | null`, `onChange(listener): unsubscribe`,
  `signIn(...): Promise<User>`, `signOut(): Promise<void>`,
  `linkAnonymousToCredentials(...): Promise<User>`.
- `packages/runtime-core/src/save/index.ts` — defines
  `GameSaveStore` interface and `GameSave` shape. `GameSave` is
  `{ userId, lastPlayed, schemaVersion, payload }` where `payload`
  is the cross-plugin player record (current region id, player
  position, current quest state, etc. — owned by Studio core /
  runtime-core, not by individual plugins). The interface:
  `load(userId): Promise<GameSave | null>`,
  `save(userId, save: GameSave): Promise<void>`,
  `clear(userId): Promise<void>`. Plugin-domain per-user state
  (sugarlang learner blackboard, sugaragent conversation memory)
  does NOT live in this payload; see the "What is NOT in scope"
  section above.
- **Default `AnonymousLocalIdentityProvider`** — generates a UUIDv4
  on first call, persists to `localStorage` under key
  `sugarmagic.anonymous-user-id`. `signIn` / `signOut` /
  `linkAnonymousToCredentials` throw `NotSupported` so the game
  surfaces the no-cloud-installed state if it tries to show a
  login UI.
- **Default `IndexedDBGameSaveStore`** — single IndexedDB database
  `sugarmagic-saves`, object store `saves` keyed by `userId`. No
  schema migrations beyond the `GameSave.schemaVersion` field for
  per-record forward-compat.

### SugarProfile plugin

- `packages/plugins/src/catalog/sugarprofile/manifest.ts` —
  plugin definition with manifest, defaultConfig, the new
  `pluginSettingsSchema` (Supabase URL + anon key + JWT secret + a
  toggle for "allow anonymous"), `gatewayRuntimeConfigKeys` (the
  Supabase URL + anon key as non-secret env), and
  `deploymentRequirements` (the SUPABASE service-role key as a
  secret).
- `packages/plugins/src/catalog/sugarprofile/runtime/identity.ts` —
  `SupabaseIdentityProvider` implementing `UserIdentityProvider`
  against `@supabase/supabase-js`. Wraps anonymous sign-in,
  email/password sign-up + sign-in, `linkIdentity` for the
  anonymous-to-real upgrade, and the auth-state-change listener.
- `packages/plugins/src/catalog/sugarprofile/runtime/save-store.ts`
  — `SupabaseGameSaveStore` implementing `GameSaveStore` via the
  Postgres table + RLS described below.
- `packages/plugins/src/catalog/sugarprofile/runtime/gateway-jwt-middleware.ts`
  — gateway-side Express-style middleware that validates the
  `Authorization: Bearer <jwt>` header against Supabase's JWT
  secret (HS256 verification, audience check, exp check). Replaces
  the shared-token middleware when SugarProfile is enabled.
- `packages/plugins/src/catalog/sugarprofile/host/middleware.ts` —
  host endpoints for Studio: `/__sugarprofile/probe-supabase`
  (checks the user's URL + anon key are reachable),
  `/__sugarprofile/run-migration` (applies the game-save table +
  RLS policies via the Supabase service-role key — see migration
  block below).

### Supabase schema (generated migration)

The plugin emits a single `deployment/supabase/migrations/0001_game_save.sql`
managed file:

```sql
create table if not exists public.game_save (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_played timestamptz not null default now(),
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb
);

alter table public.game_save enable row level security;

create policy "users select own save"
  on public.game_save for select
  using (auth.uid() = user_id);

create policy "users insert own save"
  on public.game_save for insert
  with check (auth.uid() = user_id);

create policy "users update own save"
  on public.game_save for update
  using (auth.uid() = user_id);

create policy "users delete own save"
  on public.game_save for delete
  using (auth.uid() = user_id);
```

The migration runs via `supabase db push` from a host endpoint
that the Studio "Apply Supabase Migration" Provision-workspace
button calls; the service-role key is supplied through the
existing Plan 045 Set Value modal.

### Studio surface

- SugarProfile contributes a Design-productmode workspace, auto-
  mounted via the Plan 046 schema-rendered panel mechanism. Schema
  exposes the four config keys above. No hand-written settings UI
  needed.
- A new Provision-workspace button under SugarDeploy: "Apply
  SugarProfile Migration" — visible only when SugarProfile is
  enabled. Runs the SQL above against the configured Supabase
  project.

### Published-web surface

- `targets/web/src/App.tsx` reads the active identity provider
  on boot (from a new `useUserIdentityProvider()` hook). When the
  current user is anonymous and SugarProfile is enabled, a corner-
  mounted "Sign In" affordance opens a SugarProfile-contributed
  login modal. When the user signs in, `linkAnonymousToCredentials`
  migrates the local IndexedDB save up to Supabase as the user's
  first cloud save.
- Autosave loop: a `useAutosave(gameState, store, userId)` hook
  debounces writes (500ms) and pushes through whichever store is
  active.

### Tests

- `AnonymousLocalIdentityProvider` round-trip: first call
  generates UUID, second call returns same UUID, clear-and-recall
  generates new UUID.
- `IndexedDBGameSaveStore` round-trip via `fake-indexeddb`.
- `SupabaseIdentityProvider` round-trip against a mocked Supabase
  client (anonymous sign-in, anonymous-to-credentialed upgrade,
  sign-out clears).
- `SupabaseGameSaveStore` happy path + RLS-rejected path
  (different-user JWT) via mocked client.
- Gateway JWT middleware: valid JWT passes, expired JWT rejects,
  signature-mismatch rejects, missing-header rejects with 401.

## Resolved Decisions

- **One plugin, two contracts.** SugarProfile bundles Identity +
  GameSaveStore. Splitting was considered (cleaner contract
  boundaries, future-proof for Auth0+S3) but rejected as
  premature: Supabase covers both halves natively, splitting means
  two plugins to land for one user-management story, and the
  contracts already permit a future swap.
- **Single save per user, not slots.** Continuous autosave model;
  no "Save Slot 1 / 2 / 3" UI. Slot support can land later as a
  `slotId` field on `GameSave` without breaking the v1 contract.
- **Anonymous-by-default with upgrade path.** New players are
  anonymous Supabase users from the moment they open the game;
  signing in with email/password / social merges the anonymous
  account into the credentialed one. No "sign-in wall" gating
  gameplay.
- **`UserIdentityProvider`, not `PlayerIdentityProvider`.** The
  in-game `PlayerDefinition` is the avatar (height, eyeHeight,
  walkSpeed, casterProfile); the human at the keyboard is "User".
  No naming collision.
- **`GameSave`, not `GameState`.** "Save" is the canonical gaming
  term for "the record of who-played-and-where"; reserving "state"
  for the broader runtime concept avoids overload.
- **`GameSaveStore`, not `GameSaveProvider`.** `Provider` is
  reserved for capability surfaces (`ConversationProvider`,
  `UserIdentityProvider`). `Store` is for read/write data stores.
- **Plan 047 ships Supabase only.** Multi-provider abstraction
  returns as a follow-up epic when a second provider needs
  landing. No premature "auth-shape abstraction layer."
- **Row-Level Security is non-negotiable.** Every game-save
  query runs as the authenticated user; service-role calls are
  gateway-only and audited. The migration block above is the
  enforcement.
- **SugarProfile owns user-account data; plugins own their own
  per-user state.** No `saveContributions` piggyback slot, no
  `payload.plugins[<id>]` map. Each plugin reads userId from
  `UserIdentityProvider` and persists into its own store. This
  preserves "one source of truth" the moment a plugin grows its
  own backend service (sugarlang's spaced-repetition store,
  sugaragent's vector memory) — there's never a second copy of
  the same per-user data living in SugarProfile's payload.

## Open Questions

- **Should SugarAgent's per-call bearer token stay as a fallback
  when SugarProfile is enabled?** The cleanest answer is "remove
  it once SugarProfile is enabled" (one auth mode per gateway),
  but that's a story-level decision we'll settle when we wire up
  the JWT middleware (story 47.7).
- **Where does the login UI live — Studio core or a SugarProfile
  contribution?** Probably a SugarProfile-contributed component
  the published-web bundle mounts conditionally. Pinning that
  down in story 47.8.
- **Does the published-web bundle import `@supabase/supabase-js`
  directly, or thread through a SugarProfile-emitted client?**
  Direct import is simpler; a thin wrapper preserves the
  contract-not-vendor boundary for a future provider swap. Lean
  toward thin wrapper, settle in story 47.5.
- **Migration model post-v1.** `GameSave.schemaVersion` exists for
  forward-compat but no migration runner exists yet. When a save
  shape changes, do we ship a per-version migration script in the
  plugin, or a versioned-schema sniffing thing in the load path?
  Out of scope for v1; flagged for follow-up.

## Stories

### 47.1 — Core contracts: `UserIdentityProvider` + `GameSaveStore`

Define the two interfaces and the `User` / `GameSave` shapes in
`packages/runtime-core/`. No implementations yet; just the types
and JSDoc that documents the contract for plugin authors.

**Exit:** the types exist, exported from `@sugarmagic/runtime-core`,
and `packages/testing` imports them in a placeholder test that
asserts the shapes typecheck.

### 47.2 — Default `AnonymousLocalIdentityProvider`

Implements `UserIdentityProvider` against `localStorage`. UUIDv4
on first call; persists. `signIn` / `signOut` /
`linkAnonymousToCredentials` throw `NotSupported`.

**Exit:** unit test: first call creates a UUID, second call
returns the same UUID, clearing storage produces a new UUID on
next call. The published-web boot path uses this provider when no
plugin overrides it.

### 47.3 — Default `IndexedDBGameSaveStore`

Implements `GameSaveStore` against IndexedDB via `idb` (a thin
typed wrapper over the native API). One database, one object
store, keyed by `userId`.

**Exit:** unit test via `fake-indexeddb` covers load-of-empty,
save-then-load, clear-then-load.

### 47.4 — SugarProfile plugin scaffold + manifest

New plugin directory `packages/plugins/src/catalog/sugarprofile/`.
Manifest, defaultConfig, `pluginSettingsSchema` (Supabase URL +
anon key + JWT secret + allow-anonymous toggle),
`gatewayRuntimeConfigKeys` (Supabase URL + anon key as env),
`deploymentRequirements` (service-role key as secret). No runtime
behavior yet — just the plugin shows up in the registry, validates
clean, renders a settings panel via the Plan 046 auto-mount.

**Exit:** SugarProfile appears in Studio's design workspaces,
auto-mounted; bundled plugin definition passes
`validatePluginSettingsSchema`.

### 47.5 — `SupabaseIdentityProvider` browser client

Implements `UserIdentityProvider` against `@supabase/supabase-js`.
Anonymous sign-in on first boot; email/password sign-up + sign-in;
`linkAnonymousToCredentials` for the upgrade path; sign-out clears.

**Exit:** integration test via mocked Supabase client: anonymous
sign-in returns a user; sign-in with credentials succeeds;
linking the anonymous account preserves the user id; sign-out
returns to anonymous on next boot.

### 47.6 — `SupabaseGameSaveStore` + Postgres migration

Implements `GameSaveStore` via Supabase Postgres. Plugin emits
the migration SQL above into
`deployment/supabase/migrations/0001_game_save.sql`. Studio's
Provision workspace gains an "Apply SugarProfile Migration"
button that runs `supabase db push` via a new host endpoint
`/__sugarprofile/run-migration`.

**Exit:** the migration applies successfully against a test
Supabase project; round-trip save-then-load works for an
authenticated user; a different user's JWT cannot read the first
user's save (RLS enforced).

### 47.7 — Gateway-side JWT validation middleware

`SupabaseProfileJwtMiddleware` validates the
`Authorization: Bearer <jwt>` header against the Supabase JWT
secret (HS256, audience, exp). Replaces the shared-token middleware
when SugarProfile is enabled. The gateway scaffold composes this
in via the existing middleware contribution mechanism.

**Exit:** unit tests: valid JWT passes; expired JWT rejects 401;
signature-mismatch JWT rejects 401; missing header rejects 401.
Live wordlark gateway authenticates a real Supabase-signed JWT
end-to-end.

### 47.8 — Published-web: login affordance + autosave loop

`targets/web/src/App.tsx` mounts SugarProfile's login modal
component when SugarProfile is enabled and the current user is
anonymous. `useAutosave(gameState, store, userId)` debounces
writes (500ms) and pushes through the active store. On sign-in,
the anonymous IndexedDB save migrates up to Supabase.

**Exit:** a player can open wordlark, play through a quest beat,
close the tab, reopen, and resume where they left off — both
anonymous-local and signed-in-cloud modes work, and signing in
mid-session preserves progress.

### 47.9 — Documentation pass

ADR 020: SugarProfile user-management architecture (the
contracts, the Supabase-only-for-v1 decision, the RLS contract).
Updates `packages/plugins/src/deployment/README.md` with the
SugarProfile host endpoints and the Supabase migration pattern.
Updates `targets/web/README.md` with the identity + save hooks
the App.tsx boot path consumes. Plan 021 cross-reference banner
extended.

**Exit:** ADR 020 exists and is consistent with Plan 047; the
existing READMEs reflect the new contracts; a future plugin
author can read ADR 020 + the SDK docs and write a competing
identity provider plugin without reading source.

## Builds On

- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure Epic](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
- [Plan 046: SugarDeploy Web Publish Target Epic](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
- [ADR 017: SugarDeploy Cloud Run Architecture](/docs/adr/017-sugardeploy-cloud-run-architecture.md)
- [ADR 018: SugarDeploy Web Publish Target Architecture](/docs/adr/018-sugardeploy-web-publish-target-architecture.md)
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md)

## Followed By

- A pluggable multi-provider follow-up epic (Auth0 / Firebase /
  custom) IF a second provider ever needs landing. Plan 047's
  contracts already permit it; the epic would just be "write a
  second plugin against the existing contracts."
- A multiplayer / social-features epic (leaderboards, friends,
  shared state) builds on the identity provider Plan 047
  establishes.
- A save migrations epic when the first `GameSave.schemaVersion`
  bump needs a real migration path.
