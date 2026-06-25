# Plan 046: Studio Publish Productmode + SugarDeploy Provision / Release / Deploy

**Status:** Proposed
**Date:** 2026-06-22

> Builds on [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
> (the backend / Cloud Run half) and [ADR 017](/docs/adr/017-sugardeploy-cloud-run-architecture.md).
> The identity-provider plugin work that used to be Plan 046 is now
> [Plan 047](/docs/plans/047-sugarprofile-user-management-plugin-epic.md).
> Engine versioning for `@sugarmagic/target-web` is out of scope here
> and lives in [Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md);
> this epic ships a "local-build-and-commit `dist/`" stopgap that
> Plan 048 replaces.

## Epic

### Title

Front End Deployment + Publish Productmode.

Introduce a first-class Studio productmode named **Publish** alongside
Design, Build, etc. Studio core ships the productmode and a single
baseline workspace — **Package** — whose one button produces a self-
contained playable artifact (pure client-side, no gateway, no APIs);
that covers every game whose enabled plugins are all client-only.
Plugins contribute additional workspaces into the same productmode for
richer publish flows. The SugarDeploy plugin contributes three:
**Provision** (rare, hands-on infrastructure setup), **Release**
(occasional, deliberate git-anchored version events), **Deploy**
(frequent, fast, button-and-watch shipping). Finish the web publish-
target half of SugarDeploy so the Deploy workspace ships both the
backend gateway and the playable browser frontend in one operation.
The Deploy workspace fires a plugin-generated GitHub Actions workflow
that does the actual build + push; Studio is the trigger + status
surface.

### Goal

- **Publish is a first-class Studio productmode, with a baseline
  Package workspace shipped by Studio core.** A new top-level
  product mode named "Publish" registers in `packages/productmodes`
  parallel to Design / Build / etc. Studio core contributes one
  baseline workspace — **Package** — into the new mode. Its single
  button builds a self-contained playable artifact (`targets/web/dist/`
  produced WITHOUT a gateway URL); the user can host the output
  anywhere static files go (Netlify drag-and-drop, S3, GitHub Pages,
  `file://`, IPFS, etc.). Plugins contribute additional workspaces
  into the Publish productmode for richer flows. SugarDeploy
  contributes three — Provision, Release, Deploy — each owning a
  coherent slice of the hosted-deploy lifecycle. The existing single-
  workspace SugarDeploy UI from Plan 045 dissolves into these three;
  nothing functional is lost, just reorganized by cadence.

- **Package gates itself on "no enabled plugin demands a gateway."**
  The Package button works for games whose enabled plugins are
  entirely client-side. If the user has gateway-needing plugins
  enabled (SugarAgent's LLM proxy, etc. — which depend on
  SugarDeploy for their deploy-time fulfillment), Package is disabled
  with a tooltip pointing at SugarDeploy's Deploy workspace. No
  special "no-gateway build mode" or runtime stubbing: the build
  composes whatever plugins are enabled in `pluginConfigurations`,
  and gateway-needing plugins simply aren't in pure-client builds.

- **Provision workspace = one-time-ish infrastructure.** Owns:
  Create GCP Project, Setup Infra (`terraform apply`), Set Secret
  Values, Setup GitHub Workflow (new — bootstraps the GHA secrets +
  generates the workflow YAML), Teardown Infra. The cadence here is
  "set up a new game" or "set up a new major version" — rare, gated,
  hands-on. This workspace can be more elaborate UI (lots of fields,
  step-by-step gating) because the user is here infrequently.

- **Release workspace = deliberate git-anchored version events.**
  Owns: Cut New Major Version (the saga from Plan 045 story 45.8),
  Tag Patch Version (new — `v1.0.1` on a worktree of v1.0.0), the
  version history list. The cadence here is "I'm declaring this code
  is v2" — occasional, irreversible-ish, deliberate. This workspace
  stays tight: confirmation modals, a single big button per action,
  big visual distinction between major-version cuts and patch tags.

- **Deploy workspace = frequent, fast, button-and-watch.** (Inner
  Deploy workspace, contributed by SugarDeploy — distinct from the
  outer Publish productmode.) Owns: the single Deploy button, live
  status from the in-flight GHA run, the per-version deploy history
  (each Deploy produces a deploy id + URL), the live-alias indicator
  showing which major is public-facing. The cadence here is "I made
  a fix, ship it now" — many times a day during active iteration.
  This workspace is the daily-driver surface and gets the heavy
  visual treatment.

- **GitHub Actions runs the deploy primitives.** The actual build +
  push work — `docker build` + Artifact Registry push + `gcloud run
  deploy` for the backend, `netlify deploy` against a pre-baked
  bundle for the frontend — lives in a plugin-generated GHA workflow
  under `.github/workflows/sugardeploy-deploy.yml` in the game root.
  Studio's Deploy button fires the workflow via `workflow_dispatch`;
  the workflow can also fire on `push: tags: ['v*']` for tag-driven
  production deploys. The workflow YAML is a plugin-managed file
  with the same `# GENERATED BY SUGARMAGIC` header + `# SUGARMAGIC
  WORKFLOW TEMPLATE VERSION: NN` stamp + drift-banner discipline as
  the terraform. The frontend bundle (engine shell) is NOT built on
  the GHA runner — engine builds are a separate sugarmagic-side
  concern (see Plan 048); the wordlark-side workflow only ships the
  pre-baked bundle plus a per-game `boot.json` to Netlify.

- **One Deploy button, one user-visible operation.** Clicking Deploy
  in the Deploy workspace fires the GHA workflow once; the workflow
  internally has a backend job and a frontend job (with `needs:`
  ordering to be picked during scoping) that each ship their side.
  Re-run a failed job from the GHA UI without redoing the successful
  one. Studio polls the run status and surfaces it in the Deploy
  workspace so the user doesn't have to leave Studio to see what's
  happening.

- **Provision and Release stay Studio-orchestrated.** GHA does NOT
  do GCP project creation, terraform infrastructure provisioning,
  secret-value setting, or version cuts. Those are interactive,
  stateful, and Studio-local by design. Studio's host middleware
  shells `gcloud` / `terraform` / `gh` / `git` for those flows
  (the pattern Plan 045 already established). GHA's role is
  narrowly scoped to "build + push artifacts."

- **GitHub bootstrap is automated.** Setup GitHub Workflow (the new
  Provision-workspace button) does: writes the required repo secrets
  via `gh secret set ... < value` (mirroring Plan 045's
  `gcloud secrets versions add` pattern — values never enter Studio
  state, never log), generates the `.github/workflows/sugardeploy-
  deploy.yml`, and verifies the WIF binding from Plan 045's
  terraform output. Idempotent — re-run safely after terraform
  updates the WIF binding shape. The user only needs `gh` (GitHub
  CLI) on PATH and logged in via `gh auth login`, same way they
  already need `gcloud` and `terraform`.

- **Publish target stays publication-medium-shaped; frontend hosts
  are deployment targets with `role: "frontend"`.** `publishTargetId`
  stays `"web"` (the medium — what the user plays on). Future
  publish targets are `"mobile"`, `"steam"`, etc., NOT subdivided by
  hosting provider. Where artifacts physically run is the orthogonal
  deployment-target axis. Plan 045's `DeploymentTargetId` enum
  (currently `"local" | "google-cloud-run"`, both `role: "backend"`)
  gets a parallel `FrontendDeploymentTargetId` enum (initially
  `"netlify"`, future Vercel / GCP static / etc.). The two enums are
  kept separate at the type level — `backendDeploymentTargetId:
  BackendDeploymentTargetId | null` and `frontendDeploymentTargetId:
  FrontendDeploymentTargetId | null` on `DeploymentSettings` — so
  the type system enforces "a frontend slot only accepts frontend-
  role targets." Adding a new frontend host is registering a new
  entry in the frontend registry; same plugin-handler shape Plan
  045 established for backend targets.

- **`targets/web/` finished into a real playable artifact, but
  game-agnostic.** The published-web shell at `targets/web/`
  (workspace name `@sugarmagic/target-web`) already exists and is
  composed of `runtime-core` + `render-web` + `plugins` + `domain`
  — today it renders a placeholder card. This epic finishes that
  shell so its Vite build produces a real playable engine bundle:
  composes the game render path, fetches `/boot.json` at runtime
  (the per-game data), and reads build-time-injected configuration
  (gateway URL, gateway-shared-token if `gatewayAuthMode ===
  "bearer"`, build sha + timestamp) from Vite env vars. The engine
  bundle itself is game-agnostic — no `project.sgrmagic`, no content
  library, no regions, no assets get baked into it. Per-game data
  lives in `boot.json`, generated by SugarDeploy on save (managed
  file, committed to the game repo, deployed alongside the engine
  bundle at the Netlify site root). Studio's preview path already
  imports from `@sugarmagic/target-web` (`createWebRuntimeHost`,
  `bootPreviewSession`) — same module — so finishing the production
  bundle also tightens the in-Studio preview fidelity.

- **Per-version frontend deploys preserved forever.** Each Deploy on
  a given major produces a Netlify deploy. v1's deploy at
  `wordlark-v1-{suffix}--{site}.netlify.app` keeps running
  untouched after a Cut to v2 produces a separate
  `wordlark-v2-{newSuffix}--{site}.netlify.app` deploy. Netlify
  keeps deploys forever by default; `git worktree add` at
  `v1.0.0` re-opens the v1 worktree in Studio, SugarDeploy
  resolves back to v1's identity on both halves, and any
  redeploy from that worktree updates v1's per-deploy slot only.

- **Frontend talks to the matching backend major by construction.**
  The bundle's baked-in gateway URL points at the same major's
  Cloud Run service URL. A v1 frontend ALWAYS calls v1 backend; v2
  frontend ALWAYS calls v2 backend. Cross-major requests are
  impossible by construction. This is what makes future "drain v1
  traffic while v2 is live" tractable: each loaded client session
  is already version-pinned by virtue of how it loaded.

- **Backend learns the frontend origin and threads it through CORS.**
  The Cloud Run deploy script and terraform inputs expand to include
  the matching major's frontend origin (the per-deploy Netlify URL
  AND the live alias domain when set). CORS allows both — sessions
  loaded from the live alias keep working after the alias points
  elsewhere because the bundle has the per-deploy URL baked in
  while the gateway still accepts the alias's Origin header.

