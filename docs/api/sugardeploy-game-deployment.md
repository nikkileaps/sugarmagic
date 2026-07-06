# API 004: SugarDeploy Game Deployment

## Purpose

This document explains how the SugarDeploy plugin takes a
sugarmagic game project from "authored in Studio" to "playable
on the public web," so a developer starting a new game (or
future-you spinning up a second one) understands the moving
pieces and the lifecycle.

It is not a TypeScript reference. It explains the concepts,
names the artifacts, points at the relevant ADRs / plans / code,
and walks through the onboarding flow.

Companion docs:

- [`docs/setup/persistent-gcloud-auth.md`](/docs/setup/persistent-gcloud-auth.md) — one-time developer-machine setup so gcloud
  CLI doesn't make you re-auth every few days.
- [`packages/plugins/README.md`](/packages/plugins/README.md) —
  plugin SDK rules, including host-side gcloud auth pattern for
  plugin authors.
- [API 002: System and Package API](/docs/api/system-and-package-api.md)
  — boundaries between packages SugarDeploy spans.

---

## What SugarDeploy does

SugarDeploy turns one Studio "Save" + one "Deploy" click into a
publicly reachable game on the open web. From an authored
sugarmagic project, it provisions and updates four things:

1. **A Cloud Run backend** — the gateway service that the
   browser-side runtime hits for any plugin work that needs a
   server (LLM calls, vector stores, authenticated Supabase
   reads, etc.). One per game, named after the game's versioned
   slug (e.g. `wordlark-v1-1dqlc-sugarmagic-gateway`).
2. **A Netlify-served frontend** — the static engine bundle
   (`@sugarmagic/target-web`) + the per-game `boot.json` data
   payload + the project's `assets/` directory (audio, models,
   textures). One Netlify site per game, e.g. `wordlark-prod`.
   Asset delivery is cache-correct by construction: the deploy
   stamps every asset URL in boot.json with the deployed sha and
   serves `/assets/*` immutable (`_headers`, generated alongside
   boot.json — see `packages/plugins/src/deployment/published-web.ts`),
   so a new deploy reaches every browser with no manual cache
   busting, and repeat visits load from local cache. At boot the
   runtime preloads all assets behind the loading screen
   (`targets/web/src/assetPreload.ts`) so gameplay starts with
   its files already local.
3. **A GitHub Actions workflow** in the game's repo
   (`.github/workflows/sugardeploy-deploy.yml`) — orchestrates
   the actual rollouts (backend image build + Cloud Run deploy,
   frontend engine build + Netlify deploy). Regenerated as a
   managed file every time you save the project; never edited by
   hand.
4. **Per-developer IAM bootstrap** — the long-lived developer
   service account ([`docs/setup/persistent-gcloud-auth.md`](/docs/setup/persistent-gcloud-auth.md))
   gets a one-time-per-project grant of the roles SugarDeploy
   needs to call gcloud + terraform from your machine
   (see "Layer B" below).

Concrete examples for wordlark live in the
`packages/plugins/src/catalog/sugardeploy/` and
`packages/plugins/src/deployment/` modules.

---

## Architecture (one game in production)

```
                                 +----------------------------+
                                 |  Authored game project     |
                                 |  (project.sgrmagic, etc.)  |
                                 +-------------+--------------+
                                               |
                          Studio Save / Deploy v
                                               |
                              regenerates managed files:
                                .github/workflows/sugardeploy-deploy.yml
                                .sugarmagic/published-web/boot.json
                                deployment/google-cloud-run/...
                                               |
                                       git push v
                                               |
              +--------------------------------+----------------------+
              |                                                       |
      GitHub Actions: deploy-backend                  GitHub Actions: deploy-frontend
              |                                                       |
              v                                                       v
      Cloud Run gateway service                       Netlify static deploy
      (Docker image + run.deploy)                     (engine dist + boot.json)
              |                                                       |
              v                                                       v
      https://<svc>-<hash>.run.app             https://wordlark-prod.netlify.app
              ^                                                       |
              |                                                       |
              +-------- runtime plugin calls (sugaragent, etc.) ------+
```

Key invariants:

- **The engine bundle is game-agnostic.** Every game ships the
  same `@sugarmagic/target-web` dist; per-game data flows in via
  `boot.json` at runtime ([ADR 019](/docs/adr/019-engine-vs-game-lifecycle-split.md)).
