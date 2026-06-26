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

Story dependency shape: `47.1 -> {47.2, 47.3, 47.4}`;
`{47.3, 47.4} -> 47.5 -> 47.5.5`; `47.1 -> 47.6`;
`47.6 -> 47.7 -> 47.7.5 -> 47.8 -> 47.9`;
`{47.7.5, 47.8, 47.9} -> 47.10 -> 47.10.5`; everything -> `47.11`.
Stories with no shared inputs can land in parallel.

### 47.1 — Core contracts in `runtime-core`

Land the two interfaces + their data shapes as the public contract.
No implementations yet.

**Files (new):**

- `packages/runtime-core/src/identity/index.ts`
  ```ts
  export interface User {
    userId: string;             // stable across sign-ins for the same human
    displayName: string | null;
    email: string | null;
    isAnonymous: boolean;
    createdAt: string;          // ISO timestamp
  }
  export type UserIdentityChangeListener = (user: User | null) => void;
  export interface SignInWithPasswordInput { email: string; password: string; }
  export interface UserIdentityProvider {
    currentUser(): User | null;
    onChange(listener: UserIdentityChangeListener): () => void;
    signIn(input: SignInWithPasswordInput): Promise<User>;
    signUp(input: SignInWithPasswordInput): Promise<User>;
    signOut(): Promise<void>;
    /** Merge the anonymous current user into the given credentials.
     *  Preserves userId; sets isAnonymous=false. Throws if currentUser
     *  is null or already credentialed. */
    linkAnonymousToCredentials(input: SignInWithPasswordInput): Promise<User>;
  }
  ```
- `packages/runtime-core/src/save/index.ts`
  ```ts
  export const GAME_SAVE_SCHEMA_VERSION = 1;
  export interface GameSavePayload {
    // Cross-plugin player record. Owned by runtime-core/Studio core.
    // Per-plugin per-user state lives in the plugin's own store,
    // keyed on userId from UserIdentityProvider (see ADR 020).
    currentRegionId: string | null;
    currentQuestId: string | null;
    playerPosition: { x: number; y: number; z: number } | null;
  }
  export interface GameSave {
    userId: string;
    lastPlayed: string;          // ISO timestamp
    schemaVersion: number;       // pinned to GAME_SAVE_SCHEMA_VERSION on write
    payload: GameSavePayload;
  }
  export interface GameSaveStore {
    load(userId: string): Promise<GameSave | null>;
    save(userId: string, save: GameSave): Promise<void>;
    clear(userId: string): Promise<void>;
  }
  ```
- Re-export both from `packages/runtime-core/src/index.ts`.

**Tests:** add `packages/testing/src/user-management.test.ts` with
typecheck-only assertions that the shapes import cleanly + a few
runtime sanity checks on `GAME_SAVE_SCHEMA_VERSION` being a positive
integer.

**Dependencies:** none.

**Exit:** types compile, `pnpm vitest run --root packages/testing
src/user-management.test.ts` passes, `import { UserIdentityProvider,
GameSaveStore } from "@sugarmagic/runtime-core"` resolves.

### 47.2 — Runtime contribution kinds + boot-time resolver

Add `identity.provider` + `save.store` contribution kinds to
`RuntimePluginContributionKind`. Plugins contribute via the existing
`RuntimePluginInstance.contributions` slot — same mechanism as
`conversation.provider`. The boot path picks the highest-priority
contribution; falls through to defaults when none are contributed.

**Files (modify):**

- `packages/runtime-core/src/plugins/index.ts`
  - Add `"identity.provider"` and `"save.store"` to
    `RuntimePluginContributionKind`.
  - Add `IdentityProviderContribution` + `GameSaveStoreContribution`
    types (mirror `ConversationProviderContribution`'s shape;
    payload carries `{ provider }` / `{ store }`).
  - Add to the `RuntimePluginContribution` union.
- `packages/runtime-core/src/plugins/index.ts` (new exports):
  ```ts
  export function resolveActiveIdentityProvider(
    manager: RuntimePluginManager,
    fallback: UserIdentityProvider
  ): UserIdentityProvider {
    const contribs = manager.getContributions("identity.provider");
    if (contribs.length === 0) return fallback;
    return contribs
      .slice()
      .sort((a, b) => b.priority - a.priority)[0].payload.provider;
  }
  // Same shape for resolveActiveGameSaveStore.
  ```
  Log a warn (not throw) when multiple plugins contribute; the
  highest-priority one wins to keep boot non-fatal.

**Tests:** `packages/testing/src/user-management.test.ts` gains
- Default fallback when no contribution.
- Single contribution wins.
- Highest-priority wins when two contribute.

**Dependencies:** 47.1.

**Exit:** new contribution kinds compile + are reachable from
`manager.getContributions("identity.provider")`. Resolver returns
fallback when no contributing plugin is present.

### 47.3 — Default `AnonymousLocalIdentityProvider` in `runtime-core`

The "no plugin installed" identity path. Pure browser-side: reads
+ writes `localStorage`, generates UUIDv4 on first call.

**Files (new):**

