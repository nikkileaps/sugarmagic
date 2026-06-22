# Plan 046: Studio Publish Productmode + SugarDeploy Provision / Release / Deploy

**Status:** Proposed
**Date:** 2026-06-22

> Builds on [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
> (the backend / Cloud Run half) and [ADR 017](/docs/adr/017-sugardeploy-cloud-run-architecture.md).
> The identity-provider plugin work that used to be Plan 046 is now
> [Plan 047](/docs/plans/047-identity-provider-plugin-model-epic.md).

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
  deploy` for the backend, `pnpm --filter @sugarmagic/target-web
  build` + `npx netlify deploy` for the frontend — lives in a plugin-
  generated GHA workflow under `.github/workflows/sugardeploy-deploy.yml`
  in the game root. Studio's Deploy button fires the workflow via
  `workflow_dispatch`; the workflow can also fire on `push: tags:
  ['v*']` for tag-driven production deploys. The workflow YAML is a
  plugin-managed file with the same `# GENERATED BY SUGARMAGIC`
  header + `# SUGARMAGIC TEMPLATE VERSION: NN` stamp + `moved {}`-
  style drift discipline as the terraform.

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

- **Publish-target plugin selection mirrors deployment-target plugin
  selection.** `publishTargetId` becomes a typed enum like
  `deploymentTargetId`. For v1: `web-netlify` is the single concrete
  value (the legacy `"web"` value migrates to `"web-netlify"` on
  read). The same per-target handler-registry shape Plan 045
  established for deployment targets applies to publish targets —
  per-target normalizer, per-target managed-files, per-target host
  actions. Adding a new frontend host (Vercel, Cloud Storage + Cloud
  CDN, etc.) is registering a new handler, not rewriting the plugin.

- **`targets/web/` finished into a real playable artifact.** The
  published-web shell at `targets/web/` (workspace name
  `@sugarmagic/target-web`) already exists and is composed of
  `runtime-core` + `render-web` + `plugins` + `domain` — today it
  renders a placeholder card. This epic finishes that shell so its
  Vite build produces a real playable bundle: composes the game
  render path, bakes in the game's authored content
  (`project.sgrmagic`, content library, regions, assets), and reads
  build-time-injected configuration (gateway URL, gateway-shared-
  token if `gatewayAuthMode === "bearer"`, the game's `majorVersion`
  + versioned slug) from Vite env vars set by the GHA workflow.
  Studio's preview path already imports from
  `@sugarmagic/target-web` (`createWebRuntimeHost`,
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
  identity is [Plan 047](/docs/plans/047-identity-provider-plugin-model-epic.md).
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
- A `publishTargetHandlers` registry in
  `packages/plugins/src/deployment/` parallel to `targetHandlers`.
  Each handler exposes `definition`, `normalizeOverrides`, optional
  `collectWarnings`, `buildManagedFiles`. The Netlify handler emits
  per-game `netlify.toml`, a build-config manifest, and a README
  into `<game-root>/publish/web-netlify/` (mirroring the Cloud Run
  managed-files layout). Same drift-discipline as the Cloud Run
  terraform.

### Plugin-managed files (new)

- `<game-root>/.github/workflows/sugardeploy-deploy.yml` — the
  deploy workflow. Carries the `# GENERATED BY SUGARMAGIC` header
  and `# SUGARMAGIC WORKFLOW TEMPLATE VERSION: NN` stamp.
  Regenerated on every save like the terraform. Drifts via a new
  `WORKFLOW_RENAME_LEDGER` parallel to `TERRAFORM_RENAME_LEDGER`
  (workflows don't have a `moved {}` concept; drift handling here
  is "overwrite on save with a banner if hand-edits are present" —
  shape decided during scoping).
- `<game-root>/publish/web-netlify/netlify.toml` and supporting
  files — Netlify build config, frozen at the major's identity.
- `<game-root>/publish/web-netlify/README.md` — generated, covers
  what's in the bundle, what env vars are baked in, manual fix-up
  commands.

### `targets/web/` finishing

- App composes `runtime-core` + `render-web` for a real game
  render path (replaces the placeholder card).
- Build-time config baked in via Vite env vars: gateway URL,
  bearer token (if applicable), `majorVersion`, versioned slug,
  build git SHA, build timestamp.
- Game content (`project.sgrmagic`, content library, regions,
  assets) baked in at build time via a copy step the GHA workflow
  runs before `vite build`.
- Boot data path forks on `hostKind`: Studio preview keeps using
  the `postMessage` PREVIEW_BOOT path; production reads from the
  baked-in static artifact at boot.

### Host actions (Studio dev server middleware)

Provisioning + Release host actions are largely already in place
from Plan 045. New endpoints:

- `POST /__sugardeploy/setup-github-workflow` — bootstraps GHA:
  ensures `gh` is on PATH + authenticated, writes the required repo
  secrets (`NETLIFY_AUTH_TOKEN`, plus auto-derived `GCP_WIF_PROVIDER`
  + `GCP_SA_EMAIL` from terraform output) via `gh secret set ... <
  value` with values piped via stdin, generates the workflow YAML,
  verifies WIF binding shape from Plan 045's terraform output.
  Idempotent.
- `POST /__sugardeploy/dispatch-deploy-workflow` — the Studio
  Deploy button fires this. Wraps a `gh workflow run` call (or the
  GitHub API equivalent) with the current ref. Returns the GHA run
  id.
- `POST /__sugardeploy/get-deploy-workflow-status` — polls a GHA run
  by id; returns status + per-job state. Studio's Deploy workspace
  polls this to surface live status without the user leaving
  Studio.
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
- The plugin-generated `publish/web-netlify/README.md` documents
  the bundle.
- The plugin-generated `.github/workflows/sugardeploy-deploy.yml`
  carries inline comments explaining each job.
- Updates `packages/plugins/src/deployment/README.md` to document
  the publish-target half + the workflow-generation discipline.
- Updates Plan 021 with a cross-reference.

### Tests

- `publishTargetHandlers` registry + normalizer round-trips.
- Plugin-generated `netlify.toml` + workflow YAML shape assertions.
- Build-config manifest baked into the player bundle has the
  expected gateway URL + version identity.
- `normalizeGameProject` migrates legacy `publishTargetId: "web"`
  to `"web-netlify"`.
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

- **First-party frontend host is Netlify, named `web-netlify` in
  the publish-target enum.** Per-deploy preserved-forever URL
  semantics match the version model exactly; production-promote API
  is one call; cert + CDN are automatic. Other hosts can be added
  via the same handler-contract pattern.

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

- **The frontend bundle bakes in project content + assets, not
  fetches them at runtime.** For wordlark-scale content this is the
  simplest v1 path with strong CDN cacheability. A future game with
  asset-budget pressure can add a `web-asset-cdn` target rather
  than retrofitting fetch-from-gateway into the player bundle.

- **Push to git remote and promote-to-live are never automatic.**
  Same discipline Plan 045 established for Cut. Studio's Cut
  produces the tag locally; the user pushes when they mean to.
  GHA's `push: tags: ['v*']` trigger does mean that pushing the tag
  also fires a deploy — that's the deliberate path. Studio's
  Deploy button uses `workflow_dispatch` against the current ref
  for ad-hoc deploys that don't require a tag.

## Open Questions

- **Dirty-tree-at-Deploy policy.** GHA needs a ref to build from
  (committed). Studio's Deploy button needs to handle the "I have
  uncommitted local state, ship it now" path. Options: (a) refuse
  to deploy from dirty tree, (b) auto-create a temporary "WIP-{sha}"
  branch + push + dispatch from it, (c) refuse for tag-triggered
  prod deploys but allow ad-hoc workflow_dispatch from dirty by
  committing-and-pushing-to-a-snapshot-branch behind the scenes.
  Probably (c).

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

- **GHA run-status display in the Deploy workspace.** Polling
  cadence (every 2s? back off after first job completes?), how
  much per-job detail to surface inline vs. linking out to the
  GHA UI, how to handle "the GHA run failed but the failure was
  transient and a re-run would succeed" — the workspace should
  make re-running easy.

- **Patch tagging UX.** `v1.0.1`, `v1.0.2`, etc. on a worktree at
  `v1.0.0`. Auto-increment from the existing patch tags, or user-
  specified? Almost certainly auto-increment.

- **Workflow YAML drift discipline.** Terraform's `moved {}` blocks
  don't have an equivalent in GHA workflows. Probably: regenerate
  + show a banner if hand-edits are present + offer "I want to
  diff what'll change" via the existing template-version probe
  endpoint pattern.

- **Promote-to-live affordance shape.** Even though the action
  itself is a follow-up, do we show a stub button in the Deploy
  workspace with "wired in plan 04X" copy (like 45.8.5's stubs),
  or leave the affordance absent until the follow-up lands?

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
`pluginConfigurations[].config` shape established in 45.7.5) with
a `publishSettings` field carrying publish-target overrides
parallel to `settings.targetOverrides` on the deployment-target
side. Defines the `publishTargetId` typed enum (initially
`"web-netlify"`), the `PublishTargetSettings` type, and the
`liveDomain` project-level field. Adds `getPublishSettings(gameProject)`
and `buildUpdatePublishSettingsCommand(gameProject, settings)`
helpers exported from `packages/plugins/src/deployment/plugin-state.ts`.

Legacy migration: pre-046 projects whose `DeploymentSettings`
carries `publishTargetId: "web"` get the value migrated to
`"web-netlify"` on read. Same forward-only pattern 45.7.5
established. Tests cover both the new-shape round-trip and the
legacy migration.

**Exit:** opening a project file with `publishTargetId: "web"`
normalizes to `"web-netlify"`; saving rewrites the file with the
new value; `getPublishSettings(gameProject)` returns a populated
`PublishTargetSettings` with default fields filled. The deployment
package's typecheck is clean. New tests in
`packages/testing/src/plugin-infrastructure.test.ts` cover the
shape + migration.

### 46.3 — `targets/web/` finishing: real game render path

Replaces the placeholder card in `targets/web/src/App.tsx` with a
real game-render composition. The App reads its boot data from a
build-time-baked static artifact (`/boot.json` plus an `assets/`
directory at the bundle root, or whatever shape the build produces
in 46.4) and instantiates `runtime-core` + `render-web` through
`@sugarmagic/target-web`'s existing `createWebRuntimeHost`.

Boot-data path forks on `hostKind`:
- `hostKind === "studio"`: keep the existing `postMessage`
  `PREVIEW_BOOT` flow (Studio sends the project state as a
  message from the opener window).
- `hostKind === "published-web"`: fetch `/boot.json` (or import
  the baked artifact directly via Vite's import-glob).

Studio's existing preview window keeps working unchanged because
it stays on the `hostKind === "studio"` branch. The published-web
branch is new but composes the same `runtime-core` + `render-web`
+ enabled plugins, so behavioral parity is structural.

**Exit:** running `pnpm --filter @sugarmagic/target-web dev` and
visiting `/?hostKind=published-web` with a synthetic
`boot.json` fixture renders the game (player, region, NPCs,
dialogue, etc.) instead of the placeholder card; Studio's preview
window still renders the same game when opened from Studio (the
`hostKind === "studio"` path is untouched). The
`apps/studio/src/preview/UIPreviewSession.tsx` tests continue to
pass. A new integration test boots the published-web path against
a synthetic boot fixture and asserts the runtime mounts.

### 46.4 — Build-time config wiring for `targets/web/`

Adds the Vite env var schema `targets/web/` expects:
`SUGARMAGIC_GATEWAY_URL`, `SUGARMAGIC_GATEWAY_BEARER_TOKEN`
(optional, only set when `gatewayAuthMode === "bearer"`),
`SUGARMAGIC_GAME_MAJOR_VERSION`, `SUGARMAGIC_VERSIONED_SLUG`,
`SUGARMAGIC_GIT_SHA`, `SUGARMAGIC_BUILD_TIMESTAMP`. The build
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
produces a bundle that, when served, renders the game AND
successfully calls a configured gateway URL for any
gateway-needing enabled plugin's routes; building without
gateway env vars produces a bundle that renders pure-client
content. The build-config manifest baked into the bundle has the
expected fields and round-trips through a test.

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

### 46.6 — `publishTargetHandlers` registry + `web-netlify` handler

Adds the `publishTargetHandlers` registry in
`packages/plugins/src/deployment/` parallel to `targetHandlers`.
Each entry exposes `definition` (id + displayName + summary +
implemented), `normalizeOverrides`, optional `collectWarnings`,
and `buildManagedFiles`. The single concrete handler is
`web-netlify`:

- `normalizeOverrides`: validates `siteId` (UUID-ish), `siteName`
  (optional), `productionContext` enum.
- `buildManagedFiles`: emits `publish/web-netlify/netlify.toml`
  (with the right `[build]`, `publish`, and `[[redirects]]`
  blocks for a SPA), `publish/web-netlify/build-config.json`
  (consumed by the GHA workflow at build time — captures gateway
  URL, version identity, etc.), and
  `publish/web-netlify/README.md` (explains what's generated,
  what env vars are baked in, manual fix-up commands). All
  carry the `# GENERATED BY SUGARMAGIC` header and the
  `# SUGARMAGIC PUBLISH TEMPLATE VERSION: NN` stamp. New
  `PUBLISH_TARGET_RENAME_LEDGER` parallel to
  `TERRAFORM_RENAME_LEDGER` (currently empty — no renames yet).

The Provision workspace's existing Targets tabs gain a parallel
Publish Targets tab list with `web-netlify` as the single
configured target. Selecting it surfaces its settings fields
(siteId, siteName, productionContext).

**Exit:** with `publishTargetId: "web-netlify"` set on a project,
saving regenerates `publish/web-netlify/netlify.toml` and
`build-config.json` with the right shape (snapshot test in
`packages/testing/src/plugin-infrastructure.test.ts`). The
Provision workspace's Publish Targets section lets the user fill
in Netlify site id; values persist via
`buildUpdatePublishSettingsCommand`. Uninstalling SugarDeploy
removes the regenerated files on next clean-build (they don't
re-appear).

### 46.7 — `.github/workflows/sugardeploy-deploy.yml` generation

Adds the plugin-generated GHA workflow YAML to the managed-files
output. The workflow has two jobs:

- `deploy-backend`: checkout, auth to GCP via WIF, `gcloud auth
  configure-docker`, docker build, push to Artifact Registry,
  `gcloud run deploy` (the same `deploy.sh` from Plan 045, called
  here, not duplicated).
- `deploy-frontend`: checkout, set up Node, `pnpm install`, build
  `@sugarmagic/target-web` with all the env vars from
  `publish/web-netlify/build-config.json`, copy game-root content
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

- `POST /__sugardeploy/dispatch-deploy-workflow` — accepts a git
  ref. If the ref is "current uncommitted state", auto-creates a
  branch `sugarmagic-deploy-snapshot-{timestamp}` from current
  HEAD, commits the dirty state, pushes the branch (using `gh`
  for auth), and dispatches the workflow against that branch.
  If the ref is a tag or a clean-tree HEAD, dispatches directly.
  Returns the GHA run id and URL.
- `POST /__sugardeploy/get-deploy-workflow-status` — polls a GHA
  run by id; returns `{ status, conclusion, jobs: [{name, status,
  conclusion, html_url}] }`. Studio's Deploy workspace polls this
  every 4s while the run is in flight and surfaces per-job state
  inline.

Deploy workspace UI:
- Pre-flight check on click: shows the ref that'll be deployed
  (HEAD sha, branch, "WIP snapshot of N uncommitted changes" if
  applicable). User confirms in a modal before dispatch.
- During run: collapsible per-job progress, link out to GHA UI
  for full logs, "Re-run failed jobs" button (calls
  `gh run rerun --failed`).
- After completion: surface the per-deploy URL (Netlify deploy
  URL) and the Cloud Run revision URL. Add an entry to the
  Deploy workspace's per-deploy history list.

**Exit:** clicking Deploy in the Deploy workspace on a clean tree
fires a GHA run; the workspace polls the status and surfaces
per-job progress until the run completes; on success, the
per-deploy Netlify URL and Cloud Run revision are surfaced and
clickable. On a dirty tree, the action auto-creates the snapshot
branch, pushes it, and dispatches; the user gets a clear note in
the modal that a snapshot branch was created. On a job failure,
"Re-run failed jobs" works. The existing `gcloud run deploy`
synchronous path is removed (it's now in GHA).

### 46.11 — Cut + Release saga regeneration extends to publish + workflow files

The Plan 045 story 45.8 Cut saga's `saveProjectWithManagedFiles`
step regenerates terraform + the backend's deploy.sh + secrets
README. This story extends that regeneration to ALSO produce the
new major's `publish/web-netlify/netlify.toml` +
`build-config.json` + `publish/web-netlify/README.md` AND the new
`.github/workflows/sugardeploy-deploy.yml`. Same managed-files
discipline; no new commit-side logic.

**Exit:** running the Cut saga on a wordlark v1 project produces
a single commit `chore: bump major version to 2` that contains:
the bumped `project.sgrmagic` (with the new `versionedProjectIdentifiers[v2]`
suffix in the plugin slot), the regenerated terraform + deploy.sh
(per Plan 045), the regenerated `publish/web-netlify/*` files
(now pointing at the v2 Netlify site config), and the regenerated
`.github/workflows/sugardeploy-deploy.yml` (template-version
stamp updated, references the new major's resource names). The
`git tag v1.0.0` is still placed at the pre-bump HEAD. Existing
45.8 tests pass with the expanded managed-files list.

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

Writes ADR 018 capturing the architectural decisions:
Publish productmode with Studio-core baseline; plugins
contribute additional workspaces; SugarDeploy's three-workspace
cadence model; GHA-driven deploy primitives with Studio-driven
provisioning + release; publish-target plugin contract;
per-version frontend deploys preserved forever; URL shape
supports promote / drain; GHA secret bootstrap pattern; the
publish + workflow template-version + rename-ledger discipline.

Updates `packages/plugins/src/deployment/README.md` to document
the publish-target half (file layout for the new managed-files
directories, the `publishTargetHandlers` registry, the
`PUBLISH_TARGET_RENAME_LEDGER` + `WORKFLOW_RENAME_LEDGER`
conventions, the host endpoints for publish-side actions).

The plugin-generated `publish/web-netlify/README.md` carries
its own operational guide.

Updates Plan 021 with a "Web publish target implementation: see
Plan 046 and ADR 018" cross-reference.

Updates `targets/web/README.md` to describe the dual-mode boot
(Studio preview vs. published-web) and the build-time env var
schema.

**Exit:** ADR 018 exists at `docs/adr/018-*.md` and is
internally consistent with Plan 046. `packages/plugins/src/deployment/README.md`
reflects current behavior including the new ledgers + the
publish-target handler API. The plugin-generated
`publish/web-netlify/README.md` in a fresh wordlark save
reflects the per-major Netlify site identity + the build-time
env var list. Plan 021 carries the cross-reference at the top.

The promote-to-live + drain-old-version stories are a follow-up
epic that builds on the URL + version shape this epic
establishes.

## Builds On

- [Plan 021: Deployment Plugin and Publish/Deploy Target Architecture Epic](/docs/plans/021-deployment-plugin-and-publish-deploy-target-architecture-epic.md)
- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure Epic](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
- [ADR 017: SugarDeploy Cloud Run Architecture](/docs/adr/017-sugardeploy-cloud-run-architecture.md)
- [ADR 009: Game Root Contract](/docs/adr/009-game-root-contract.md)
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md)