- **The browser never talks to vendor APIs directly.** All
  vendor calls (Anthropic, OpenAI, Supabase admin reads, etc.)
  route through the Cloud Run gateway, which holds the
  credentials in Secret Manager ([Plan 046](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
  + the proxy-URL contract in `packages/plugins/README.md`).
- **No engine bytes are committed to the game repo.** The GHA
  `deploy-frontend` job checks out sugarmagic and rebuilds
  target-web at deploy time ([Plan 053](/docs/plans/053-deploy-time-engine-build.md)).
  Game repo's only deploy-time commit is the regenerated
  `boot.json` + the workflow YAML.
- **Identity is two-layered.** The developer SA on your machine
  ([Plan 049](/docs/plans/049-persistent-gcloud-developer-service-account-epic.md))
  is what Studio uses to call gcloud / terraform. Inside Cloud
  Run, a separate runtime SA (created by terraform per game)
  attaches to the gateway and pulls Secret Manager secrets.

---

## The lifecycle

A SugarDeploy game lives in three workspaces, each with its own
concerns:

### Provision (one-time per environment)

`apps/studio/src/plugins/catalog/sugardeploy/` exposes a
**Provision** view. It owns the one-time infrastructure setup
for a game's environment:

- Pick the Cloud Run target (or "local") and Netlify target.
- Configure overrides: `projectId`, `region`,
  `serviceNamePrefix`, `gatewayAuthMode`, Netlify `siteId`, etc.
  These land on the game's `deployment.targetOverrides` slot in
  the project file.
- **Setup Infra** runs `terraform apply` on the per-game stack
  in `deployment/google-cloud-run/`. Creates Artifact Registry,
  the runtime SA, the GitHub WIF pool, Secret Manager bindings.
- **Setup GitHub Workflow** seeds the repo's GHA variables +
  secrets (`SUGARMAGIC_WIF_PROVIDER`,
  `SUGARMAGIC_RUNTIME_SA_EMAIL`, `NETLIFY_AUTH_TOKEN`).
- **Manage secrets** (Anthropic key, OpenAI key, Supabase
  service-role key, gateway shared token, etc.) — written to
  Secret Manager via Studio's secret-write modal; the value
  never traverses git or any plaintext config.

### Release (when the game's major version increments)

`Release` is a smaller workspace for cutting a new major
version. It runs `gcloud iam service-accounts create` against
the next major's runtime SA, regenerates terraform tfvars for
the new project id, and tags the prior major in git. Out of
scope for a freshly-onboarded game until you decide to
v1 → v2.

### Deploy (every change)

`Deploy` is the day-to-day pane. Press **Deploy** in Studio:

1. Studio's `dispatch-deploy-workflow` middleware
   ([Plan 053.6](/docs/plans/053-deploy-time-engine-build.md)):
   - auto-commits any dirty tracked files in your game repo
   - auto-commits any dirty tracked files in your sugarmagic
     checkout
   - pushes both repos
   - calls `gh workflow run sugardeploy-deploy.yml` with the
     pushed shas pinned
2. GitHub Actions runs `deploy-backend` (terraform-driven
   docker build + push + Cloud Run deploy) and `deploy-frontend`
   (sugarmagic checkout + engine build + boot.json overlay +
   Netlify deploy).
3. The Deploy panel polls run status until completion, then
   updates the deploy history.

The frequency is "every meaningful change." Backend rebuild is
~3 min; frontend rebuild is ~2 min; both run in parallel where
possible.

---

## Setting up a new game (the onboarding journey)

Assumes you've completed the one-time machine setup in
[`docs/setup/persistent-gcloud-auth.md`](/docs/setup/persistent-gcloud-auth.md)
and your developer SA is active.

1. **Create the game project.** New game directory, run
   `pnpm dev:studio` from the sugarmagic checkout, point Studio
   at the new directory. Set the game's identity (id, display
   name) in Project Settings.
2. **Configure deployment targets.** Open SugarDeploy →
   Provision. Pick Google Cloud Run for backend and Netlify for
   frontend. Fill in:
   - **GCP project id** — either an existing project you own,
     or use the inline "Create GCP Project" flow which shells
     `gcloud projects create`. Each game wants its own GCP
     project (versioned: `gameslug-v1-suffix`).
   - **Region** (default `us-central1`).
   - **Service name prefix** — usually matches the GCP project
     id, so terraform service unit names align.
   - **Gateway auth mode** — `none` (open), `bearer` (shared
     token), or `supabase-jwt` (when the SugarProfile plugin is
     enabled — see [ADR 020](/docs/adr/020-sugarprofile-user-management-architecture.md)).
   - **Netlify site id** — create the site on Netlify first
     (free tier is fine), paste the id.
   - **GitHub repo** — `owner/repo` of the game's git repo.
3. **Save the project.** Studio writes the managed files
   (`deployment/google-cloud-run/terraform/`,
   `.github/workflows/sugardeploy-deploy.yml`,
   `.sugarmagic/published-web/boot.json`,
   `.sugarmagic/published-web/README.md`). `git diff` to inspect;
   nothing has hit the remote yet.
4. **Setup Infra.** Click the button. Studio runs `terraform
   apply` against the per-game stack. First-time runs APIs need
   to be enabled — the action tells you which and surfaces
   `gcloud services enable ...` commands.
5. **Layer B bootstrap (Plan 049 §49.5).** The first Cloud-Run-
   touching action (Setup Infra itself, or Health, or Status)
   triggers the per-project IAM bootstrap modal. Sugarmagic
   detects that your developer SA has no roles on this new GCP
   project yet and pops a copy-pasteable command block. Run it
   in a terminal with `--account=YOUR_USER@EMAIL` (your gcloud
   user login). Click Retry. Done — that SA is now bootstrapped
   on this project forever.
6. **Set secrets.** Click each `(missing)` secret in Provision,
   paste the value, save. Studio shells
   `gcloud secrets versions add` per secret; values never
   touch git.
