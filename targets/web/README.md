# `targets/web`

The published web target shell around the shared Sugarmagic runtime.
Game-agnostic engine: the same `dist/` ships across every game that
pins this engine version. Per-game data comes in through
`boot.json` at runtime; build-time identifiers + gateway plumbing
come in through `VITE_SUGARMAGIC_*` env vars at compile time.

For the engine vs. game lifecycle rules, read
[ADR 019](/docs/adr/019-engine-vs-game-lifecycle-split.md).
For the publish-target architecture this fits into, read
[ADR 018](/docs/adr/018-sugardeploy-web-publish-target-architecture.md).

## Owns

- Published web entry point (`main.tsx` -> `App.tsx`).
- Boot wiring for both modes: Studio in-process preview AND
  published-web with a fetched `boot.json`.
- Build-time config surface (`buildConfig.ts`) -- the
  `VITE_SUGARMAGIC_*` schema the GHA deploy workflow injects at
  `pnpm build` time.
- Target asset base configuration.

## Does not own

- Per-game runtime data (entities, dialogue, lore pointers). That
  lives in `.sugarmagic/published-web/boot.json` and is committed
  with the game project.
- Vendor API credentials. The browser talks only to the gateway
  proxy URL; the gateway resolves credentials from Secret Manager
  server-side.
- A second engine. The Studio preview path and the published-web
  path share the same runtime; the App.tsx in this package
  branches on whether `boot.json` is fetched (published-web) or
  injected by the embedding shell (Studio preview).

## Dual-mode boot

`App.tsx` boots in one of two modes depending on whether it's
running inside Studio or as a standalone published-web deploy:

- **Studio preview** -- the runtime is mounted into a viewport
  inside Studio (Author / Playtest productmodes). The boot
  payload comes in-process from the editing session; no fetch
  needed. `pluginRuntimeEnvironment` is the unprefixed
  `SUGARMAGIC_*` map computed from the Studio host's
  `VITE_SUGARMAGIC_*` env (see `bootPreviewSession.ts`).
- **Published-web** -- the runtime is the deployed Netlify
  bundle. On startup `App.tsx` fetches `/boot.json` from the
  origin (same-origin to the Netlify deploy). Build-time
  identifiers and the gateway URL/bearer come from the
  `VITE_SUGARMAGIC_*` env baked at `pnpm --filter
  @sugarmagic/target-web build` time by the GHA
  `deploy-frontend` job.

Both modes converge on the same `runtimeHost.ts` boot path
once they have a normalized `GameProject` snapshot +
`pluginRuntimeEnvironment` map in hand.

## Build-time env schema

The full `VITE_SUGARMAGIC_*` schema lives in `buildConfig.ts`.
Categories:

- **Gateway plumbing** -- `VITE_SUGARMAGIC_GATEWAY_URL`,
  `VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN`. The browser uses these
  to call the deployed Cloud Run gateway; vendor APIs are
  reached through the gateway, never directly.
- **Build provenance** -- `VITE_SUGARMAGIC_GAME_MAJOR_VERSION`,
  `VITE_SUGARMAGIC_VERSIONED_SLUG`, `VITE_SUGARMAGIC_GIT_SHA`,
  `VITE_SUGARMAGIC_BUILD_TIMESTAMP`. Identifiers stamped into
  the bundle so a running deploy can tell you what it is.
- **Per-plugin proxy URLs** -- `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL`,
  `VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL`, etc. Optional
  per-plugin overrides; default to the gateway URL when absent.
  These are stable across plugins because the gateway routes
  by path, not by host.

API credentials NEVER enter this schema. Vendor calls happen
server-side at the gateway; the gateway holds the credentials
in Secret Manager and the runtime SA fetches them on demand.

## `boot.json` contract

The published-web bundle reads `boot.json` from its origin on
startup. Emitted by SugarDeploy via
`buildPublishedWebManagedFiles(gameProject, snapshot)` in
`packages/plugins/src/deployment/published-web.ts`. Carries:

- `schemaVersion: BOOT_JSON_SCHEMA_VERSION` -- compatibility
  token. The runtime refuses to boot a payload it doesn't
  understand. New engine versions can additively extend the
  schema (older engines ignore unknown fields); reshaping the
  schema requires bumping `BOOT_JSON_SCHEMA_VERSION` and an
  engine major release.
- Full normalized `GameProject` snapshot the runtime needs
  (entities, dialogue, HUD definition, sound bindings, asset
  sources).
- Plugin-specific runtime payloads keyed by
  `pluginBootPayloads[<pluginId>]`.

The `BOOT_JSON_SCHEMA_VERSION` constant is exported from
`packages/plugins/src/deployment/published-web.ts` and is the
single source of truth for both the emitter and the runtime
assertion.

## References

- [ADR 018: SugarDeploy Web Publish Target Architecture](/docs/adr/018-sugardeploy-web-publish-target-architecture.md)
- [ADR 019: Engine vs. Game Lifecycle Split](/docs/adr/019-engine-vs-game-lifecycle-split.md)
- [Plan 046: SugarDeploy Web Publish Target Epic](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
- [Plan 048: GHCR-Published Engine, Per-Game Pin](/docs/plans/048-ghcr-published-target-web-epic.md)
- [Proposal 005: Sugarmagic System Architecture](/docs/proposals/005-sugarmagic-system-architecture.md)