- `packages/runtime-core/src/identity/anonymous-local.ts`
  ```ts
  const STORAGE_KEY = "sugarmagic.anonymous-user-id";
  export interface AnonymousLocalIdentityProviderOptions {
    storage?: Storage;    // injectable for tests
    nowIso?: () => string;
    randomUuid?: () => string;
  }
  export function createAnonymousLocalIdentityProvider(
    options?: AnonymousLocalIdentityProviderOptions
  ): UserIdentityProvider { ... }
  ```
- `signIn` / `signUp` / `linkAnonymousToCredentials` throw a
  `NotSupportedError` with message naming SugarProfile as the path
  to credentialed auth.
- `signOut` is a no-op (resolves immediately) since there's no
  session to clear.
- `onChange` returns an unsubscribe stub (the anonymous user never
  changes during the page life).
- Re-export from `packages/runtime-core/src/index.ts`.

**Tests:** unit tests use a fake `Storage` adapter.
- First `currentUser()` generates + persists a uuid; second returns
  the same uuid.
- Clearing storage between calls produces a new uuid.
- `signIn` throws `NotSupportedError` with helpful message.
- `signOut` is a no-op.

**Dependencies:** 47.1.

**Exit:** unit tests pass; importable from
`@sugarmagic/runtime-core`.

### 47.4 — Default `IndexedDBGameSaveStore` in `runtime-core`

The "no plugin installed" save path. One IndexedDB database,
one object store, keyed by `userId`. Uses the `idb` package (add to
`packages/runtime-core/package.json`).

**Files (new):**

- `packages/runtime-core/src/save/indexeddb-store.ts`
  ```ts
  const DB_NAME = "sugarmagic-saves";
  const STORE_NAME = "saves";
  const DB_VERSION = 1;
  export interface IndexedDBGameSaveStoreOptions {
    indexedDB?: IDBFactory;   // injectable for tests
  }
  export function createIndexedDBGameSaveStore(
    options?: IndexedDBGameSaveStoreOptions
  ): GameSaveStore { ... }
  ```
- `load(userId)` opens the DB lazily on first call and caches the
  promise. Returns `null` when the record doesn't exist.
- `save(userId, save)` writes `GameSave`, stamps `lastPlayed` at
  write time, asserts `save.userId === userId`.
- `clear(userId)` deletes the record.
- Re-export from `packages/runtime-core/src/index.ts`.

**Tests:** `fake-indexeddb` (add to testing devDeps).
- `load` of missing user returns `null`.
- `save` then `load` round-trips.
- `save` rewrites the existing record (no duplicate rows).
- `clear` removes the record; subsequent `load` returns `null`.
- Records for different `userId`s don't collide.

**Dependencies:** 47.1.

**Exit:** unit tests pass; importable from
`@sugarmagic/runtime-core`.

### 47.5 — Boot-path wiring in `targets/web` + Studio preview

Wire the defaults into the published-web bundle + Studio preview
session so a bare game without SugarProfile saves to IndexedDB.

**Files (modify):**

- `targets/web/src/App.tsx`
  - Construct the default identity + save store at boot.
  - Resolve the active provider/store via the resolver from 47.2.
  - Add a `UserContext` React context exposing `{ user, provider,
    saveStore }` to the runtime tree.
  - Block initial render on `provider.currentUser()` settling + an
    initial `saveStore.load(user.userId)` so the runtime sees the
    persisted state.
- `targets/web/src/runtimeHost.ts`
  - Accept `{ identityProvider, saveStore }` in the boot args.
  - On boot, if `saveStore.load()` returns a `GameSave`, hydrate
    the runtime world from `payload.currentRegionId / playerPosition /
    currentQuestId`. Otherwise hydrate from `boot.json`'s authored
    defaults.
- `apps/studio/src/...` Studio preview session
  - Inject the same defaults so a Playtest session uses
    IndexedDB-backed saves (lets the developer test save behaviors
    in Studio without deploying).

**Files (new):**

- `targets/web/src/identity/useUserContext.ts` — the React hook.

**Tests:**

- `packages/testing/src/target-web-build-config.test.ts` extended
  to assert the App.tsx boot path imports + uses the runtime-core
  defaults (string-match on the bundled output).

**Dependencies:** 47.3, 47.4 (the defaults must exist).

**Exit:** open wordlark in Studio's Playtest mode; move the player
to a new region; close + reopen the Playtest session; the player
spawns in the saved region. Same behavior in the deployed
published-web bundle without any plugins installed.

### 47.5.5 — Session HUD card during playtest

QA / dev-tooling story landed alongside the boot-path wiring so the
read path from 47.5 (and the write path from 47.10) is observable
without devtools spelunking. A `debug.hudCard` contribution
rendered into Studio Playtest only (filtered via
`hostKinds: ["studio"]` — the existing mechanism keeps it out of
the published-web bundle). Updates per tick from the live runtime
so the author can watch `playerPosition` change as they walk
around. Card body:

```
SESSION
user        ab12cd34...  (anon)
region      hollow-station
position    12.50, 0.00, -8.25
save        present (lastPlayed 12:04:31)
```

The complementary "Session" dev-actions panel (current user view,
current save view, Seed Save / Clear Save / Regenerate Anonymous
User buttons) lives inside SugarProfile's workspace and lands in
47.6. SugarProfile is the natural home for user-management dev
actions; gating those actions on a story that ships SugarProfile
keeps the architectural boundary clean.

