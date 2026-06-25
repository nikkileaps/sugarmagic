# ADR 018: SugarDeploy Web Publish Target Architecture

## Status

Accepted.

## Context

[Plan 021](/docs/plans/021-deployment-plugin-and-publish-deploy-target-architecture-epic.md)
established the publish-target / deployment-target split: publish targets describe
the bundle shape and frontend deploy surface, deployment targets describe the
backend gateway runtime. [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md)
landed the Cloud Run backend half. [Plan 046](/docs/plans/046-sugardeploy-web-publish-target-epic.md)
landed the web publish-target half and the GHA-driven deploy cadence that ties
both halves together end-to-end. The decisions below are the architectural
rules the implementation settled on. They are not aspirational; they are the
rules new contributors and future agents should read before changing the
publish + deploy side of the deploy plugin.

## Decision

### Publish productmode with a Studio-core baseline

Publish is a top-level Studio productmode peer to Author / Playtest, owned by
Studio core. The baseline workspace ("Package") and the per-game publish state
slot (`pluginConfigurations[<plugin>].config.publishSettings`) ship as core
contracts; concrete publish-target plugins (today: SugarDeploy) contribute
additional workspaces (Provision / Release / Deploy) through the workspace
contribution API. A core-baseline-with-plugin-workspaces split keeps the
"there's a Publish mode and somewhere to manage what gets published" promise
plugin-agnostic, while letting publish targets own their cadence-specific
ergonomics without forking Studio.

### SugarDeploy's three workspaces map to three cadences

SugarDeploy contributes three workspaces under the Publish productmode:

- **Provision** runs once per stand-up: Create GCP Project, Setup Infra,
  Setup GitHub Workflow, Build Frontend (when the engine bundle needs to
  be refreshed).
- **Release** runs once per version event: Cut New Major Version (saga),
  Tag Patch Version, version-history view of git tags + GCP project ids.
- **Deploy** runs daily / per-commit: fires the GHA `workflow_dispatch`
  for the deploy pipeline, polls run status, re-runs failed jobs.

Splitting by cadence is what makes the workspace state make sense: the
fast-changing Deploy surface stays out of the slow-changing Provision +
Release surfaces, and the user is never confused about whether a "deploy"
also bumps the version.

### GHA owns deploy, Studio owns provisioning + release

Studio shells out to host binaries (`gcloud`, `terraform`, `gh`, `git`) for
one-time provisioning + release actions. The deploy pipeline itself runs as
a GHA `workflow_dispatch`-able workflow (`deploy.yml`) that Studio dispatches
via `gh workflow run` and tracks via `gh run view`. The GHA workflow does
build + push + `gcloud run deploy` + `netlify deploy` against the
WIF-authenticated GitHub Actions principal. Studio's local-host secrets never
leave the developer machine; everything CI needs comes from GitHub Variables
(non-secret identifiers) and Secrets (credentials).

A consequence is that "what's running in prod" is always reproducible from
a git commit + the workflow run that deployed it. The Studio-side history
list is a record of dispatched runs, not a separate source of truth.

### Publish-target plugin contract

The publish-target plugin contract is two registries plus two managed-files
builders:

- `frontendDeploymentTargetHandlers` (registry in
  `packages/plugins/src/deployment/index.ts`) -- one entry per
  `FrontendDeploymentTargetId` (today: `netlify`). Each entry carries a
  `definition`, an `normalizeOverrides`, an optional `collectWarnings`, and
  a `buildManagedFiles`.
- `targetHandlers` (existing from Plan 045) -- backend deployment targets,
  unchanged.
- `buildPublishedWebManagedFiles(gameProject, snapshot)` -- emits
  `.sugarmagic/published-web/boot.json` + the bundle-root README. See
  ADR 019 for the engine-vs-game split this builder enforces.
- `buildNetlifyManagedFiles(plan, gameProject)` -- emits
  `deployment/netlify/netlify.toml` + `build-config.json` + README.

The shape mirrors the backend target contract from ADR 017 deliberately:
adding a second frontend host (e.g. Cloudflare Pages) means adding one entry
to `frontendDeploymentTargetHandlers` plus one managed-files builder, not
new code in Studio.

### Per-version frontend deploys preserved forever