- **Live-alias domain shape decided once, applied uniformly.** The
  publish-target settings include a project-level "live domain"
  field. For wordlark the value is `play.wordlarkhollow.com` — a
  dedicated subdomain on the marketing domain. Per-version deploys
  keep their Netlify-generated per-deploy URL forever; the live
  alias CNAMEs to whichever per-version deploy is currently
  promoted. The promote-to-live action is a separate explicit
  affordance in the Deploy workspace; Deploy itself always
  produces a freshly-shipped version-bound URL without touching
  what the public is currently seeing.

- **Architecture supports drain-and-promote even if the actual
  promote UI lands later.** Same property as Plan 045's Cut
  preserves prior-major's identity forever: v1 stays alive on both
  halves until explicitly torn down; the alias-flip operation is
  one Netlify API call away when we add the affordance. This epic
  ships the data shape + the per-version URL surface; the alias-
  flip button can land as a follow-up story without retrofitting.

- **Same plugin principles as Plan 045.** SugarDeploy's contributions
  (Provision / Release / Deploy workspaces, their host actions, the
  publish + deploy targets, the GHA workflow YAML) live inside the
  plugin. Studio core owns only the productmode shell + the Package
  baseline workspace. State persists in SugarDeploy's
  `pluginConfigurations[].config` slot, NOT on `GameProject`. The
  plugin survives the contractor test: uninstall it -> domain still
  typechecks, game-authoring still works, the Publish productmode
  collapses to just the Package workspace (a self-contained playable
  artifact is still buildable from Studio core alone). Settings flow
  through `UpdatePluginConfigurationCommand` builders the deploy
  package already exports.

### Why this epic exists

Plan 045 made the gateway deployable, but a deployed gateway is not
a playable game. The published-web shell at `targets/web/` exists but
renders a placeholder card; no production build target produces a
real playable artifact, no gateway URL wiring is in place, no static
host integration exists. Users can ship the API but cannot ship the
game.

Beyond the missing-frontend gap, two structural problems with the
current SugarDeploy UI surface:

1. **One workspace conflates three cadences.** Provisioning is a
   weeks-to-months operation; Release is a weeks-to-months operation;
   Deploy is a many-times-a-day operation. The current SugarDeploy
   workspace shows all of them on one screen, with the daily-driver
   Deploy affordance fighting for visual attention with the rare
   "Create GCP Project" affordance. The three-tab split inside the
   Publish productmode matches the real shape of the work.

2. **The Deploy primitive lives inside Studio's process.** Studio
   shells `gcloud run deploy` directly, which means: the user must
   have all the toolchain installed locally, deploys can't run from
   CI, there's no audit trail, partial failures need a hand-rolled
   saga to recover. Wordlark-v1's previous-generation setup ran
   deploys from GitHub Actions for exactly these reasons. Pulling
   the deploy primitive into a plugin-generated GHA workflow gets us
   the same affordances without losing the Studio-orchestrated
   provisioning + release flows that ARE the right shape for those
   cadences. Same `deploy.sh` generated by Plan 045 — GHA just runs
   it on a clean runner instead of the user's laptop.

Plan 021 named the publish-target / deployment-target separation as
a first-class architectural axis. Plan 045 filled in the
deployment-target half (and shipped the provisioning + release
flows). This epic fills in the publish-target half, AND reshapes the
UI around the three real cadences, AND introduces GHA as the
canonical deploy invoker.

The drain / promote support matters because we want to ship live
updates to players without breaking sessions. Once we have multiple
running majors and a way to flip the "live" alias between them, we
gain a path that doesn't exist in the wordlark-v1 hand-wired model:
ship a v2, point new players at v2, let v1 sessions complete on
v1's frozen-in-time backend, then retire v1. That story is
prefigured here in the URL shape and version identity even though
the actual promote / drain controls land in a follow-up.

### What is NOT in scope

- **Multi-environment per major version** (staging vs. production
  vs. dev). Plan 045 deferred this on the backend; this epic defers
  it on the frontend for symmetry. A future epic can layer
  environment overrides on both sides at once.
- **The promote-to-live and drain-old-version UI / actions.** This
  epic prepares the URL shape and version-bound identity that those
  actions will need. The actions themselves are a follow-up story
  or epic.
- **Custom domains on the backend Cloud Run service.** Each major's
  Cloud Run service keeps its `*.run.app` URL. The frontend bundle
  bakes in that URL directly. A future epic can map the backend to
  `api.wordlarkhollow.com` if cosmetic backend URLs become important.
- **Per-user identity.** The bearer-shared-token model from Plan 045
  carries forward. The token is baked into the frontend bundle at
  build time (honor-system, as already established). Real per-user
  identity is [Plan 047](/docs/plans/047-sugarprofile-user-management-plugin-epic.md).
- **Asset CDN optimization.** Frontends served from Netlify get
  Netlify's CDN. Moving assets to a separate object store + edge
  cache is a future optimization.
- **Self-hosted alternatives to Netlify.** Netlify is the v1
  publish target. The architecture supports adding more; this epic
  ships Netlify only.
- **Migrating Provision + Release flows into GHA.** GHA's job is
  strictly the build + push deploy primitives. Provisioning and
  Release stay Studio-orchestrated.
- **Continuous-deploy-on-push-to-main.** The GHA workflow supports
  `push: tags: ['v*']` (tag-driven prod deploy) and
  `workflow_dispatch` (Studio button-driven ad-hoc deploy). A push-
  to-main auto-deploy trigger could be added later as a setting but
  is not the v1 shape.
- **Engine versioning of `@sugarmagic/target-web`.** This epic ships
  the engine bundle via a "build it in Studio with the Build
  Frontend button, commit `dist/` to the game repo" stopgap. The
  production engine-versioning story (manual release workflow in
  sugarmagic, GHCR-published bundle, per-game `frontendBundleVersion`
  pin, Unity-style upgrade prompt on project open) is
  [Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md).

## Deliverables

### Studio core

- A new top-level productmode "Publish" registered in
  `packages/productmodes` alongside Design / Build / etc. Studio
  chrome surfaces it as a peer of the existing modes. The mode
  hosts whatever workspaces plugins contribute, plus one Studio-
  core baseline workspace.
- A baseline `package` workspace contributed by Studio core into
  the Publish productmode. Single button labeled "Package": runs
  `targets/web/`'s Vite build with no gateway URL configured,
  outputs `targets/web/dist/`, surfaces the output directory and
  artifact size in the UI. Disabled with a tooltip pointing at
  SugarDeploy's Deploy workspace when any enabled plugin in
  `pluginConfigurations` declares a gateway-routed deployment
  requirement.

### Plugin contributions

- The SugarDeploy plugin contributes three workspaces into the
  Publish productmode: `provision`, `release`, `deploy`. Each
  workspace owns its slice of the cadence as described in Goal.
- Today's single SugarDeploy workspace (from Plan 045) is dissolved:
  Create GCP Project + Setup Infra + Set Secret Value modals +
  Teardown Infra move to the Provision workspace. Cut New Major
  Version (from 45.8) moves to the Release workspace. The Deploy
  button (which today shells `gcloud run deploy` synchronously)
  moves to the Deploy workspace and is rewired to fire a GHA
  `workflow_dispatch` instead. The Version + Sources + Targets
  panels are split across workspaces as appropriate (Sources +
  per-target settings flow into Provision because they're set-once
  config; Version lives in Release; the live-alias indicator and
  per-deploy history live in Deploy).
- A `frontendDeploymentTargetHandlers` registry in
  `packages/plugins/src/deployment/` parallel to the existing
  `targetHandlers` (which now becomes
  `backendDeploymentTargetHandlers` or stays named while it grows a
  sibling, scoping detail). Each handler exposes `definition` (with
  `role: "frontend"`), `normalizeOverrides`, optional
  `collectWarnings`, `buildManagedFiles`. The Netlify handler emits
  per-game `netlify.toml`, a build-config manifest, and a README
  into `<game-root>/deployment/netlify/` (mirroring the existing
  `deployment/google-cloud-run/` layout — all deployment-target
  outputs live under `deployment/` keyed by target id). Same drift-
  discipline as the Cloud Run terraform.

### Plugin-managed files (new)

- `<game-root>/.github/workflows/sugardeploy-deploy.yml` — the
  deploy workflow. Carries the `# GENERATED BY SUGARMAGIC` header
  and `# SUGARMAGIC WORKFLOW TEMPLATE VERSION: NN` stamp.
  Regenerated on every save like the terraform. Drift discipline:
  "overwrite on save with a Provision-workspace banner if the
  on-disk stamp is older than the current template version" —
  same shape as the existing terraform drift banner.
  `WORKFLOW_RENAME_LEDGER` is reserved for future job/step renames
  (parallel to `TERRAFORM_RENAME_LEDGER`).
- `<game-root>/deployment/netlify/netlify.toml` and supporting
  files — Netlify build config, frozen at the major's identity.
- `<game-root>/deployment/netlify/README.md` — generated, covers
  what's in the bundle, what env vars are baked in, manual fix-up
  commands.
- `<game-root>/.sugarmagic/published-web/boot.json` — per-game
  runtime payload (project identity, plugin configurations,
  mechanics, definitions, etc.) serialized to the
  `WebRuntimeStartState` shape. Carries `BOOT_JSON_SCHEMA_VERSION`
  so target-web's runtime can fail-fast on mismatch. Regenerated
  on every save.
- `<game-root>/.sugarmagic/published-web/README.md` — operational
  README for the published-web bundle directory.
- `<game-root>/.sugarmagic/published-web/dist/` — engine bundle
  output, populated by the Build Frontend button (Provision). v1
  stopgap; replaced by Plan 048's GHCR pull.