7. **Setup GitHub Workflow.** Click the button. Shells
   `gh variable set` and `gh secret set` to wire up the repo's
   GHA env. Reads terraform outputs to get the WIF provider id
   + runtime SA email.
8. **Open Deploy.** Click **Deploy**. The auto-commit + auto-
   push + dispatch flow described above kicks in. First deploy
   takes ~5 min; you see live run progress.
9. **Visit the live URL.** Netlify renders the engine bundle;
   it fetches `/boot.json` from the deploy origin; the runtime
   resolves plugins; the game boots.

After this onboarding, day-to-day is just: save in Studio →
click Deploy → live.

---

## Player auth: the door model

The identities above are DEVELOPER-side. The PLAYER's account
works on the door model — auth on the site, not in the game
([ADR 022](/docs/adr/022-player-auth-at-the-door.md)):

- **The site owns the account surface.** A game's launch page
  (wordlark: `wordlarkhollow.com/play`, in the game's site repo)
  handles sign-in / sign-up / sign-out against the game's
  Supabase project. The deployed game renders ZERO account
  chrome; identity is a quiet line on the start menu.
- **The session travels by cookie.** SugarProfile's
  `sessionCookieDomain` setting (e.g. `.wordlarkhollow.com`)
  switches the Supabase client to chunked parent-domain cookie
  storage
  (`packages/plugins/src/catalog/sugarprofile/runtime/cookie-session-storage.ts`),
  so the site and the game subdomain share one session. The site
  runs a byte-format twin of that adapter — the formats must
  move together (both files carry the pairing warning).
- **`playPageUrl`** (SugarProfile setting) is where the start
  menu's Exit button (the `exit-to-site` UI action,
  `packages/runtime-core/src/ui-actions/`) returns players after
  a force-save. Authored exit buttons hide themselves in builds
  with no Play page configured.
- **The fallback**: with `allowAnonymous` off and no session, a
  direct visit to the game URL gets a blocking sign-in modal —
  playable, but the door is the intended path. With
  `allowAnonymous` on, session-less visits boot as guests
  (per-game choice).
- **Entitlement stays separable.** "Account exists" and "can
  play" are distinct beats by design, so a payment/entitlement
  step can slot between them later — see the constraint in
  [ADR 022](/docs/adr/022-player-auth-at-the-door.md).

## The auth model in one paragraph

Three identities are at play. **You** (a Google account) own
the GCP project and create everything. The **developer SA**
(set up once via [`docs/setup/persistent-gcloud-auth.md`](/docs/setup/persistent-gcloud-auth.md))
is your machine's long-lived gcloud identity — Studio shells
gcloud as this SA, no reauth dance. The **runtime SA** (created
by per-game terraform, e.g. `wordlark-v1-1dqlc-runtime`) attaches
to the Cloud Run service in production and reads its own
Secret Manager secrets server-side. Plus a **GitHub WIF
principal** that lets GHA's `deploy-backend` push images +
deploy to Cloud Run without a long-lived JSON key. Each
identity has the narrowest set of roles it needs for its job;
see [Plan 049](/docs/plans/049-persistent-gcloud-developer-service-account-epic.md)
for the full role list and Layer B rationale.

---

## Where to go next

For plugin developers:

- [`packages/plugins/README.md`](/packages/plugins/README.md) —
  proxy URL contract, host-side gcloud auth helper, runtime
  vs host responsibilities.
- [`packages/plugins/src/deployment/README.md`](/packages/plugins/src/deployment/README.md)
  — deployment package internals (plans, managed files,
  target handlers).

For deeper architectural rationale:

- [ADR 018: SugarDeploy Web Publish Target Architecture](/docs/adr/018-sugardeploy-web-publish-target-architecture.md)
- [ADR 019: Engine vs. Game Lifecycle Split](/docs/adr/019-engine-vs-game-lifecycle-split.md)
- [ADR 020: SugarProfile User Management Architecture](/docs/adr/020-sugarprofile-user-management-architecture.md)
- [Plan 045: SugarDeploy Cloud Run Plugin-Owned Infrastructure](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
- [Plan 046: SugarDeploy Web Publish Target Epic](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
- [Plan 047: SugarProfile User Management Plugin Epic](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
- [ADR 022: Player Auth at the Door](/docs/adr/022-player-auth-at-the-door.md)
- [Plan 049: Persistent gcloud Developer SA](/docs/plans/049-persistent-gcloud-developer-service-account-epic.md)
- [Plan 053: Deploy-Time Engine Build](/docs/plans/053-deploy-time-engine-build.md)

For the code:

- `packages/plugins/src/catalog/sugardeploy/` — the plugin
  itself (manifest, runtime contribution, host middleware).
- `packages/plugins/src/deployment/` — cross-plugin deployment
  primitives (action descriptors, plan generation, managed file
  emission, github-workflow.ts template).
- `apps/studio/src/plugins/catalog/sugardeploy/` — Studio UI
  (Provision / Release / Deploy panels).
- `deployment/google-cloud-run/` — the shared terraform module
  + deploy.sh that the GHA workflow drives.