Netlify's per-deploy URL shape
(`https://<sha>--<site>.netlify.app/`) is the durable artifact. The Netlify
production root (`https://<site>.netlify.app/`) points at whichever
per-deploy URL was last promoted to live. Older per-deploy URLs stay alive
indefinitely; nothing in the workflow purges or supersedes them. This is
what makes promote / drain stories possible without bespoke storage:
promotion is a Netlify API call against an existing immutable URL, drain
is a Netlify API call to delete the deploy when the team is sure no
player is on it.

The promote-to-live + drain-old-version stories are scoped to a follow-up
epic that builds on this URL shape; the URL shape itself is committed.

### GHA bootstrap pattern: vars for identifiers, secrets via stdin

Setup GitHub Workflow (`/__sugardeploy/setup-github-workflow`) writes:

- **Repository variables** (`gh variable set`): non-secret identifiers --
  `SUGARMAGIC_GCP_PROJECT_ID`, `SUGARMAGIC_GCP_REGION`,
  `SUGARMAGIC_WIF_PROVIDER`, `SUGARMAGIC_RUNTIME_SA_EMAIL`,
  `SUGARMAGIC_NETLIFY_SITE_ID`, etc.
- **Repository secrets** (`gh secret set --body-file -`): credentials
  the workflow shells out with -- `NETLIFY_AUTH_TOKEN` is the canonical
  example. Values pipe through stdin; they never enter argv, console
  logs, or React state. The Studio modal collects the value into
  component-local state and immediately POSTs to the host endpoint; the
  endpoint shells `gh secret set --body-file -` with the value on the
  fd, and the modal closes without re-displaying the value.

Splitting vars vs. secrets is what makes drift handling tractable: the
non-secret identifiers can be re-read with `gh variable list` for a
diff against `boot.json` / `build-config.json`, the secrets can't be
read back at all and live only in the GHA runtime.

### Template-version + drift-banner discipline applies to publish files too

Every managed file under the publish-target half carries a
`SUGARMAGIC TEMPLATE VERSION: NN` stamp on the same discipline ADR 017
established for the Cloud Run terraform half:

- `FRONTEND_RENAME_LEDGER` -- per-host rename history for files under
  `deployment/<host>/` (e.g. `deployment/netlify/`). Owned by the
  frontend deployment target's handler.
- `WORKFLOW_RENAME_LEDGER` -- rename history for files generated under
  `.github/workflows/` (e.g. `sugardeploy-deploy.yml`). Owned by the
  workflow generator (`github-workflow.ts`).
- `BOOT_JSON_SCHEMA_VERSION` -- compatibility token for the per-game
  `.sugarmagic/published-web/boot.json` payload. The runtime
  (`targets/web/src/App.tsx`) asserts on read; deploy-time emission
  always writes the current version.

When the on-disk version is less than the current, Studio shows a
non-blocking drift banner. The ledgers are append-only; entries are
never pruned.

### Deploy-time IAM scope: WIF for build / push, runtime SA for runtime

The GitHub Actions runner authenticates as the WIF principal for the
duration of the deploy job: that's the identity that pushes Docker
images to Artifact Registry, calls `gcloud run deploy`, and uploads
to Netlify. The Cloud Run service runs as a separate runtime service
account attached via `gcloud run deploy --service-account=...`. The
WIF principal never has runtime privileges; the runtime SA never has
build privileges. Cleanly split IAM scopes per phase.

A consequence is that the runtime SA's permissions list is short and
auditable: `roles/secretmanager.secretAccessor` for the gateway's
secrets, and nothing else. The WIF principal's permissions list is
deploy-only.

### Env-vars-or-terraform pattern in deploy.sh

`deploy.sh` is the gcloud-side counterpart to terraform's surrounding
infrastructure. It carries two env-injection mechanisms:

- `--set-secrets=^@^...` for Secret-Manager-backed credentials. The
  list of bindings comes from `collectSecretEnvBindings(plan, prefix)`.
- `--set-env-vars="^@^SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS=...@..."` for
  non-secret runtime config. The base value is `ALLOWED_ORIGINS`; the
  per-plugin gateway runtime config (story 46.15) appends additional
  `@key=value` pairs computed at deploy time from each enabled plugin's
  `gatewayRuntimeConfigKeys` declarations.

The `^@^` prefix sets `@` as the kvpair separator so values can contain
commas (allowed-origins lists, model strings, etc.). Joining additional
pairs with `,` instead of `@` was a real bug we hit and is the reason
the contract is written down here.

### Per-game plugin config as gateway runtime source of truth