### `targets/web/` finishing

- App composes `runtime-core` + `render-web` for a real game
  render path (replaces the placeholder card).
- Build-time config baked in via Vite env vars: gateway URL,
  bearer token (if applicable), build git SHA, build timestamp,
  `BOOT_JSON_SCHEMA_VERSION` constant. The bundle is otherwise
  game-agnostic.
- Boot data path forks on `hostKind`:
  - Studio preview keeps using the `postMessage` `PREVIEW_BOOT` path
    (the opener window pushes project state directly — no fetch).
  - Production fetches `/boot.json` at runtime. The file is laid
    next to the engine bundle on the Netlify site root by the GHA
    `deploy-frontend` job before `netlify deploy`. The bundle does
    NOT bake game content in; the per-game data is in `boot.json`,
    a SugarDeploy-managed file.
- Engine bundle itself comes from `targets/web/dist/`. v1 ships it
  via a local-build-and-commit stopgap (the Build Frontend button
  in Provision dumps `dist/` into `.sugarmagic/published-web/dist/`
  in the game repo); [Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md)
  replaces this with a manually-released, GHCR-pulled bundle that
  the game repo never holds.

### Host actions (Studio dev server middleware)

Provisioning + Release host actions are largely already in place
from Plan 045. New endpoints:

- `POST /__sugardeploy/setup-github-workflow` — bootstraps GHA:
  ensures `gh` is on PATH + authenticated, validates the
  `githubRepo` is set on `DeploymentSettings`, reads terraform
  outputs (`runtime_sa_email`, `github_wif_provider_name`) and sets
  them as repo **vars** (`SUGARMAGIC_RUNTIME_SA_EMAIL`,
  `SUGARMAGIC_WIF_PROVIDER`) via `gh variable set --repo`. Sets
  `NETLIFY_AUTH_TOKEN` as a repo **secret** via `gh secret set --repo`
  with the value piped over stdin so it never appears in argv. The
  WIF + SA values are non-secret identifiers (they show in GitHub
  Actions logs anyway) so they belong on vars; only `NETLIFY_AUTH_TOKEN`
  needs the secret-handling discipline. Idempotent.
- `POST /__sugardeploy/build-published-web` — runs `pnpm --filter
  @sugarmagic/target-web build` in the Studio's sugarmagic checkout
  root and copies `targets/web/dist/` into the game project's
  `.sugarmagic/published-web/dist/`. Out of the save path
  (multi-second vite build). Stopgap; replaced by Plan 048.
- `POST /__sugardeploy/preflight-deploy-workflow` — pre-flight
  checks the Deploy button runs against the live git state before
  dispatching: clean tree, HEAD pushed to remote, `gh` on PATH +
  authed, `githubRepo` set. Returns `{ ok, ref, headSha }` for the
  confirm modal.
- `POST /__sugardeploy/dispatch-deploy-workflow` — re-runs preflight
  server-side, then `gh workflow run sugardeploy-deploy.yml --ref
  <branch>`. Polls `gh run list` to resolve the run id + URL.
  Returns `{ runId, runUrl, ref, headSha }`. Refuses on dirty tree
  or unpushed HEAD — there's no auto-snapshot-branch path.
- `POST /__sugardeploy/get-deploy-workflow-status` — `gh run view
  --json status,conclusion,jobs,url,...`. Returns normalised
  `{ status, conclusion, url, jobs }`. Studio polls every 4s while
  the run is in flight. Empty-string `conclusion` is normalised to
  `null` server-side so downstream UI can rely on `=== null`
  meaning "in flight."
- `POST /__sugardeploy/rerun-failed-jobs` — `gh run rerun --failed`.
  Powers the modal's "Re-run failed jobs" button when a run
  finishes non-success.
- `POST /__sugardeploy/tag-patch-version` — Release workspace's
  patch-tag flow: from a worktree at `v{N}.0.0`, creates
  `v{N}.0.M+1` at HEAD. Mirrors the Cut saga's tag-prior-major step
  but for patches (no metadata bump, just the tag).

### Documentation

- ADR 018 captures the architectural decisions this epic settles:
  Publish as a top-level productmode with a Studio-core baseline
  Package workspace; three additional SugarDeploy workspaces
  contributed for hosted-deploy cadence; GHA-driven deploy
  primitives with Studio-driven provisioning + release; publish-
  target plugin contract; per-version frontend deploys preserved
  forever; URL shape supports promote / drain; GHA secret bootstrap
  pattern.
- The plugin-generated `deployment/netlify/README.md` documents
  the bundle.
- The plugin-generated `.github/workflows/sugardeploy-deploy.yml`
  carries inline comments explaining each job.
- Updates `packages/plugins/src/deployment/README.md` to document
  the publish-target half + the workflow-generation discipline.
- Updates Plan 021 with a cross-reference.

### Tests

- `frontendDeploymentTargetHandlers` registry + normalizer
  round-trips.
- Plugin-generated `netlify.toml` + workflow YAML shape assertions.
- Build-config manifest baked into the player bundle has the
  expected gateway URL + version identity.
- `normalizeGameProject` lifts legacy `publishTargetId: "web"` from
  the deployment-settings slot into the new `publishSettings`
  slot — value stays `"web"` (publication medium), the Netlify
  half lives on the new frontend-deployment-target axis.
- Studio's mode-registry test asserts the Publish mode appears in
  the canonical order with at least the Studio-core Package
  workspace contributed.
- Without the SugarDeploy plugin: Publish productmode renders
  with only the Package workspace tab; Package builds a no-
  gateway artifact; Package is disabled when gateway-needing
  plugins are enabled.

## Verification

End-to-end exit criterion: with a clean wordlark at v1, the user
opens Studio, switches to the Publish productmode, completes the
Provision workspace's full setup (Create GCP Project → Setup Infra
→ Set Secrets → Setup GitHub Workflow), then in the Deploy workspace
clicks Deploy. The GHA workflow fires, runs the backend + frontend
jobs, and reports success in the Deploy workspace. Opening the per-
deploy Netlify URL in a browser loads the game; the game can hit
the gateway (e.g., NPC dialogue via the LLM proxy works). Cutting
v2 from the Release workspace + clicking Deploy produces a working
v2 on both halves; v1 keeps working at its per-deploy URL.
`git worktree add` at `v1.0.0` re-opens the v1 worktree in Studio
and SugarDeploy resolves back to v1 identity; a patch deploy from
that worktree updates v1's per-deploy slot without touching v2.

Pure-client baseline: a game with only client-side plugins enabled
opens Studio, switches to Publish, clicks Package in the Package
workspace, and gets a `targets/web/dist/` directory that runs in a
browser via `file://` or any static host. No SugarDeploy needed.

Contractor test: deleting `packages/plugins/src/catalog/sugardeploy/`
and `packages/plugins/src/deployment/` leaves the domain package
typechecking clean. The Publish productmode still renders in Studio
with the Package workspace tab; the Provision / Release / Deploy
tabs are absent because nothing is contributing them.

## Resolved Decisions

- **Publish is a top-level Studio productmode.** Named "Publish"
  rather than "Deploy" to avoid name-collision with the inner Deploy
  workspace SugarDeploy contributes, and because "publish" is the
  more inclusive verb — future native-game-store targets (Steam,
  itch.io, etc.) would fit under the same hat without another
  rename.

- **Studio core owns the productmode + a baseline Package
  workspace. Plugins contribute additional workspaces.** Package is
  the always-available pure-client publish path: one button, runs
  `targets/web/`'s Vite build with no gateway, outputs a static
  directory the user can host anywhere. Plugins layered on top
  (SugarDeploy and any future Steam / itch.io plugin) contribute
  their own workspaces into the same Publish productmode. Workspaces
  don't pre-exist as empty containers waiting for plugins —
  workspaces exist iff a contributor declares them.

- **SugarDeploy contributes three workspaces — Provision / Release /
  Deploy — for hosted-deploy cadence.** The cadence split maps to
  how often each surface is used: Provision is rare and hands-on;
  Release is occasional and deliberate; Deploy is many-times-a-day.
  This split lets the daily-driver Deploy surface get full attention
  without competing with rare provisioning UI, and matches how the
  wordlark-v1 manual workflow already chunked the work mentally.

- **Package gates itself on "no enabled plugin demands a gateway."**
  No special "no-gateway build mode" or runtime stubbing — the
  `targets/web/` build composes whatever plugins are enabled in
  `pluginConfigurations`. Gateway-needing plugins (SugarAgent, etc.)
  depend on SugarDeploy for their deploy-time fulfillment, so a
  pure-client build by definition has no gateway-needing plugins
  enabled. Package is disabled with a tooltip pointing at Deploy
  when any enabled plugin would need a gateway.

- **GitHub Actions runs the deploy primitives; Studio runs
  provisioning + release.** GHA's strengths (clean runner,
  reproducible build, retryable jobs, audit trail, WIF auth)
  match the deploy cadence; Studio's strengths (synchronous local
  shelling, no commit-and-wait latency, in-process state access)
  match the provisioning + release cadences. The generated
  `deploy.sh` from Plan 045 stays the canonical deploy primitive;
  GHA invokes it on a runner; Studio's `targets/web/` build pipes
  through too.

- **GHA bootstrap is automated via `gh secret set` + plugin-
  generated workflow YAML.** Same architectural shape as Plan 045's
  `gcloud secrets versions add` — the user needs `gh` on PATH and
  logged in (`gh auth login`, once), Studio shells `gh secret set
  ... < value` for the required secrets, values never enter Studio
  state. The user never edits GitHub repo settings directly.

- **Workflow YAML is a plugin-managed file** with the same header +
  template-version stamp + drift discipline as terraform. Plus a
  `WORKFLOW_RENAME_LEDGER` for breaking-change migrations.