**Files (new):**

- `packages/runtime-core/src/identity/session-hud-card.ts`
  - `createSessionHudCard(args: { user, savedGameSnapshot }):
    DebugHudCardContribution` factory.
  - `user` is the resolved `User` at boot (anonymous-local or
    Supabase). `savedGameSnapshot` is null when no save was
    loaded, or `{ lastPlayed, currentRegionId, currentQuestId }`.
  - Card render builds the DOM; updateCard refreshes the live
    `playerPosition` from `DebugHudCardContext.gameplaySession`
    (which already exposes the player's position component every
    tick).
  - `hostKinds: ["studio"]` so the card never appears in
    published-web.

**Files (modify):**

- `targets/web/src/runtimeHost.ts`
  - Add `currentUser?: User | null` field to
    `WebRuntimeStartState` (same shape as the `savedGame` field
    from 47.5).
  - When `hostKind === "studio"`, append a session card built via
    `createSessionHudCard` to the pluginCards list passed into
    `createRuntimeDebugHud`.
- `targets/web/src/App.tsx` — pass `currentUser: identity.user`
  in the host.start call (alongside the existing `savedGame`).
- `apps/studio/src/preview.ts` — same: pass the resolved user
  through the start state.

**Tests:**

- `createSessionHudCard` factory builds a DOM container with the
  expected user row (truncated userId, "anon" / "user" label).
- Save-present + save-null branches render the right strings.
- `updateCard` updates the position row when given a fresh
  `DebugHudCardContext.gameplaySession.playerPosition`.
- `hostKinds` is `["studio"]` so the card is filtered out in a
  published-web bundle.

**Dependencies:** 47.5 (the boot-path wiring is the substrate this
story makes inspectable).

**Exit:** open wordlark in Studio's Playtest mode. Toggle the
debug HUD (F3 / Backquote). A "Session" tab appears alongside
Renderer / World. Selecting it shows the current userId
(truncated), anonymous flag, region id, save presence + last-
played, and a live-updating position row that changes as the
player walks. Building wordlark for published-web and serving it
locally shows NO Session tab (the card is studio-only).

### 47.6 — SugarProfile plugin scaffold

New plugin in `packages/plugins/src/catalog/sugarprofile/`.
Manifest + defaultConfig + schemas + deployment requirements.
No identity/save behavior yet; story 47.7/47.8 fill those in.

**Files (new):**

- `packages/plugins/src/catalog/sugarprofile/index.ts`
  - `SUGARPROFILE_PLUGIN_ID = "sugarprofile"`.
  - `pluginDefinition: DiscoveredPluginDefinition` with:
    - `manifest: { pluginId: "sugarprofile", displayName: "SugarProfile",
      summary: "User identity + game saves via Supabase",
      capabilityIds: ["identity.provider", "save.store"] }`.
    - `defaultConfig: { supabaseUrl: "", supabaseAnonKey: "",
      allowAnonymous: true }`.
    - `pluginSettingsSchema`: four fields (supabaseUrl + supabaseAnonKey
      as text, allowAnonymous as boolean, group "Supabase Project").
    - `gatewayRuntimeConfigKeys`:
      - `{ configKey: "supabaseUrl", envVarName:
        "SUGARMAGIC_SUGARPROFILE_SUPABASE_URL",
        nonSecretAttestation: "safe-to-expose-publicly" }`.
      - `{ configKey: "supabaseAnonKey", envVarName:
        "SUGARMAGIC_SUGARPROFILE_SUPABASE_ANON_KEY",
        nonSecretAttestation: "safe-to-expose-publicly" }`.
    - `deploymentRequirements`:
      - `{ kind: "secret", secretKey: "supabase-service-role-key",
        mappingHint: "SUGARMAGIC_SUPABASE_SERVICE_ROLE_KEY",
        consumption: "server-only", exposure: "private" }`.
      - `{ kind: "secret", secretKey: "supabase-jwt-secret",
        mappingHint: "SUGARMAGIC_SUPABASE_JWT_SECRET",
        consumption: "server-only", exposure: "private" }`.
- `packages/plugins/src/index.ts` exports the new plugin id +
  re-exports the definition through the discovery system the same
  way `SUGARAGENT_PLUGIN_ID` is exported today.
- `packages/plugins/package.json` adds `@supabase/supabase-js`
  + `jsonwebtoken` (server-only) as runtime deps.