Non-secret runtime config (vector store ids, model identifiers, target
language codes, etc.) lives in the plugin's per-game configuration slot
under `pluginConfigurations[<pluginId>].config.*`, NOT in `.env` files
or shell exports. Each plugin declares which of its config keys map to
gateway env vars via `gatewayRuntimeConfigKeys`:

```ts
gatewayRuntimeConfigKeys: [
  {
    configKey: "openAiVectorStoreId",
    envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
    description: "...",
    nonSecretAttestation: "safe-to-expose-publicly"
  }
]
```

`planGameDeployment` walks every enabled plugin's declarations, reads
the matching config value from the plugin slot, validates it via
`validateGatewayRuntimeConfigKey` (which enforces the
`SUGARMAGIC_<PLUGIN_ID_UPPER>_<KEY>` env var name pattern), and bakes
the resulting `Record<string, string>` into `plan.gatewayRuntimeConfigEnv`.
The `deploy.sh` + GHA workflow's `deploy-backend` env block both read
from that single map.

The `nonSecretAttestation` field is a hard contract: a plugin author
claims publicly that the value is safe to expose. A backstop regex
(`SUSPECTED_SECRET_ENV_NAME_REGEX` matching `_API_KEY`, `_TOKEN`,
`_SECRET`, `_PASSWORD`, `_PRIVATE_KEY` suffixes) rejects declarations
whose env var name looks secret-y even if the attestation is present.
Two locks beats one for "never accidentally surface a secret as a
non-secret".

### Browser only talks to the gateway

Plugins that need vendor APIs (Anthropic, OpenAI, etc.) ship a gateway-only
runtime: the browser-side plugin code constructs requests to the
deployed gateway URL and attaches a bearer token; the gateway makes
the actual vendor calls using Secret-Manager-backed credentials.

Vendor API keys never enter:
- Browser bundles
- Studio React state
- `.env` files committed to the repo (the only entry in `.env` that
  the publish path reads is the gateway URL itself in dev)
- argv, console logs, or any persistence Studio writes

The gateway proxy URL is the only piece of plugin-runtime config that
the browser is allowed to receive. SugarAgent's runtime throws on init
if the proxy URL is empty.

### Patch tags are git-only, plugin state untouched

Cut New Major Version (`v{N}.0.0` tags) bumps `gameProject.majorVersion`
and registers a per-major GCP project suffix in the SugarDeploy plugin
slot. Tag Patch Version (`v{N}.0.M` for M >= 1) does NOT: patches are
commits anchored to an existing major's deployment slot, and creating
one is purely `git tag v{N}.0.M HEAD` -- no plugin-state change, no
GCP project change, no commit.

The Release workspace's version history reads patch tags directly
from `git tag --list 'v*.0.*'` on every workspace open, grouped by
their major's `v{N}.0.0` base. Plugin state remains the source of
truth for "which GCP project does major N live in?" but not for
"which patch tags exist?" -- git is the source of truth for the
latter, and Studio never mirrors that into plugin state.

Gap-tolerance: if a patch tag is deleted, the next auto-increment is
still highest+1, never reuses a freed number. Reusing would point a
tag at a different commit than anyone who saw the prior tag expects.

## Consequences

- Adding a second frontend host means: add the `FrontendDeploymentTargetId`,
  add the override normalizer, add the `frontendDeploymentTargetHandlers`
  entry, add managed-files builder, add a Studio tab, add tests. No
  Studio-core changes.
- Adding a per-game gateway runtime config key means: extend the
  plugin's `SugarAgentPluginConfig` (or equivalent), add a
  `gatewayRuntimeConfigKeys` entry, add a UI input in the plugin's
  workspace panel. The deploy pipeline picks it up automatically.
- Surfacing a new plugin secret means: declare a `kind: "secret"`
  deployment requirement, set its `mappingHint` to the env var name
  the application reads, and let `resolveSecretManagerName` derive
  the Secret Manager name. Same shape as ADR 017's secret pattern.
- The deploy plugin can be uninstalled cleanly. The `publishSettings`
  contract is a Studio-core type; removing SugarDeploy leaves Studio
  with no Publish workspaces but the productmode still loads, the
  Package baseline still shows, and `gameProject` still typechecks
  clean.
- Promote-to-live and drain-old-version are tractable. The URL shape
  is committed; the workflow can be a follow-up epic that calls the
  Netlify deploy API.
- Patch deploys are cheap: the GHA workflow's tag trigger fires on
  `git push --tags`, picks up the patch tag, and deploys against the
  matching major's Cloud Run + Netlify slot. No Studio interaction
  required after the tag is created.