- **Live URL shape is a subdomain on the marketing domain
  (`play.wordlarkhollow.com`).** Subdomain gives clean DNS
  separation, no coupling to the marketing site's host, Netlify
  handles per-subdomain SSL automatically. Per-version per-deploy
  URLs stay on Netlify's `<deploy-id>--<site>.netlify.app` form;
  the live alias subdomain CNAMEs to whichever per-version deploy
  is currently promoted.

- **First-party frontend deployment target is Netlify, named
  `"netlify"` in the `FrontendDeploymentTargetId` enum.** Per-deploy
  preserved-forever URL semantics match the version model exactly;
  production-promote API is one call; cert + CDN are automatic.
  Other hosts (Vercel, GCP Cloud Storage + Cloud CDN, etc.) are
  added via the same handler-contract pattern Plan 045 established
  for backend targets.

- **`PublishTargetId` and `DeploymentTargetId` are separate axes
  with separate enums.** Publish target is the publication medium
  (what the user plays on — `"web"` for v1, future `"mobile"` /
  `"steam"`). Deployment targets are where artifacts physically run
  (backend on Cloud Run / Local; frontend on Netlify / etc.). Each
  deployment-target handler declares `role: "backend" | "frontend"`
  in its definition, and the enums stay separated at the type level
  (`BackendDeploymentTargetId` vs `FrontendDeploymentTargetId`) so
  the type system enforces "a frontend slot can only accept a
  frontend-role target." This rejects an earlier proposal of
  collapsing publish + frontend host into a `"web-netlify"`
  composite value, which conflated two orthogonal axes and would
  have made cross-host publish target identity (e.g., a future
  game published to "web" AND "steam") incoherent.

- **Per-version frontend deploys are immutable; promote is
  separate from Deploy.** Every Deploy produces a new per-version
  Netlify deploy. The bundle's gateway URL + version identity are
  baked in. Promote-to-live is its own explicit action in the
  Deploy workspace (or a follow-up story); this epic prepares the
  data shape and exposes the per-version URLs but does not flip
  aliases automatically.

- **CORS allowed-origins include BOTH the per-deploy frontend URL
  AND the live alias domain.** Sessions loaded from the live alias
  keep working after promotion because the bundle has the per-
  deploy URL baked in while the gateway still accepts the alias's
  Origin header. This is what makes a drain window viable.

- **Engine bundle is game-agnostic; per-game data lives in
  `boot.json`.** The `targets/web/` Vite build produces a generic
  engine shell that knows nothing about the specific game it'll
  run. Per-game data (project identity, plugin configurations,
  mechanics, definitions, etc.) is serialized by SugarDeploy into
  `boot.json` at save time as a managed file
  (`.sugarmagic/published-web/boot.json` in the game repo). The
  GHA `deploy-frontend` job copies the committed boot.json into
  the engine bundle's directory before `netlify deploy`; the
  deployed page fetches it at the site root as a static asset. This
  splits the lifecycles cleanly: engine releases are a sugarmagic
  concern with their own cadence (see Plan 048); per-game data
  rides on game saves. An earlier proposal — bake the content into
  the engine bundle itself at build time — was rejected because it
  conflated the two lifecycles, forced every per-game data edit
  through a full engine rebuild, and required the engine build to
  see game content sources.

- **Push to git remote and promote-to-live are never automatic.**
  Same discipline Plan 045 established for Cut. Studio's Cut
  produces the tag locally; the user pushes when they mean to.
  GHA's `push: tags: ['v*']` trigger does mean that pushing the tag
  also fires a deploy — that's the deliberate path. Studio's
  Deploy button uses `workflow_dispatch` against the current ref
  for ad-hoc deploys that don't require a tag.

- **Dirty-tree-at-Deploy policy: refuse.** Deploy preflight
  enforces clean tree AND HEAD pushed to remote AND `gh` authed
  before dispatching. No auto-snapshot branch path. If your tree is
  dirty, commit (or stash) and push first, then click Deploy. This
  matches the "good hygiene" principle nikki articulated during
  46.10 — changes that get deployed are changes that have made it
  to a remote ref the deploy workflow can checkout.

- **Workflow YAML drift discipline: same shape as terraform
  drift.** On project open, Studio probes
  `.github/workflows/sugardeploy-deploy.yml` for its template-
  version stamp; if the on-disk value is older than the current
  generator's version, the Provision workspace shows a yellow
  "Workflow drift" alert. Save regenerates and clears it.
  `WORKFLOW_RENAME_LEDGER` exists for future job/step renames
  (currently empty).

- **GHA run-status polling cadence: 4 seconds, no backoff.** While
  a dispatched run is in flight, Studio polls `gh run view --json
  ...` every 4s and updates the per-job badges + history-row
  status inline. No backoff: the call is cheap, GitHub's API isn't
  rate-limited at this volume for solo-dev usage, and the snappy
  feedback matters more than batting average rate-limit defense.

- **Backend job auth scope: WIF principal stays the active
  identity, runtime SA only attaches via `--service-account`.**
  Setting `service_account: ${{ vars.SUGARMAGIC_RUNTIME_SA_EMAIL }}`
  on `google-github-actions/auth@v2` impersonates the runtime SA
  for ALL subsequent gcloud / docker calls — including the docker
  push to Artifact Registry, which the runtime SA isn't permissioned
  for. Leaving it off keeps the WIF principal as the active
  identity (it has `artifactregistry.writer` + `run.admin`); the
  runtime SA is attached to the Cloud Run service via
  `gcloud run deploy --service-account=...`, which works because
  the WIF principal has `serviceAccountUser` + `serviceAccountTokenCreator`
  on the runtime SA (the latter added in 46.10 specifically for
  this).

- **deploy.sh builds locally on whatever machine runs it.** The
  build step uses `docker build` + `docker push` (against the
  artifact registry, authed via `gcloud auth configure-docker`),
  NOT `gcloud builds submit`. Avoids needing the WIF principal to
  hold `serviceusage.services.use` (Cloud Build IAM) on the project
  and avoids round-tripping the source through Cloud Build's
  implicit source bucket. On GHA the runner builds; on local dev
  your laptop builds; either way `gcloud auth configure-docker`
  hands docker the right credentials.

- **deploy.sh resolves deploy-time values via env-or-terraform.**
  Reads `SUGARMAGIC_RUNTIME_SA_EMAIL`, `SUGARMAGIC_ARTIFACT_REGISTRY_URL`,
  and `SUGARMAGIC_ALLOWED_ORIGINS` from env first (the GHA workflow
  injects them since the runner has no terraform state); falls back
  to `terraform output -json` for any missing piece (local dev
  runs). `--set-env-vars` for the gateway env var uses gcloud's
  caret-delimiter form (`^@^KEY=value,value,value`) because commas
  in the env var value would otherwise collide with gcloud's
  default kvpair separator.

## Open Questions

- **Content-bake size budget.** Wordlark-scale content + assets
  could be hundreds of MB. Need a warning threshold and a story
  for what happens when bundle size crosses it (warn-on-build?
  fail-on-build? auto-split?). Cheap to pick a number now.

- **Where `liveDomain` lives in the plugin state slot.** Project-
  level (one alias per game), or per-publish-target. Likely
  project-level for v1.

- **Netlify auth model.** For solo-dev alpha the user's local
  `NETLIFY_AUTH_TOKEN` works. For future multi-developer setup
  we'd want a per-game team token. Initial implementation uses
  the local env var written to GitHub repo secrets via `gh secret
  set`.

- **Patch tagging UX.** `v1.0.1`, `v1.0.2`, etc. on a worktree at
  `v1.0.0`. Auto-increment from the existing patch tags, or user-
  specified? Almost certainly auto-increment (decided in 46.12).