- `apps/studio/src/plugins/catalog/sugarprofile/index.tsx` —
  hand-written Studio workspace that wraps the auto-mounted
  schema panel (the Supabase config fields) PLUS the **Session
  Inspector** dev-actions panel from 47.5.5 (Surface B):
  - **Current user** — userId, isAnonymous, displayName, email,
    createdAt. "Refresh" button re-reads via the resolved
    identity provider.
  - **Current save** — when a save exists: lastPlayed,
    currentRegionId, currentQuestId, playerPosition. When null:
    "No save yet for this user." "Refresh" button re-reads.
  - **Dev actions** — three buttons:
    - **Seed Save** opens a modal: region picker (populated from
      the project's `regions`), playerPosition x/y/z inputs,
      optional currentQuestId. On submit, writes a `GameSave` to
      the active save store for the current user.
    - **Clear Save** confirms + calls `saveStore.clear(userId)`.
    - **Regenerate Anonymous User** confirms + deletes the
      `localStorage` entry under `sugarmagic.anonymous-user-id`,
      re-constructs the provider, refreshes the user view.
      Anonymous-local only — disabled when a credentialed
      provider is active (SugarProfile signed in).
  - Reads the active identity provider + save store via the same
    defaults the boot path uses (or whichever provider/store
    SugarProfile contributes once 47.7/47.8 land).

The hand-written Studio file is the Plan 046 override mechanism:
its presence supersedes the auto-mounted schema panel, so the
custom workspace controls all rendering for SugarProfile's tab.

**Tests:** `packages/testing/src/plugin-infrastructure.test.ts`
gains:
- SugarProfile is in `listDiscoveredPluginDefinitions()`.
- Schema + runtime-config keys pass `validatePluginSettingsSchema`.
- Studio's manual catalog entry for SugarProfile supersedes the
  auto-mount (the schema-only mount is suppressed when the
  override file exists).
- Session Inspector dev actions trigger the right store calls
  (mock the save store, assert `save` / `clear` are called with
  the right args).

**Dependencies:** 47.5.5 (the HUD card establishes the
"session inspection" shape this dev panel mirrors statically).

**Exit:** SugarProfile shows up as a Design workspace in Studio.
The workspace renders the schema-rendered Supabase config fields
PLUS the Session Inspector dev panel. Clicking Seed Save with a
real region id + position writes to IndexedDB; opening Playtest
spawns the player in the seeded region/position. Bundled plugin
passes existing validators. No Supabase runtime behavior wired
yet (lands in 47.7+).

### 47.7 — `SupabaseIdentityProvider`

Implements `UserIdentityProvider` against `@supabase/supabase-js`.
Contributed via the plugin's runtime instance as an
`identity.provider` contribution. Resolves the active provider at
boot via the resolver from 47.2.

**Files (new):**

- `packages/plugins/src/catalog/sugarprofile/runtime/identity.ts`
  ```ts
  export interface SupabaseIdentityProviderOptions {
    supabaseUrl: string;
    supabaseAnonKey: string;
    allowAnonymous: boolean;
    client?: SupabaseClient;     // injectable for tests
  }
  export function createSupabaseIdentityProvider(
    options: SupabaseIdentityProviderOptions
  ): UserIdentityProvider { ... }
  ```
- On first call to `currentUser()`, if no session and
  `allowAnonymous`, call `supabase.auth.signInAnonymously()`
  and cache the user.
- `signIn` -> `supabase.auth.signInWithPassword`.
- `signUp` -> `supabase.auth.signUp`.
- `signOut` -> `supabase.auth.signOut`.
- `linkAnonymousToCredentials` -> `supabase.auth.updateUser({ email,
  password })` followed by `supabase.auth.refreshSession()`. Preserves
  userId, flips isAnonymous to false.
- `onChange` -> subscribes to `supabase.auth.onAuthStateChange`,
  normalizes the Supabase user into the local `User` shape.

**Files (modify):**

- `packages/plugins/src/catalog/sugarprofile/index.ts`
  - Add a `runtime: { createRuntimePlugin }` factory that constructs
    the provider from the per-game config + contributes it as an
    `identity.provider` contribution with `priority: 100`.

**Tests:**

- Mocked Supabase client passes through `signInAnonymously` ->
  returns a user with `isAnonymous: true`.
- `signIn` with credentials returns a user with `isAnonymous: false`.
- `linkAnonymousToCredentials` preserves `userId`.
- `onChange` fires when the mock emits an `AUTH_STATE_CHANGE`.

**Dependencies:** 47.1, 47.2, 47.6.

**Exit:** mocked-client unit tests pass. The SugarProfile runtime
factory contributes the `identity.provider` when both URL + anon
key are non-empty in the per-game config; the runtime plugin
manager exposes the contribution via `getContributions(
"identity.provider")`. No boot-path wiring yet — App.tsx still
uses the anonymous-local default. The end-to-end "deployed bundle
uses the Supabase user" flow lands in 47.7.5.

### 47.7.5 — Login UI + boot wiring + Netlify deploy verification

Closes the auth loop end-to-end so a deployed game has real
sign-up / sign-in / sign-out flows before any save-store work
starts. After this story lands you can deploy wordlark to
Netlify, sign up a test user via the Login modal, sign in, see
the game start screen, click New Game, and be in the world. The
save store (47.8) and autosave (47.10) come after; this story is
just "auth + identity work end-to-end."

**Surface A: resolver-driven boot path.**
`targets/web/src/App.tsx` and `apps/studio/src/preview.ts` stop
hardcoding the anonymous-local provider. Instead:

1. Construct the anonymous-local + IndexedDB defaults as the
   *fallback*.
2. Pass the fallbacks into the host.
3. The host's `start` path resolves the active provider via
   `resolveActiveIdentityProvider(manager, fallbackProvider)`
   from 47.2 AFTER the plugin manager finishes init, and uses
   whichever provider wins for downstream consumers (HUD card,
   UserContext, save load).
4. Initial render blocks on `provider.currentUser()` settling.
   Supabase's async bootstrap (getSession + signInAnonymously)
   takes a tick or two; App.tsx renders a "Signing in..." overlay
   until `currentUser` returns non-null OR `onChange` fires.

**Surface B: Login modal contributed by SugarProfile.**
A SugarProfile-owned React component, imported by App.tsx via a
lazy dynamic import (so non-SugarProfile bundles never pull it
in). Rendered when:

- SugarProfile is enabled AND
- `allowAnonymous: false` AND no current user, OR
- The user clicks an explicit "Sign In" affordance (corner button)
  while signed in anonymously, to upgrade.

Modal contents:
- Tab: Sign In (email + password + Sign In button).
- Tab: Sign Up (email + password + Confirm password + Sign Up
  button; Supabase email confirmation flow per project settings).
- Anonymous-to-credentialed link path: when the user is currently
  anonymous and signs in via email/password, call
  `linkAnonymousToCredentials` instead of `signIn` so the
  underlying userId is preserved.
- Errors surface inline (Supabase auth errors are user-actionable:
  "Invalid login credentials", "User already registered", etc.).

**Surface C: Sign-out affordance.**
A small "Signed in as <email>" pill in the corner with a Sign Out
button when the user is credentialed. Calls `provider.signOut()`,
then either re-renders the Login modal (when allowAnonymous=false)
or transitions back to a fresh anonymous user (when allowAnonymous
is on).

**Files (new):**

- `packages/plugins/src/catalog/sugarprofile/ui/LoginModal.tsx`
  - Mantine-styled email/password form with Sign In / Sign Up
    tabs. Imports the runtime's resolved identity provider via a
    prop; the modal itself is presentational.
  - Exports `LoginModal({ provider, onClose, mode? })`.
- `packages/plugins/src/catalog/sugarprofile/ui/SignedInBadge.tsx`
  - "Signed in as <email> [Sign Out]" pill component.
- `targets/web/src/identity/useResolvedIdentity.ts` (or wherever
  fits) — React hook that:
  - Returns `{ provider, user, isLoading, signedIn }`.
  - Subscribes to `provider.onChange` so React re-renders on auth
    state flips.
- A Studio E2E recipe doc — quick walkthrough of "configure
  SugarProfile, redeploy, sign up + sign in" so future-you (or me)
  doesn't have to re-derive it.

**Files (modify):**

- `targets/web/src/App.tsx`
  - Resolver-driven boot: construct fallback, pass into host,
    pull active provider from host after start.
  - "Signing in..." overlay during async bootstrap.
  - Mount LoginModal when SugarProfile is enabled + sign-in is
    required.
  - Mount SignedInBadge corner pill when user is credentialed.
- `apps/studio/src/preview.ts` — same resolver wiring.
- `targets/web/src/runtimeHost.ts` — host's `start` accepts the
  fallback providers, resolves active via 47.2's helpers AFTER
  plugin init, uses the resolved provider for the Session HUD
  card's `currentUser` + UserContext propagation.

**Tests:**

- Unit: `useResolvedIdentity` returns the fallback when no plugin
  contributes; the contributing provider when one is present.
- Unit: LoginModal's Sign In tab calls `provider.signIn` with the
  form input; Sign Up tab calls `provider.signUp`; errors render.
- Integration (mocked Supabase client): user enters credentials,
  clicks Sign In, modal closes, currentUser flips to credentialed.

**Dependencies:** 47.5 (boot path scaffold), 47.6 (SugarProfile
scaffold), 47.7 (SupabaseIdentityProvider).

**Exit:** deploy wordlark to Netlify with a real Supabase project
configured in SugarProfile's settings. Open the deployed URL.
With `allowAnonymous: false`, the LoginModal renders on first
load. Sign up a test user (Supabase dashboard shows the new auth
entry). Sign in. Game start menu renders, "Signed in as
<email>" pill shows in the corner. Click New Game; you're in
the world (the existing menu wiring still works because no save
load is involved). Sign Out returns to the LoginModal.

### 47.8 — SupabaseGameSaveStore + profiles + Postgres migration

Implements `GameSaveStore` against Supabase Postgres AND lands the
SugarProfile-owned `public.profiles` table (per-user authored data
keyed on `auth.users.id`). Per the architectural boundary settled
in 47.5, profiles is SugarProfile's domain — plugins that need
per-user data (Sugarlang's support `locale`, future audio
preferences, etc.) read it through SugarProfile's runtime API
rather than owning their own per-user tables. One initial
migration creates both tables + their RLS policies + an
auto-create trigger on `auth.users` insert so a profile row
always exists for every authenticated user.

Plugin emits the migration SQL into a managed file; Studio's
Provision workspace gets an "Apply SugarProfile Migration"
button.

**SQL emitted as `0001_initial.sql`:**

```sql
-- game_save (cross-plugin player state)
create table public.game_save (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_played timestamptz not null default now(),
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb
);
alter table public.game_save enable row level security;
create policy "users select own save" on public.game_save for select using (auth.uid() = user_id);
create policy "users insert own save" on public.game_save for insert with check (auth.uid() = user_id);
create policy "users update own save" on public.game_save for update using (auth.uid() = user_id);
create policy "users delete own save" on public.game_save for delete using (auth.uid() = user_id);

-- profiles (per-user authored data)
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'en',           -- BCP 47 (e.g. 'en-US', 'es-MX')
  preferences jsonb not null default '{}'::jsonb,  -- plugin-extension catch-all
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "users select own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = user_id);

-- Auto-create a profile row for every new auth user
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Files (new):**

- `packages/plugins/src/catalog/sugarprofile/runtime/save-store.ts`
  ```ts
  export interface SupabaseGameSaveStoreOptions {
    client: SupabaseClient;   // authenticated client (user JWT)
  }
  export function createSupabaseGameSaveStore(
    options: SupabaseGameSaveStoreOptions
  ): GameSaveStore { ... }
  ```
  - `load(userId)` -> `client.from("game_save").select("*").eq("user_id",
    userId).maybeSingle()`. Asserts the returned `user_id` matches
    (RLS should make this a no-op but cheap).
  - `save(userId, save)` -> `client.from("game_save").upsert({ user_id:
    userId, last_played: now, schema_version: GAME_SAVE_SCHEMA_VERSION,
    payload: save.payload })`.
  - `clear(userId)` -> `client.from("game_save").delete().eq("user_id",
    userId)`.
- `packages/plugins/src/catalog/sugarprofile/runtime/profile-store.ts`
  ```ts
  export interface SupabaseProfileStoreOptions {
    client: SupabaseClient;   // authenticated client (user JWT)
  }
  export interface UserProfile {
    userId: string;
    displayName: string | null;
    locale: string;
    preferences: Record<string, unknown>;
    updatedAt: string;
  }
  export interface UserProfileStore {
    load(userId: string): Promise<UserProfile | null>;
    update(userId: string, patch: Partial<Pick<UserProfile,
      "displayName" | "locale" | "preferences">>): Promise<UserProfile>;
    /** Convenience for nested preferences. Merges into the
     *  preferences jsonb without overwriting siblings. */
    setPreference(userId: string, key: string, value: unknown): Promise<void>;
  }
  export function createSupabaseProfileStore(
    options: SupabaseProfileStoreOptions
  ): UserProfileStore { ... }
  ```
- `packages/plugins/src/catalog/sugarprofile/migrations/0001_initial.sql`
  - Carries the SQL from the "Supabase schema" deliverables block
    above (game_save + profiles + handle_new_user trigger).
  - File is plugin-emitted into the game project as
    `deployment/supabase/migrations/0001_initial.sql` via the
    managed-files mechanism (mirror Plan 046's
    `buildNetlifyManagedFiles` pattern in a new
    `buildSupabaseManagedFiles`).
- `packages/plugins/src/catalog/sugarprofile/host/middleware.ts`
  - `POST /__sugarprofile/run-migration` host endpoint. Reads
    `workingDirectory`, shells out `supabase db push --workdir
    deployment/supabase`. Service-role key supplied via the
    existing Plan 045 Set Value modal -> env -> child-process
    env.
  - `POST /__sugarprofile/probe-supabase` host endpoint. Validates
    the configured URL + anon key reach a real Supabase project
    (a `select 1` round-trip).

**Files (modify):**

- `packages/plugins/src/catalog/sugarprofile/index.ts`
  - Adds the runtime contribution: `save.store` carrying the
    `SupabaseGameSaveStore`.
  - Contributes the `UserProfileStore` via a new runtime hook (or
    extends `UserIdentityProvider` to expose `getProfile()` —
    settled at implementation time; either way the surface is
    SugarProfile-owned).
  - Adds the host-middleware contribution.
- `apps/studio/src/plugins/catalog/sugarprofile/index.tsx`
  - Provision-side button "Apply SugarProfile Migration" that
    POSTs to `/__sugarprofile/run-migration`.
  - Session Inspector panel grows a **Current Profile** section
    (display_name / locale / preferences) alongside Current User
    and Current Save — useful for dev verification that the
    profile auto-create trigger fired.

**Tests:**

- Mocked Supabase client unit tests for `SupabaseGameSaveStore`.
- Mocked Supabase client unit tests for `SupabaseProfileStore`
  (load returns null when no row exists, update merges fields,
  setPreference doesn't clobber siblings).
- A registration test asserts the host middleware is contributed.

**Dependencies:** 47.1, 47.7 (need an authenticated client to
construct the stores from).

**Exit:** the migration SQL is emitted into wordlark on save; the
"Apply SugarProfile Migration" button runs `supabase db push`
successfully; round-trip save+load works with an authenticated
JWT against the test Supabase project; an attempt to read
another user's row returns empty (RLS-enforced). Signing up a
new user via the LoginModal results in a `public.profiles` row
auto-created with default `locale: 'en'` and empty
`preferences`. Updating the user's `locale` via SugarProfile's
runtime API persists across sessions.

### 47.9 — Gateway-side JWT validation middleware

Validates `Authorization: Bearer <jwt>` against the Supabase JWT
secret. Contributed by SugarProfile via the gateway scaffold's
existing middleware contribution slot. Supersedes the shared-token
path when SugarProfile is enabled.

**Files (new):**

- `packages/plugins/src/catalog/sugarprofile/runtime/gateway-jwt-middleware.ts`
  ```ts
  import { createHmac, timingSafeEqual } from "node:crypto";
  export function createSupabaseJwtVerifyMiddleware(
    options: { jwtSecret: string }
  ): GatewayMiddleware { ... }
  ```
  - Parses `Authorization` header, splits + verifies HS256 signature
    (compute HMAC-SHA256 of `header.payload`, constant-time compare
    against the supplied signature).
  - Decodes payload + asserts `aud === "authenticated"`, `exp > now`.
  - Attaches `req.user = { userId: payload.sub, email: payload.email }`
    on the request when valid.
  - Returns 401 with `{ ok: false, reason }` on any failure (missing
    header, bad shape, expired, signature mismatch).
- `packages/plugins/src/catalog/sugarprofile/runtime/index.ts`
  - Exports a `createSugarProfileGatewayContribution()` that returns
    the gateway middleware factory hook.

**Files (modify):**

- Plan 045's gateway scaffold composes plugin-contributed middlewares
  AFTER `/health` and BEFORE route dispatch. When SugarProfile is
  enabled, the JWT middleware replaces the existing
  `authorizeBearer` middleware. If SugarProfile is enabled AND
  `gatewayAuthMode === "bearer"`, the JWT middleware wins and the
  shared-token path is dropped — settled to "remove the shared
  token when SugarProfile is enabled" per the open question.

**Tests:**

- Unit: valid HS256-signed payload with audience + exp -> 200, user
  attached.
- Expired payload -> 401.
- Bad signature -> 401.
- Missing Authorization header -> 401.
- Wrong audience -> 401.
- Header shape `Bearer ` with empty token -> 401.

**Dependencies:** 47.6 (plugin scaffold). 47.7 isn't strictly
required (the middleware is pure server-side) but story exit
benefits from an end-to-end JWT to verify against, so land 47.7
first.

**Exit:** unit tests pass. The deployed wordlark gateway
authenticates a real Supabase-signed JWT end-to-end:
SugarAgent's `/api/sugaragent/generate` rejects unauthenticated
requests with 401 + accepts a request carrying a valid signed-in
user's JWT.

### 47.10 — Autosave loop + migrate-local-to-cloud on sign-in

Adds the per-tick save-writing loop on top of the existing read
path (47.5) so a player's progress persists between sessions.
When a player signs in mid-game (the LoginModal lands in 47.7.5),
their anonymous IndexedDB save migrates up to Supabase under the
new credentialed userId so they don't lose progress.

**Files (new):**

- `targets/web/src/save/useAutosave.ts`
  - `useAutosave(payload: GameSavePayload, store: GameSaveStore,
    userId: string)` hook. Debounces writes 500ms. Bails on
    re-renders where `payload` is reference-equal to the last
    write.
  - Tracks `lastWriteState` so it can skip no-op writes after a
    server-confirmed save round-trips back.
- `targets/web/src/save/migrate-local-to-cloud.ts`
  - `migrateLocalSaveToCloud(localStore, cloudStore, user)` —
    reads the local IndexedDB save, writes it to the cloud store
    under the new credentialed userId, clears the local copy on
    successful write.

**Files (modify):**

- `targets/web/src/App.tsx`
  - Wires `useAutosave(currentGameSavePayload, activeSaveStore,
    currentUser.userId)` against the resolved save store.
  - On sign-in (subscribe to `provider.onChange`, trigger when
    isAnonymous flips false): run
    `migrateLocalSaveToCloud(...)` once and reset the autosave
    cursor so the cloud write loop takes over cleanly.

**Tests:**

- Unit: autosave hook debounces, doesn't re-write reference-equal
  state.
- Unit: `migrateLocalSaveToCloud` copies + clears.
- Browser integration test (Playwright if practical, otherwise
  manual): open game, move player, close tab, reopen, resume.
  Repeat signed-in to verify cloud round-trip.

**Dependencies:** 47.7.5 (resolver + login UI), 47.8 (save store
contribution), 47.9 (gateway JWT so SugarAgent calls can use the
signed-in user's bearer if needed).

**Exit:** a player can play wordlark anonymously, sign in mid-
game, and their progress survives both sign-in and a page reload.
With SugarProfile NOT installed, the same play loop persists
locally through IndexedDB.

### 47.10.5 — Save-aware menu + default starting state

Closes the UX gap autosave exposes: once 47.10 writes per-tick,
every boot finds a save and hydrates the player at their last
position. The current `start-new-game` UI action just dismisses
the menu — it does NOT clear the save. So clicking "New Game"
after autosave is in continues from the save instead of starting
fresh. This story makes the menu save-aware and introduces an
explicit starting-state record on the project so "New Game" has
something clean to reset to.

Three coupled pieces:

**1. Default starting state on the project.**
Add `defaultGameSavePayload: GameSavePayload | null` to
`GameProject` (or to the SugarProfile plugin's per-game config
slot — see Open Questions). Carries the cross-plugin player
record a brand-new player gets: `currentRegionId`,
`currentQuestId`, `playerPosition`. Replaces today's implicit
composition (`boot.json.activeRegionId` + per-region
`playerPresence`) with a single editable record. Until a project
authors a value, the runtime falls back to the existing
implicit defaults — no breaking change to existing games.

**2. Revised UI actions.**

- `start-new-game` semantics change: clear the active save store
  for the current user, hydrate the runtime from
  `defaultGameSavePayload` (or fall back to the implicit
  composition), then dismiss the menu + unpause. The save-clearing
  step is conditional on a confirmation in the menu (cancellable
  modal) so a misclick doesn't nuke a player's progress.
- `continue-game` (new) — loads the existing save and dismisses
  the menu. No-op when no save exists (button is hidden in that
  case; see #3).

**3. Menu auto-detection + designable Continue button.**

- A new menu-system runtime hook `isSaveAvailableForCurrentUser()`
  exposes "is there a save in the active store under the current
  user?" The default start menu's `start-new-game` and
  `continue-game` buttons read this hook to decide what to show:
  - Save present: "Continue" (primary), "New Game" (secondary,
    confirms-then-resets).
  - No save: "New Game" only (no Continue button).
- The Continue button is a first-class menu element: authors style
  + place it in the **Game UI workspace** just like the existing
  New Game button. The auto-detect lives in the menu's
  visibility rule (a declarative `showWhen` expression bound to
  the save-presence hook), so no per-game JavaScript needed.

**Files (new):**

- `packages/runtime-core/src/ui-actions/save-aware-actions.ts`
  - `registerSaveAwareUIActions(registry, options)` adds
    `continue-game` + replaces `start-new-game` with the
    save-clearing variant. Options carry `saveStore` + `userId
    Provider` + a clear-confirmation callback the menu layer
    surfaces as a modal.
- `packages/runtime-core/src/ui-context/save-presence.ts`
  - `useSavePresence(saveStore, userId)` — exposes a reactive
    boolean to the menu system. Updates when the save store
    changes (post-write, post-clear).

**Files (modify):**

- `packages/domain/src/game-project/index.ts` — adds the
  `defaultGameSavePayload: GameSavePayload | null` field with a
  null default. Migration: existing projects deserialize cleanly
  with `null`; the new field is purely additive.
- `targets/web/src/runtimeHost.ts` — the existing save-fallback
  chain becomes:
  `savedGame.payload -> defaultGameSavePayload -> implicit (boot.json + playerPresence)`.
- `apps/studio/src/workspaces/GameUIWorkspace.tsx` (or the actual
  Game UI workspace file) — surfaces the Continue button as a
  selectable element; authors can style + position it. The
  visibility rule is wired to `isSaveAvailableForCurrentUser`
  declaratively.

**Tests:**

- `pickGameSavePayload(authoredImplicit, defaultPayload, save)`
  pure helper: save wins -> defaultPayload wins -> authored
  implicit wins, in that order.
- `start-new-game` clears the save then dispatches the menu
  dismiss.
- `continue-game` no-ops when no save exists.
- `useSavePresence` reactivity: writes flip it true, clears flip
  it false.
- Game UI workspace: rendering the start menu with a save present
  shows both buttons; without a save shows only New Game.

**Dependencies:** 47.10 (autosave is what makes the menu save-
aware actually meaningful).

**Exit:** in wordlark, the start menu shows "Continue" + "New
Game" when a save exists for the current user; clicking Continue
resumes at the saved region/position; clicking New Game prompts
for confirmation then clears the save + spawns the player at the
project's `defaultGameSavePayload` values (or, if unset, at the
implicit boot.json + playerPresence defaults). A brand-new
player (no save yet) sees only "New Game". The Continue button
is editable in the Game UI workspace like any authored menu
element — visibility binding is declarative, not per-game code.

### 47.11 — Documentation pass

ADR 020 captures the architecture. READMEs reflect the new
contracts. Plan 021 cross-reference banner extended.

**Files (new):**

- `docs/adr/020-sugarprofile-user-management-architecture.md`
  - Decisions: two core contracts; defaults in runtime-core; one
    plugin = identity + save store; user-related data lives in
    SugarProfile, plugin-domain per-user data stays with the
    plugin keyed on userId; Supabase + RLS as the v1 backend.

**Files (modify):**

- `packages/plugins/src/deployment/README.md` — adds
  `/__sugarprofile/run-migration` + `/__sugarprofile/probe-supabase`
  to the host-endpoint table; adds SugarProfile to the catalog of
  plugins.
- `targets/web/README.md` — adds the identity + save hooks the
  App.tsx boot path consumes, plus the autosave hook.
- `docs/plans/021-deployment-plugin-and-publish-deploy-target-architecture-epic.md`
  — adds Plan 047 / ADR 020 to the top cross-reference banner.
- `docs/adr/README.md` — add ADR 020 to the index.

**Tests:** none (docs).

**Dependencies:** 47.10 (everything implemented + verified).

**Exit:** ADR 020 exists and reads consistently with the
shipped behavior. A future plugin author can read ADR 020 +
`packages/plugins/src/deployment/README.md` + Plan 047 and write a
competing identity provider plugin without reading source.

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