- **Promote-to-live affordance shape.** Even though the action
  itself is a follow-up, do we show a stub button in the Deploy
  workspace with "wired in plan 04X" copy (like 45.8.5's stubs),
  or leave the affordance absent until the follow-up lands?

- **Per-deploy URL surfacing.** Story 46.10 originally promised to
  parse the Netlify deploy URL and Cloud Run revision URL out of
  the GHA logs and surface them in the per-deploy history row. We
  shipped 46.10 with the history row linking to the GHA run page
  instead and deferred the URL parsing. Worth doing if it stops
  being "click through, scroll the logs."

## Stories

Stories are ordered for solo-dev linear execution; numeric order is
execution order. The Deliverables section above is the master detail;
per-story descriptions stay light and lean on Deliverables by topic
rather than restating them. Each story has an explicit **Exit**
criterion that leaves the codebase in a working, verifiable state.

Dependency shape: 46.1, 46.2, and 46.3 are independent and can land
in any order (or in parallel if there were multiple developers).
46.4 needs 46.3 (config wiring needs the render path it configures).
46.5 needs 46.1 (workspaces need the productmode registry to land
into). 46.6 needs 46.2 + 46.5 (publish settings + a workspace home
for its Publish Targets tab list). 46.7 needs 46.4 + 46.6 (build
inputs + managed-files discipline). 46.8 needs 46.5 + 46.7. 46.9
needs 46.6. 46.10 needs 46.5 + 46.7 + 46.8. 46.11 needs 46.6 + 46.7.
46.12 needs 46.5. 46.13 is the final docs pass after everything else.

Two natural checkpoints partway through:

- **After 46.4 (the "pure-client checkpoint")**: a game with only
  client-side plugins enabled can be packaged into a static directory
  via Studio's Package button and hosted manually. Studio's preview
  also gets fidelity gains because both paths import the same
  `@sugarmagic/target-web` module.
- **After 46.10 (the "GHA-driven deploy checkpoint")**: wordlark v1
  is shippable end-to-end with one button: SugarDeploy's three
  workspaces are live, the GHA workflow runs, both halves deploy to
  Cloud Run + Netlify, and the per-deploy URL serves a playable game
  with the gateway wired.

### 46.1 — Publish productmode + Package baseline workspace (Studio core)

Adds a new top-level productmode `publish` to `packages/productmodes`
alongside Design / Build / etc., plus the chrome wiring in
`apps/studio` to surface it in the top nav. The productmode renders
whatever workspaces have been contributed with
`productMode: "publish"`; Studio core itself contributes ONE
workspace — `package` — into the new mode.

The Package workspace's body is a single button labeled "Package"
plus a brief explainer (one or two sentences) of what gets produced
and where it lands. Clicking the button shells `pnpm --filter
@sugarmagic/target-web build` via a new host action
(`/__sugardeploy/package-pure-client`); on success it surfaces the
absolute path to `targets/web/dist/` and the artifact size. The
button is disabled with a tooltip pointing at SugarDeploy's Deploy
workspace whenever any enabled plugin in `pluginConfigurations`
declares a deployment requirement of kind `proxy-route` or `secret`
(those are the gateway-needing requirements per the deployment plan
model from Plan 021).

This story does NOT need `targets/web/` to render real games —
the placeholder card output is fine for the v1 of the button.
Story 46.3 makes the output actually be a playable game.

**Exit:** with Studio open and any project loaded, clicking the new
"Publish" entry in the top nav switches to the Publish productmode
and surfaces a "Package" tab; clicking the Package button on a
project that has no gateway-needing plugins enabled produces a
`targets/web/dist/` directory (containing today's placeholder card)
and surfaces the path + size in the UI; on a project with
SugarAgent (or another gateway-needing plugin) enabled, the button
is disabled with a tooltip pointing the user at "SugarDeploy's
Deploy workspace (after install)". Uninstalling the SugarDeploy
plugin from the workspace leaves the Publish productmode visible
with ONLY the Package workspace tab. The mode-registry test asserts
the canonical order of productmodes.

### 46.2 — Plugin-state migration for publish settings

Extends the SugarDeploy plugin state slot (the
`pluginConfigurations[].config` shape established in 45.7.5) with a
new `publishSettings` field carrying publish-medium-level concerns
parallel to `config.settings` on the deployment-target side. Defines
the `PublishTargetId` typed enum (initially `"web"` — the publication
medium), the `PublishTargetSettings` type carrying `publishTargetId`
+ `liveDomain`, and the helpers `getPublishSettings(gameProject)` /
`buildUpdatePublishSettingsCommand(gameProject, settings)` exported
from `packages/plugins/src/deployment/plugin-state.ts`. Drops
`publishTargetId` from the `DeploymentSettings` interface in domain
(it never belonged on the deployment-target side).

Legacy migration: pre-046 projects carry `publishTargetId: "web"` on
the deployment-settings slot (via 45.7.5's lift of the original
`gameProject.deployment` shape). `getPublishSettings` reads from
the new `config.publishSettings` slot, falls back to lifting the
legacy field value from `config.settings.publishTargetId`. The value
itself stays `"web"` — publishTargetId is the publication medium,
not the host (the orthogonal frontend-deployment-target axis with
Netlify / Vercel / etc. lands in later 046 stories). Same forward-
only pattern 45.7.5 established.

**Exit:** opening a pre-046 project file (with `publishTargetId:
"web"` on the legacy `config.settings` slot) loads cleanly;
`getPublishSettings(gameProject)` returns `{ publishTargetId: "web",
liveDomain: "" }`; saving rewrites `project.sgrmagic` with the new
`config.publishSettings` slot AND the legacy field removed from
`config.settings`. `DeploymentSettings` in domain no longer declares
`publishTargetId`. The deployment package's typecheck is clean. New
test in `packages/testing/src/plugin-infrastructure.test.ts` covers
the legacy lift, the new-shape round-trip, the default shape, and
the `buildUpdatePublishSettingsCommand` payload shape.

### 46.3 — `targets/web/` finishing: real game render path

Replaces the placeholder card in `targets/web/src/App.tsx` with a
real game-render composition. The App fetches `/boot.json` from
the deployed origin at runtime and instantiates `runtime-core` +
`render-web` through `@sugarmagic/target-web`'s existing
`createWebRuntimeHost`.

Boot-data path forks on `hostKind`:
- `hostKind === "studio"`: keep the existing `postMessage`
  `PREVIEW_BOOT` flow (Studio sends the project state as a
  message from the opener window — no fetch).
- `hostKind === "published-web"`: fetch `/boot.json` from the
  Netlify site root. The file is a per-game data payload generated
  by SugarDeploy at save time (see 46.10.5 for the managed-file
  bake); the engine bundle itself is game-agnostic.

Studio's existing preview window keeps working unchanged because
it stays on the `hostKind === "studio"` branch. The published-web
branch is new but composes the same `runtime-core` + `render-web`
+ enabled plugins, so behavioral parity is structural.

**Exit:** `targets/web/src/App.tsx` no longer renders the
placeholder card. Instead it mounts a runtime root, instantiates
`createWebRuntimeHost` with `hostKind: "published-web"`, fetches
`/boot.json`, and calls `host.start(parsedState)`; renders loading
+ error overlays for the in-flight + failed paths. Workspace
typecheck stays clean. The intended way to preview a published
build is the Package button (46.1) or the GHA-driven Deploy
(46.10), not the raw Vite dev server. Studio's preview window
keeps using `apps/studio/src/preview.ts` (`hostKind: "studio"` +
postMessage), unchanged.

### 46.4 — Build-time config wiring for `targets/web/`

Adds the Vite env var schema `targets/web/` expects:
`SUGARMAGIC_GATEWAY_URL`, `SUGARMAGIC_GATEWAY_BEARER_TOKEN`
(optional, only set when `gatewayAuthMode === "bearer"`),
`SUGARMAGIC_GIT_SHA`, `SUGARMAGIC_BUILD_TIMESTAMP`. Game-identity
fields (`majorVersion`, versioned slug) are NOT build-time env
vars — they live in `boot.json` per 46.3's split. The build-
config manifest is written into the bundle so the Version panel
(45.8.5) can later display deployment provenance and runtime can
use the gateway URL for plugin calls.

Plugin runtime wiring: enabled plugins that need a gateway (e.g.,
SugarAgent's LLM proxy) consume the `SUGARMAGIC_GATEWAY_URL`
through `target-web`'s plugin-runtime-host context (mirrors the
Studio dev path that proxies through Vite — same plugin API
shape, different transport).

For Package's no-gateway build: the env vars are absent; the
plugin runtime host sees no gateway URL and any plugin that
demanded one would have already been blocked at Package's
enabled-plugin gate.

**Exit:** building `targets/web/` with all the env vars set
produces a bundle that, when served alongside a real
`boot.json`, renders the game AND successfully calls a
configured gateway URL for any gateway-needing enabled plugin's
routes; building without gateway env vars produces a bundle that
renders pure-client content. The build-config manifest baked into
the bundle has the expected fields and round-trips through a test.

### 46.5 — Plugin workspace reshuffle (Provision / Release / Deploy)

Splits today's single SugarDeploy workspace
(`apps/studio/src/plugins/catalog/sugardeploy/index.tsx`) into
three workspace contributions, all with `productMode: "publish"`:

- **`provision`** — Sources panel (Working Directory, GitHub Repo),
  Create GCP Project button, Setup Infra button, Set Secrets
  section, the upcoming Setup GitHub Workflow button (stubbed for
  now; lands in 46.9), Teardown Infra button.
- **`release`** — Version panel + Release New Version (Cut) flow
  (the saga from 45.8 unchanged), version history list, the
  upcoming Tag Patch Version button (stubbed for now; lands in
  46.12).
- **`deploy`** — the Action Bar's Deploy button (still wired to
  Plan 045's `/__sugardeploy/action` for now; 46.10 swaps it to
  GHA), Health + Status chips, per-deploy history (stub).

No new functionality lands; this story is pure relocation of
existing affordances. The Action Bar's combo context (version +
publish target + deploy target) appears in each workspace at the
top so the user always sees what they're operating on. The
Targets section (Local / Google Cloud Run tabs) lives in
Provision.

**Exit:** opening a project with SugarDeploy installed shows
four tabs under Publish — Package + Provision + Release + Deploy
— each rendering its slice of the existing Plan 045 UI. Existing
behavior is preserved: clicking Deploy still ships via
`gcloud run deploy` (the 045 path); clicking Cut still runs the
45.8 saga. The Studio's existing Plan 045 tests pass with the
workspace reshuffle in place. The `productmode` registration
test asserts SugarDeploy's three workspaces appear in the right
order.

### 46.6 — `FrontendDeploymentTargetId` enum + `netlify` handler

Introduces the frontend-deployment-target axis. Adds
`FrontendDeploymentTargetId` enum (initially `"netlify"`),
`frontendDeploymentTargetId: FrontendDeploymentTargetId | null` on
`DeploymentSettings` parallel to the existing
`backendDeploymentTargetId` (which is the existing
`deploymentTargetId` renamed for symmetry — single migration on
DeploymentSettings to do both renames at once).

Adds a `frontendDeploymentTargetHandlers` registry in
`packages/plugins/src/deployment/` parallel to the existing
backend `targetHandlers`. Each entry exposes `definition` (id +
displayName + summary + `role: "frontend"` + implemented),
`normalizeOverrides`, optional `collectWarnings`, and
`buildManagedFiles`. The single concrete handler is `"netlify"`:

- `normalizeOverrides`: validates `siteId` (UUID-ish), `siteName`
  (optional), `productionContext` enum.
- `buildManagedFiles`: emits `deployment/netlify/netlify.toml`
  (with the right `[build]`, `publish`, and `[[redirects]]`
  blocks for a SPA), `deployment/netlify/build-config.json`
  (consumed by the GHA workflow at build time — captures gateway
  URL, version identity, etc.), and `deployment/netlify/README.md`
  (explains what's generated, what env vars are baked in, manual
  fix-up commands). All carry the `# GENERATED BY SUGARMAGIC`
  header and the `# SUGARMAGIC FRONTEND TEMPLATE VERSION: NN`
  stamp. New `FRONTEND_RENAME_LEDGER` parallel to
  `TERRAFORM_RENAME_LEDGER` (currently empty — no renames yet).

The Provision workspace's Targets section grows TWO tab strips
(landing in this story): one for backend targets (Local + Cloud
Run from Plan 045) and one for frontend targets (Netlify). Each
gets a `+` for adding new entries to its respective axis.

**Exit:** with `frontendDeploymentTargetId: "netlify"` set on a
project, saving regenerates `deployment/netlify/netlify.toml` and
`build-config.json` with the right shape (snapshot test in
`packages/testing/src/plugin-infrastructure.test.ts`). The
Provision workspace's Targets section renders the two parallel
tab strips. Values persist via the same
`buildUpdateDeploymentSettingsCommand` flow (the new field lives
on `DeploymentSettings`, same write path as everything else there).
Uninstalling SugarDeploy removes the regenerated files on next
clean-build (they don't re-appear).

### 46.7 — `.github/workflows/sugardeploy-deploy.yml` generation

Adds the plugin-generated GHA workflow YAML to the managed-files
output. The workflow has two jobs:

- `deploy-backend`: checkout, auth to GCP via WIF, `gcloud auth
  configure-docker`, docker build, push to Artifact Registry,
  `gcloud run deploy` (the same `deploy.sh` from Plan 045, called
  here, not duplicated).
- `deploy-frontend`: checkout, set up Node, `pnpm install`, build
  `@sugarmagic/target-web` with all the env vars from
  `deployment/netlify/build-config.json`, copy game-root content
  into the build inputs (project.sgrmagic, content library,
  regions, assets), `npx netlify deploy --site=<id> --dir=...
  --prod-if-unlocked` (auth via `NETLIFY_AUTH_TOKEN` repo secret).

Triggers: `on: push: tags: ['v*']` AND `on: workflow_dispatch:
inputs: { ref: ... }`. Both reach the same jobs. The
`needs:` ordering between the two jobs is a scoping call
(probably backend first to ensure CORS / URL is current, then
frontend); decided in implementation.

Header + `# SUGARMAGIC WORKFLOW TEMPLATE VERSION: NN` stamp +
`WORKFLOW_RENAME_LEDGER` are stamped on every regeneration.
Drift discipline: on save, regenerate; if hand-edits are
detected, show a banner in the Provision workspace (same shape
as the terraform drift banner from 45.7).

**Exit:** saving a project with SugarDeploy enabled regenerates
`.github/workflows/sugardeploy-deploy.yml` with the right shape
(snapshot test); the YAML is valid (passes `actionlint` if
installed locally), invokes the right `deploy.sh` for backend
and the right Netlify command for frontend, references the
right WIF + secret env names. Hand-edit the template-version
stamp to one less than current; re-opening shows the drift
banner in the Provision workspace. Save clears the banner.

### 46.8 — Setup GitHub Workflow Provision-workspace button

Wires the stub from 46.5 to a real host action
`POST /__sugardeploy/setup-github-workflow`. The endpoint:

1. Verifies `gh` is on PATH (`ensureBinaryOnPath`) and
   authenticated (`gh auth status`).
2. Verifies the project's GitHub Repository field is set.
3. Reads terraform outputs for `wif_provider` and
   `runtime_service_account_email` (via `terraform output -json`
   shelled in the workingDirectory).
4. Prompts the user via the existing Set Value modal for
   `NETLIFY_AUTH_TOKEN` (one-time). Value never enters Studio
   state; piped to `gh secret set ... < value`.
5. Sets the three required GitHub repo secrets via `gh secret set`
   with stdin piping: `NETLIFY_AUTH_TOKEN`, `GCP_WIF_PROVIDER`,
   `GCP_SA_EMAIL`.
6. Verifies the WIF binding from the terraform output matches the
   repo's owner/repo from the GitHub Repository field.

Idempotent: re-running re-syncs secrets and re-verifies WIF. The
workflow YAML itself is already on disk from 46.7's
managed-files regeneration; this action just makes sure
GitHub-side state matches.

**Exit:** with terraform + gcloud + gh installed and authed and
a wordlark project with all fields filled, clicking Setup
GitHub Workflow in the Provision workspace prompts for
NETLIFY_AUTH_TOKEN once, sets the three secrets via the GitHub
API (verifiable via `gh secret list`), and the WIF binding
matches the configured repo. Re-clicking is a no-op (idempotent).
Running on a project without the GitHub Repository field set
fails with a clear error pointing the user at Sources.

### 46.9 — CORS plumbing: backend learns frontend origin

Threads the per-version frontend origin (per-deploy Netlify URL
+ live alias domain) into the backend's CORS allowed-origins
list. Implementation pieces:

- Add `allowedOrigins: string[]` derivation to
  `GoogleCloudRunDeploymentTargetOverrides`. Auto-populated
  from: (a) the Netlify per-deploy URL pattern
  `https://<deploy-id>--<site>.netlify.app` and the project's
  `liveDomain` if set, (b) any explicit additional origins the
  user wants to allow.
- Thread `allowedOrigins` into `terraform.tfvars` (new variable)
  and through to `deploy.sh`'s `--set-env-vars` as
  `SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS` (comma-separated).
- Gateway runtime (the generated `server.mjs`) reads the env var,
  parses it, and adds `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Credentials`, and the required
  `Vary: Origin` header on every response.
- `TERRAFORM_RENAME_LEDGER` entry for the new variable.

CORS preflight handling: the gateway responds to OPTIONS
requests with the right ACAO and Access-Control-Allow-Methods /
Access-Control-Allow-Headers values inferred from the request.

**Exit:** with wordlark deployed (post-Setup Infra + Deploy) and
the gateway running, a `curl -H "Origin:
https://wordlark-v1-abcde--wordlark.netlify.app" <gateway-url>/health`
returns `Access-Control-Allow-Origin:
https://wordlark-v1-abcde--wordlark.netlify.app`. A request from
an origin NOT in the allowed list does NOT echo that origin.
Snapshot tests of `terraform.tfvars` and the gateway's
`server.mjs` cover the new env var. The
`PUBLISH_TARGET_RENAME_LEDGER` is empty (no renames yet); the
`TERRAFORM_RENAME_LEDGER` gains its first non-empty entry for
the new variable, exercising the `moved {}`-emission path in
real use.

### 46.10 — Deploy workspace fires GHA `workflow_dispatch`

Replaces the Deploy workspace's existing `gcloud run deploy`
call with a `gh workflow run` invocation. New host actions:

- `POST /__sugardeploy/preflight-deploy-workflow` — runs the
  git/gh checks (clean tree, HEAD pushed to remote, gh authed,
  `githubRepo` set). Returns `{ ok, ref, headSha }` for the
  confirm modal.
- `POST /__sugardeploy/dispatch-deploy-workflow` — re-runs
  preflight server-side (race-safe), then `gh workflow run
  sugardeploy-deploy.yml --ref <branch>`, polls `gh run list` to
  resolve the freshly-created run id + URL. Returns `{ runId,
  runUrl, ref, headSha }`. **Refuses on dirty tree or unpushed
  HEAD** — no auto-snapshot branch path; the user must commit
  (or stash) and push first. This is the deliberate "what gets
  deployed is what's on a remote ref" hygiene.
- `POST /__sugardeploy/get-deploy-workflow-status` — `gh run
  view --json status,conclusion,jobs,url,...`. Returns normalised
  `{ status, conclusion, url, jobs }`. Empty-string `conclusion`
  is normalised to `null` server-side so downstream UI can rely
  on `=== null` meaning "in flight." Studio's Deploy workspace
  polls every 4s.
- `POST /__sugardeploy/rerun-failed-jobs` — `gh run rerun --failed`.

Deploy workspace UI:
- Pre-flight check on click: shows the ref that'll be deployed
  (HEAD sha, branch, repo). Single confirm modal before dispatch.
  If preflight returns ok=false, surfaces the reason inline
  (commit + push, gh auth, etc.) and lets the user retry after
  fixing it.
- During run: per-job progress alerts, link out to GHA UI for
  full logs, "Re-run failed jobs" button when conclusion is
  non-success.
- After completion: history-row links to the GHA run page (the
  Netlify per-deploy URL + Cloud Run revision URL are deferred to
  a follow-up that parses them from logs — see Open Questions).

**Exit:** clicking Deploy in the Deploy workspace on a clean
tree + pushed HEAD fires a GHA run; the workspace polls the
status and surfaces per-job progress until the run completes; on
a dirty tree or unpushed HEAD, the modal refuses with a clear
"commit + push" message. The "Re-run failed jobs" button works.
The existing `gcloud run deploy` synchronous path is removed
(it's now in GHA). Destroy stays inline (it's gcloud-only and
doesn't need a GHA round-trip).

### 46.10.5 — Boot.json + engine-bundle managed-files pattern

Mid-46.10 we noticed `targets/web/`'s production build wanted
game-content baked in but had no source for it; the cleanest fix
turned out to be splitting the engine bundle from the per-game
data entirely. Boot.json becomes a SugarDeploy-managed file, and
the engine bundle gets staged into the game repo by a Studio
button (the "build it and commit it" stopgap that Plan 048
replaces).

Pieces:

- New `packages/plugins/src/deployment/published-web.ts` with
  `BOOT_JSON_SCHEMA_VERSION`, `buildPublishedWebManagedFiles`
  (emits `boot.json` + a README into
  `.sugarmagic/published-web/`).
- `planGameDeployment` calls it when a frontend target is set.
  Save regenerates boot.json.
- New host action `POST /__sugardeploy/build-published-web` runs
  `pnpm --filter @sugarmagic/target-web build` in the Studio's
  sugarmagic checkout root and copies the dist into the game
  project's `.sugarmagic/published-web/dist/`.
- New "Build Frontend" button in the Provision workspace (only
  visible when Netlify is the frontend target) triggers the
  build action.
- The deploy-frontend GHA job is simplified to a thin
  checkout + `cp boot.json into dist/` + `netlify deploy --dir=.sugarmagic/published-web/dist`.
  No engine install / vite build / gateway URL plumbing in the
  runner.

**Exit:** saving a project with Netlify configured produces
`.sugarmagic/published-web/boot.json` carrying the game's
runtime payload with a `schemaVersion: 1` stamp. Clicking Build
Frontend in Provision populates `.sugarmagic/published-web/dist/`
with the engine bundle. The deploy-frontend job runs in ~30s
(no install, no build).

This story's outputs are a stopgap; Plan 048 replaces the
"Build Frontend button + committed dist/" with a manually-
released GHCR pull. The boot.json managed-file pattern stays.

### 46.11 — Cut saga managed-files coverage (verification)

Now that 46.6 / 46.7 / 46.10.5 made the publish-side artifacts
(`deployment/netlify/*`, `.github/workflows/sugardeploy-deploy.yml`,
`.sugarmagic/published-web/boot.json` + `README.md`) regular
managed files in `plan.managedFiles`, the Cut saga's existing
`saveProjectWithManagedFiles` step already regenerates them on
the bump commit — there's no new commit-side logic to write.
This story is purely verification: the test suite asserts the
Cut saga's commit diff covers the new files, and the Cut UI's
post-commit summary lists them.

**Exit:** running the Cut saga on a wordlark v1 project produces
a single commit `chore: bump major version to 2` that contains:
the bumped `project.sgrmagic` (with the new
`versionedProjectIdentifiers[v2]` suffix in the plugin slot), the
regenerated terraform + deploy.sh (per Plan 045), the regenerated
`deployment/netlify/*` files (now pointing at the v2 Netlify
site config), the regenerated
`.github/workflows/sugardeploy-deploy.yml` (template-version
stamp updated, references the new major's resource names), and
the regenerated `.sugarmagic/published-web/boot.json` (with v2
identity stamps). The `git tag v1.0.0` is still placed at the
pre-bump HEAD. Existing 45.8 tests are expanded to cover the
new managed-files list.

### 46.12 — Release workspace Tag Patch Version flow

Implements the patch-tag flow promised in 46.5's stub. New host
action `POST /__sugardeploy/tag-patch-version`:

- Pre-flight: `gh` on PATH, working tree clean, the worktree's
  HEAD is reachable from a `v{N}.0.0` tag (i.e., we're on a major
  version), the next available patch tag (`v{N}.0.M+1` where M is
  the highest existing patch tag for this major).
- On confirm: `git tag v{N}.0.M+1 HEAD`. No bump to
  `majorVersion`, no plugin-state changes — patches don't roll
  the suffix or change identity, they're commits anchored to the
  same major's Cloud Run + Netlify slot.

Release workspace UI: a "Tag Patch Version" button alongside
"Cut New Major Version" (already there from 45.8). Patch tags
render in the version history list as sub-items under their
major's row.

Pushing the new patch tag (`git push --tags`) fires the GHA
workflow's tag-trigger, which redeploys the matching major's
slot with the new commit. The user gets a "Push tag to deploy"
affordance in the Release workspace post-tag-creation, mirroring
the post-Cut affordance.

**Exit:** in a worktree at v1.0.0 with a clean tree, clicking
Tag Patch Version creates a `v1.0.1` tag at HEAD; tests cover
the auto-increment from existing tags (v1.0.1 → v1.0.2 → v1.0.3).
Push the tag; the GHA workflow's tag trigger fires; the
deploy targets v1's Cloud Run + Netlify slot (per the
worktree's `majorVersion: 1`).

### 46.13 — Documentation pass

Writes ADR 018 capturing the architectural decisions this epic
settles: Publish productmode with Studio-core baseline; plugins
contribute additional workspaces; SugarDeploy's three-workspace
cadence model; GHA-driven deploy primitives with Studio-driven
provisioning + release; publish-target plugin contract;
per-version frontend deploys preserved forever; URL shape
supports promote / drain; GHA bootstrap pattern (vars for
identifiers, secrets for credentials, piped via stdin); the
publish + workflow template-version + drift-banner discipline;
deploy-time IAM scope (WIF principal stays active for build /
push, runtime SA attaches via `--service-account`); env-vars-or-
terraform pattern in deploy.sh.

Writes ADR 019 capturing the engine-vs-game lifecycle split:
the engine bundle is game-agnostic; per-game data lives in a
SugarDeploy-managed `boot.json`; engine releases are a sugarmagic
concern with their own cadence (Plan 048's manual GHCR publish
workflow) while game deploys consume a pinned engine version.
Cross-references Plan 048 for the production engine-versioning
design.

Updates `packages/plugins/src/deployment/README.md` to document
the publish-target half (file layout for the new managed-files
directories, the `frontendDeploymentTargetHandlers` registry, the
`FRONTEND_RENAME_LEDGER` + `WORKFLOW_RENAME_LEDGER` conventions,
the host endpoints for publish-side actions, the
`BOOT_JSON_SCHEMA_VERSION` constant).

The plugin-generated `deployment/netlify/README.md` and
`.sugarmagic/published-web/README.md` carry their own operational
guides.

Updates Plan 021 with a "Web publish target implementation: see
Plan 046 and ADR 018; engine-versioning model: see Plan 048 and
ADR 019" cross-reference.

Updates `targets/web/README.md` to describe the dual-mode boot
(Studio preview vs. published-web), the build-time env var
schema, the boot.json contract, and the `BOOT_JSON_SCHEMA_VERSION`
runtime assertion.

**Exit:** ADR 018 + ADR 019 exist and are internally consistent
with Plan 046 + Plan 048. `packages/plugins/src/deployment/README.md`
reflects current behavior including the new ledgers + the
publish-target handler API + the boot.json pattern. The plugin-
generated READMEs reflect current state. Plan 021 carries both
cross-references at the top.

The promote-to-live + drain-old-version stories are a follow-up
epic that builds on the URL + version shape this epic
establishes. The engine-versioning production design is Plan
048.

### 46.14 — Plugin runtime context: browser-only-talks-to-proxy

Removes a security-anti-pattern vestige from gateway-routed
plugins (SugarAgent, Sugarlang) and codifies the canonical
runtime-context shape so future plugins follow the same pattern.

**The vestige:** SugarAgent's runtime currently has a fallback
"direct API" code path that reads `anthropicApiKey` /
`openAiApiKey` / `openAiVectorStoreId` straight from
`pluginRuntimeEnvironment` (sourced from `VITE_SUGARMAGIC_*` build-
time env vars) and calls Anthropic / OpenAI directly from the
browser. That works in Studio dev (where the keys live in the
repo-root `.env`) but is wrong by design — in any deployed bundle
those keys are extractable from the JS source by anyone hitting
"view source." The path predates the gateway and should never
have survived into the production-deploy plan. Sugarlang has the
same vestige.

**The correct shape:**

- Browser code (Studio's preview AND the deployed published-web
  bundle) NEVER holds raw third-party API keys. Period.
- Browser code only knows two things per gateway-routed plugin:
  - a **proxy base URL** (`SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL`),
  - and (when the plugin's gateway routes use bearer auth) a
    **shared bearer token** (`SUGARMAGIC_GATEWAY_BEARER_TOKEN`).
- The proxy sits between browser and third-party APIs and is the
  ONLY thing that reads the real API keys. In Studio dev mode the
  proxy is Studio's vite-dev-server middleware (the keys live in
  the repo-root `.env`); in published-web mode the proxy is the
  deployed Cloud Run gateway (the keys live in Secret Manager).
  Same plugin runtime code in both modes; only the proxy URL
  changes.

**Deliverables:**

- Delete `anthropicApiKey`, `openAiApiKey`, `openAiVectorStoreId`
  from `SugarAgentPluginConfig`'s runtime shape. Delete the
  `usingProxy` fork in SugarAgent's `createRuntimePlugin` — there
  is only proxy mode now. The plugin requires
  `SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` to be set at runtime; if
  it's missing, the plugin throws with a clear "wire up the
  proxy URL — see plugin SDK docs" message instead of falling
  through to a direct-call path.
- Same treatment for Sugarlang: delete its direct-API fallback;
  require `SUGARMAGIC_SUGARLANG_PROXY_BASE_URL`.
- Verify (or add) Studio's vite-dev-server middleware routes for
  the per-plugin proxy: when SugarAgent points at
  `/__plugin-proxy/sugaragent/...`, Studio's middleware reads
  the local `.env` keys and proxies the request to Anthropic /
  OpenAI. This is the dev-time equivalent of the deployed Cloud
  Run gateway.
- Set the Studio-dev default for `SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL`
  to the local middleware path so plugins boot correctly in Studio
  without any extra config. The `.env`'s `VITE_SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL`
  override stays available for connecting Studio to a remote
  gateway during testing.
- SugarDeploy's Build Frontend host action (the 46.10.5 stopgap)
  resolves the published-web env vars at build time:
  - `VITE_SUGARMAGIC_GATEWAY_URL` — via
    `gcloud run services describe <gateway-service>
    --format='value(status.url)'`.
  - `VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN` — via
    `gcloud secrets versions access latest
    --secret=<gateway-shared-token>` when `gatewayAuthMode ===
    "bearer"`.
  - `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL` and
    `VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL` default to the
    gateway URL when not otherwise set.
  - `VITE_SUGARMAGIC_GIT_SHA` / `VITE_SUGARMAGIC_BUILD_TIMESTAMP`
    — easy locals.
- All of the above pass to `pnpm --filter @sugarmagic/target-web
  build` as process env so Vite inlines them. Plan 048's GHCR
  publish workflow does the SAME resolution (engine bundle still
  needs the same env vars baked in; the engine doesn't change
  per-deploy but its config does).
- Plugin-SDK docs section explaining the canonical contract:
  "If your plugin needs to call a third-party API, declare a
  `<plugin>_PROXY_BASE_URL` runtime env key, ALWAYS route through
  it, and NEVER read raw API keys in browser code. Studio's vite
  middleware + the deployed gateway both terminate the proxy and
  hold the real keys. Future plugins follow this pattern without
  re-asking how."

**Exit:** SugarAgent + Sugarlang both run cleanly in Studio
preview (proxying through vite middleware to the local `.env`-
sourced keys) and on a deployed Netlify URL (proxying through
the Cloud Run gateway to the Secret Manager-sourced keys) with
the SAME plugin runtime code. The deployed JS bundle, viewed by
Source, has no Anthropic / OpenAI API keys in it. A test fixture
that boots SugarAgent in published-web mode without a proxy URL
configured fails cleanly with the documented error message.

### 46.15 — Per-game plugin config as source of truth for gateway runtime

(Reshape — originally drafted as "Non-secret runtime env plumbing
for the gateway" with `.env` as the source of truth. Stepping
back: env vars were a stopgap when Studio had no plugin config
surface and no deploy infrastructure. Now that we have both, the
right home for per-game plugin settings is the per-game project
state — `pluginConfigurations[<plugin>].config` — surfaced in
Studio's plugin settings panel, committed with the game,
propagated to Cloud Run via the existing deploy pipeline. Env
vars become a propagation mechanism, not a source of truth.)

**The problem this solves:**

The gateway's server-side handlers need non-secret config values
(vector store id, model identifiers, target language). Story
46.14 removed the browser-side path that fed these — they now
live ONLY on the gateway. But the gateway has no automatic way to
get them; `deploy.sh`'s `--set-env-vars` only carried
`SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS`. Result: gateway returns 400
on every request that needs e.g. a vector store id, and the
SugarAgent pipeline cascades to its canned-fallback reply.

**The design — taxonomy first:**

- **Per-game plugin settings.** Vector store id (each game has its
  own lore corpus -> its own OpenAI vector store), target
  language, optional model overrides. Live in
  `pluginConfigurations[<plugin>].config`. Surfaced in Studio's
  plugin settings panel. Committed with the game's project file.
- **Plugin-coded defaults.** Anthropic model
  (`claude-sonnet-4-5`), embedding model
  (`text-embedding-3-small`). Hardcoded in the plugin's
  `defaultConfig`; per-game overrides allowed via the settings
  panel.
- **Secrets.** API keys. Stay in Secret Manager via the existing
  `SecretRequirement` contract — never in plugin config, never
  in `.env`, never in git.
- **Sugarmagic-shared runtime config.** `SUGARMAGIC_GATEWAY_URL`,
  `_BEARER_TOKEN`, `_ALLOWED_ORIGINS`. Not plugin-owned; stays
  the way it is (derived at deploy time from terraform / Cloud
  Run state).

**The contract:**

- New optional field on `DiscoveredPluginDefinition`:
  `gatewayRuntimeConfigKeys: GatewayRuntimeConfigKey[]`. Each
  entry declares one per-game config key the plugin wants
  propagated to the gateway env at deploy time.
  ```ts
  interface GatewayRuntimeConfigKey {
    /** Property name on the plugin's config object. */
    configKey: string;
    /** Env var name the gateway server-side reads. Must follow
     *  the convention SUGARMAGIC_<PLUGIN>_<KEY>; the validator
     *  enforces this. */
    envVarName: string;
    /** What it carries; surfaced as the field's help text in
     *  the auto-rendered settings panel. */
    description: string;
    /** Plugin author's explicit attestation that this value is
     *  non-secret. Same backstop as the original 46.15 draft. */
    nonSecretAttestation: "safe-to-expose-publicly";
  }
  ```
- The `runtime-config` `DeploymentRequirement` kind introduced
  in the original 46.15 draft is REMOVED — the new field
  supersedes it. Requirements were the wrong shape because they
  didn't carry the link to the actual per-game value; the new
  field carries both the schema declaration AND the
  config-key-to-env-name mapping.
- Plugins declare their settings UI shape via their existing
  Studio-side plugin contribution (e.g., SugarAgent already
  renders its own settings panel at
  `apps/studio/src/plugins/catalog/sugaragent/index.tsx` — it
  just gains new fields wired to the new config keys).

**SugarAgent's declarations:**

- `gatewayRuntimeConfigKeys`:
  - `{ configKey: "openAiVectorStoreId", envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID", ... }`
  - `{ configKey: "anthropicModel", envVarName: "SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL", ... }`
  - `{ configKey: "openAiEmbeddingModel", envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_EMBEDDING_MODEL", ... }`
- New fields on `SugarAgentPluginConfig`:
  - `openAiVectorStoreId: string`
  - `anthropicModel: string` (default `"claude-sonnet-4-5"`)
  - `openAiEmbeddingModel: string` (default `"text-embedding-3-small"`)
- SugarAgent's existing settings panel gains text inputs for
  these. Default values appear as placeholders; user overrides
  persist to plugin config.

**Sugarlang's declarations:**

- `gatewayRuntimeConfigKeys`:
  - `{ configKey: "targetLanguage", envVarName: "SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE", ... }`
- New field on `SugarlangPluginConfig`:
  - `targetLanguage: string` (default `""` — empty disables
    Sugarlang's middleware effects).
- Sugarlang gains a settings panel field for this (or extends
  its existing config UI if there is one).

**SugarDeploy's plumbing:**

- At save time, SugarDeploy iterates enabled plugins, reads
  their `gatewayRuntimeConfigKeys` declarations, looks up the
  matching values in each plugin's `pluginConfigurations[].config`
  slot, builds a `{ envVarName: value }` map of all non-empty
  values.
- `planGameDeployment` accepts this map (replacing the
  `runtimeConfigEnv` arg from the original 46.15 draft) and
  threads it through:
  - `deploy.sh` generator inlines them via `--set-env-vars`
    (same caret-delimited shape, just sourced from plugin
    config instead of `.env`).
  - GHA workflow YAML's `deploy-backend` env block carries
    them so re-deploys from CI pick up the latest committed
    values.
- The `/__sugardeploy/resolve-runtime-config-env` host endpoint
  from the original 46.15 draft is REMOVED — Studio reads
  plugin config directly from in-memory session state; no
  filesystem `.env` parsing happens server-side.
- The `SUSPECTED_SECRET_ENV_NAME_REGEX` backstop stays — moved
  from the requirement validator to the new
  `gatewayRuntimeConfigKeys` validator. Same name patterns, same
  hard-refusal behaviour.

**The `.env` story going forward:**

- Studio dev gateway middleware still reads API keys from `.env`
  (or wherever Studio's dev gateway sources them today —
  unchanged). Per-developer secrets, dev-only convenience.
- The bare `SUGARMAGIC_*` runtime-config keys that the original
  46.15 draft put in `.env` (vector store id, model
  identifiers) go away. Their values live in plugin config now.
- The `VITE_*` keys that ARE actually meant for the browser
  bundle (proxy base URL, build-time stamps) stay where they
  are — they're not plugin settings, they're build-time wiring.

**Tests:**

- A plugin declaring a `gatewayRuntimeConfigKey` whose
  `envVarName` doesn't follow `SUGARMAGIC_<PLUGIN_ID>_<KEY>`
  fails the validator with a clear message.
- A plugin declaring an `envVarName` ending in `_API_KEY` etc.
  fails the validator (backstop preserved).
- `planGameDeployment` reads enabled plugins' settings,
  propagates non-empty values; deploy.sh + workflow YAML
  carry them.
- Tests against the existing SugarAgent settings panel: setting
  `openAiVectorStoreId` in the settings UI -> plugin config
  updates -> next save's `deploy.sh` carries
  `SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID=...`.

**Exit:**

- In wordlark with SugarAgent enabled, opening Studio's
  SugarAgent settings panel shows a "OpenAI vector store id"
  text input. Entering `vs_abc123`, saving, committing, pushing,
  and redeploying lands the value on the Cloud Run service env.
  `gcloud run services describe <gateway> --format='value(spec.template.spec.containers[0].env)'`
  shows `SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID=vs_abc123`.
- Vector search calls to the deployed gateway succeed (no more
  400 / "vectorStoreId is required").
- SugarAgent pipeline produces evidence; the canned-fallback
  response goes away.
- `.env` no longer carries any plugin settings — only the few
  things that legitimately belong to the dev environment.

### 46.16 — Auto-rendered plugin settings panels from declared schema

Generalization of 46.15's "SugarAgent and Sugarlang each have a
settings panel" — formalize the contract so future plugins don't
have to hand-write their settings panels.

- Plugins declare a `pluginSettingsSchema` on their discovered
  definition. The schema lists fields with `{ key, label,
  type: "text" | "select" | "number" | "boolean", description,
  default, options?: string[] }`.
- Studio renders the panel automatically from the schema.
  Existing hand-written panels (SugarAgent's
  `apps/studio/src/plugins/catalog/sugaragent/index.tsx`)
  migrate to the schema; plugins that want custom UI can still
  contribute their own panel component, the schema-rendered
  panel is the default.
- `gatewayRuntimeConfigKeys` and `pluginSettingsSchema` cross-
  reference: a `configKey` named in the runtime-config list
  must have a matching schema field. The validator enforces
  this so plugin authors can't accidentally declare a runtime-
  config key that has no UI surface.

**Exit:** SugarAgent's settings panel renders entirely from the
schema (no hand-written JSX for individual fields). A new
plugin that declares a schema gets a working settings panel
with zero Studio-side code.

## Builds On

- [Plan 021: Deployment Plugin and Publish/Deploy Target Architecture Epic](/docs/plans/021-deployment-plugin-and-publish-deploy-target-architecture-epic.md)
- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure Epic](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
- [ADR 017: SugarDeploy Cloud Run Architecture](/docs/adr/017-sugardeploy-cloud-run-architecture.md)
- [ADR 009: Game Root Contract](/docs/adr/009-game-root-contract.md)
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md)

## Followed By

- [Plan 048: Auto-Versioned `@sugarmagic/target-web` via GHCR](/docs/plans/048-ghcr-published-target-web-epic.md)
  — replaces 46.10.5's "Build Frontend button + committed dist/"
  stopgap with a manually-released, GHCR-pulled engine bundle and
  a Unity-style upgrade prompt on project open.
