# SugarDeploy deployment package

This directory contains the deployment-target implementation that the SugarDeploy
plugin (`packages/plugins/src/catalog/sugardeploy/`) leans on. The catalog entry
is a thin shell that registers the plugin, contributes host middleware, and
exposes a Studio workspace; the substance — terraform generation, deploy script
emission, action descriptors, secret naming, override normalization, plugin
state — lives here.

For the Cloud Run backend half, read
[ADR 017](/docs/adr/017-sugardeploy-cloud-run-architecture.md)
and [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md).
For the web publish-target half (frontend deploy, GHA workflow,
per-game gateway runtime config, Release workspace cadence), read
[ADR 018](/docs/adr/018-sugardeploy-web-publish-target-architecture.md)
and [Plan 046](/docs/plans/046-sugardeploy-web-publish-target-epic.md).
For the engine vs. game lifecycle split that backs the published-web
managed files, read
[ADR 019](/docs/adr/019-engine-vs-game-lifecycle-split.md)
and [Plan 048](/docs/plans/048-ghcr-published-target-web-epic.md).

## File layout

| File                     | Owns                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `index.ts`               | Target handler registry (`targetHandlers`), `planGameDeployment`, the managed-file builders for local + GCR, public exports |
| `actions.ts`             | `DeploymentActionKind`, `DeploymentActionDescriptor`, `resolveDeploymentAction*` — shapes the host endpoints consume |
| `overrides.ts`           | `LocalDeploymentTargetOverrides`, `GoogleCloudRunDeploymentTargetOverrides`, their normalizers, `GITHUB_REPO_REGEX`, `stripGithubRepoPrefixes` |
| `cloud-run-terraform.ts` | Cloud Run terraform emitters, the `CLOUD_RUN_TEMPLATE_VERSION` stamp, the `TERRAFORM_RENAME_LEDGER`, `resolveSecretManagerName`, `collectSecretEnvBindings` |
| `gcp-bootstrap.ts`       | GCP-API helpers used by host middleware (`buildGcpProjectName`, `classifyProjectListResult`, `parseBillingAccountList`, `REQUIRED_GCP_APIS`, validators) |
| `plugin-state.ts`        | Read/write API for SugarDeploy's `pluginConfigurations[].config` slot (`getDeploymentSettings`, `getVersionedProjectIdentifiers`, builders) |
| `publish-targets.ts`     | `PublishTargetId` enum, `PublishTargetSettings`, defaulting + normalization for the publish-axis settings slot (Plan 046) |
| `netlify.ts`             | Netlify frontend deployment target: `NETLIFY_TEMPLATE_VERSION`, `FRONTEND_RENAME_LEDGER`, `buildNetlifyManagedFiles`, `collectNetlifyWarnings`, `normalizeNetlifyDeploymentTargetOverrides`, `isValidNetlifySiteId` |
| `published-web.ts`       | Per-game bundle root under `.sugarmagic/published-web/`: `BOOT_JSON_SCHEMA_VERSION`, `PublishedWebRuntimeSnapshot`, `buildPublishedWebManagedFiles`, `getPublishedWebDirectory` |
| `github-workflow.ts`     | `sugardeploy-deploy.yml` generator: `SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION`, `WORKFLOW_RENAME_LEDGER`, `buildSugarDeployGithubWorkflowFile`, `getSugarDeployGithubWorkflowPath`, `planNeedsGithubWorkflow` |
| `version-tags.ts`        | Pure `v{major}.0.{patch}` parsing + auto-increment + grouping helpers (`parseVersionTag`, `computeNextPatchTag`, `groupVersionTags`) for the Release workspace |

## SugarDeploy plugin state slot

SugarDeploy stores its per-project state in the `pluginConfigurations` array
under `pluginId: "sugardeploy"` (constant: `SUGARDEPLOY_PLUGIN_ID`). The
`config` record carries two keys:

```
config: {
  settings: DeploymentSettings,                 // publish + deploy target + overrides + project-level workingDirectory + githubRepo
  versionedProjectIdentifiers: Record<string, string>  // { v1: "k3m9p", v2: "abcde" } — preserved forever
}
```

The domain `GameProject` type does NOT carry deploy state directly. Reads
must go through the typed accessors:

- `getDeploymentSettings(gameProject)` — returns a normalized
  `DeploymentSettings`, falling back to defaults if the plugin isn't
  configured.
- `getVersionedProjectIdentifiers(gameProject)` — returns the suffix map,
  empty `{}` if absent.

Writes dispatch the generic `UpdatePluginConfigurationCommand`, built by:

- `buildUpdateDeploymentSettingsCommand(gameProject, settings)` — replaces
  the settings slot.
- `buildSetVersionedProjectIdentifierCommand(gameProject, major, suffix)` —
  idempotent suffix register; returns `null` when the entry already exists
  (so historical suffixes are immutable).

A legacy migration path lives in `packages/domain/src/game-project/index.ts`'s
`normalizeGameProject` — it lifts pre-45.7.5 top-level `deployment` /
`versionedProjectIdentifiers` fields into the plugin slot on read. Once a
project saves under the new shape the legacy slots disappear.

## Adding a terraform resource (rename-safe)

Generated terraform carries a `# SUGARMAGIC TEMPLATE VERSION: NN` stamp. When
on-disk version < current, the plugin walks `TERRAFORM_RENAME_LEDGER` and emits
the historical `moved {}` chain so `terraform plan` stays non-destructive for
existing games.

Procedure:

1. Add the new resource (or rename an existing one) in
   `cloud-run-terraform.ts`.
2. If it's a rename, add an entry to `TERRAFORM_RENAME_LEDGER`:

   ```ts
   {
     templateVersion: <next NN>,
     description: "Why this rename happened.",
     moves: [
       { from: "google_secret_manager_secret.openai_api_key", to: "google_secret_manager_secret.openai" }
     ]
   }
   ```

3. Bump `CLOUD_RUN_TEMPLATE_VERSION` to `next NN`.
4. Save a fresh wordlark project; verify `main.tf` carries the bumped stamp
   and the appropriate `moved {}` blocks if you renamed.
5. Update an existing game's on-disk `main.tf` stamp to one less than current
   manually and re-open in Studio to confirm the drift banner appears, the
   plugin regenerates with `moved {}` blocks for the gap, and the banner
   clears on save.

The ledger retains entries indefinitely; do not prune.

## Frontend rename ledger + workflow rename ledger

Two parallel ledgers cover the publish-side half on the same drift
discipline as `TERRAFORM_RENAME_LEDGER`:

- `FRONTEND_RENAME_LEDGER` in `netlify.ts` -- entries for files
  under `deployment/<host>/` when the file shape or names change.
  Drives the drift banner for `deployment/netlify/`. Owned per
  frontend deployment target (Cloudflare Pages etc. would add
  their own ledger alongside `netlify.ts`).
- `WORKFLOW_RENAME_LEDGER` in `github-workflow.ts` -- entries for
  files generated under `.github/workflows/` (today:
  `sugardeploy-deploy.yml`). Drives the drift banner for the GHA
  workflow stamp `SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION`.

Both follow the same rename-safe pattern: bump the template version
constant, add an entry to the ledger describing the rename, ship.
Old games regenerate with the historical chain applied; drift
banner clears on save.

## boot.json + frontend deployment target handlers

`buildPublishedWebManagedFiles(gameProject, snapshot)` emits the
per-game artifact root at `.sugarmagic/published-web/`:

- `boot.json` -- normalized game snapshot stamped with
  `BOOT_JSON_SCHEMA_VERSION`. The published-web runtime
  (`targets/web/src/App.tsx`) fetches this from the deployed
  origin at boot and asserts compatibility on read. See
  [ADR 019](/docs/adr/019-engine-vs-game-lifecycle-split.md)
  for the engine vs. game compatibility contract.
- `README.md` -- operational guide for what's generated vs.
  what the Build Frontend button produces.

`frontendDeploymentTargetHandlers` in `index.ts` is the per-host
registry (mirror of the backend `targetHandlers`). Adding a second
frontend host (Cloudflare Pages, S3, etc.) means:

1. Add the `FrontendDeploymentTargetId` to
   `packages/domain/src/deployment/index.ts`.
2. Add the override normalizer + `<host>.ts` module with its own
   `<HOST>_TEMPLATE_VERSION` + `FRONTEND_RENAME_LEDGER`.
3. Add the entry to `frontendDeploymentTargetHandlers` with
   `definition`, `normalizeOverrides`, optional `collectWarnings`,
   and `buildManagedFiles`.
4. Add a Studio tab in the SugarDeploy Provision workspace.
5. Add tests.

The shape is the same as adding a backend target -- one registry
entry, one managed-files builder, no Studio-core changes.

## Gateway runtime config (per-game plugin config)

Non-secret runtime config that the gateway reads at request time
(vector store ids, model identifiers, target language codes, etc.)
lives in each plugin's per-game configuration slot under
`pluginConfigurations[<pluginId>].config.*`, NOT in `.env` files
or shell exports. Plugins declare which config keys flow to the
gateway via `gatewayRuntimeConfigKeys`:

```ts
gatewayRuntimeConfigKeys: [
  {
    configKey: "openAiVectorStoreId",
    envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
    description: "OpenAI vector store id the gateway queries...",
    nonSecretAttestation: "safe-to-expose-publicly"
  }
]
```

`planGameDeployment` walks every enabled plugin's declarations,
validates each via `validateGatewayRuntimeConfigKey` (which
enforces the `SUGARMAGIC_<PLUGIN_ID_UPPER>_<KEY>` env var name
pattern and the secret-suffix backstop), and bakes the resulting
`Record<string, string>` into `plan.gatewayRuntimeConfigEnv`.
The deploy.sh `--set-env-vars=^@^...@...` block and the GHA
workflow's `deploy-backend` `env:` block both read from that
single map.

See [ADR 018](/docs/adr/018-sugardeploy-web-publish-target-architecture.md)
for the "non-secret attestation + name-pattern backstop" rationale.

## Secret naming

`resolveSecretManagerName(plan, secretKey)` returns the canonical Secret
Manager secret name for a given plan + key. The rule:

```
${overrides.serviceNamePrefix}-${slugify(secretKey)}
```

- Slugification enforces GCP's secret-name shape: lowercase, hyphen-separated,
  letter-leading, no consecutive hyphens, capped length.
- `mappingHint` on the deployment requirement (declared by the plugin that
  owns the secret) is what becomes the env var name in the container — it is
  decoupled from the secret name so the secret can be renamed via terraform
  `moved {}` without changing the env var the application reads.
- Single shared set of secret values per game-version (no per-service-unit
  scoping in v1).

`collectSecretEnvBindings(plan, serviceNamePrefix)` returns the
`{ envVarName, secretManagerName }` pairs the deploy.sh `--set-secrets`
flags need.

## Host endpoints

The SugarDeploy plugin contributes host middleware under
`packages/plugins/src/catalog/sugardeploy/host/middleware.ts`. The exported
`createSugarDeployHostMiddleware()` returns the Vite plugins that register
these endpoints:

| Endpoint                                          | Owner action                                          |
| ------------------------------------------------- | ----------------------------------------------------- |
| `POST /__sugardeploy/action`                      | Deploy / destroy / status / health / setup-infra / teardown-infra — the per-target dispatcher |
| `POST /__sugardeploy/list-billing-accounts`       | `gcloud beta billing accounts list` for the Create GCP Project picker |
| `POST /__sugardeploy/probe-gcp-project`           | "Does this GCP project exist and am I the owner?" |
| `POST /__sugardeploy/create-gcp-project`          | `gcloud projects create` + billing link + service enable |
| `POST /__sugardeploy/set-secret-value`            | `gcloud secrets versions add` with the value via stdin |
| `POST /__sugardeploy/secret-status`               | Per-secret last-version + last-updated lookup |
| `POST /__sugardeploy/template-version`            | Reports on-disk terraform template stamp vs current  |
| `POST /__sugardeploy/prepare-cut-major-version`   | Pre-flight for Cut New Major (git, clean tree, tag)   |
| `POST /__sugardeploy/tag-prior-major`             | `git tag v{prior}.0.0 HEAD`                            |
| `POST /__sugardeploy/untag-prior-major`           | `git tag -d v{prior}.0.0` (saga rollback)              |
| `POST /__sugardeploy/commit-major-version-bump`   | `git add -u` + `git commit` for the cut               |
| `POST /__sugardeploy/list-version-tags`           | `git tag --list 'v*.0.*'` grouped by major (Release workspace version history) |
| `POST /__sugardeploy/tag-patch-version`           | Auto-increment + `git tag v{N}.0.M+1 HEAD`; `dryRun: true` returns the plan without side effects |
| `POST /__sugardeploy/setup-github-workflow`       | `gh variable set` + `gh secret set --body-file -` for the GHA deploy workflow's identifier + credential set |
| `POST /__sugardeploy/build-published-web`         | Builds `@sugarmagic/target-web` and copies `dist/` into `.sugarmagic/published-web/dist/` (Plan 046 stopgap; Plan 048 reshapes this into a GHCR pull) |
| `POST /__sugardeploy/preflight-deploy-workflow`   | `gh run` pre-flight + repo-clean check before dispatching the deploy workflow |
| `POST /__sugardeploy/dispatch-deploy-workflow`    | `gh workflow run` for `sugardeploy-deploy.yml`        |
| `POST /__sugardeploy/get-deploy-workflow-status`  | `gh run view --json` polled by the Deploy workspace tracker |
| `POST /__sugardeploy/rerun-failed-jobs`           | `gh run rerun --failed` for a tracked run id          |

Every endpoint accepts JSON, returns `{ ok: boolean, ... }`. Side-effect
endpoints re-run the relevant pre-flight inside the handler — the Studio's
UI disable state is advisory, not authoritative.

## Adding a deployment target

`targetHandlers` in `index.ts` is the registry. To add a new target:

1. Add the `targetId` to `DeploymentTargetId` in `packages/domain/src/deployment/index.ts`.
2. Add the override normalizer to `overrides.ts` (one per target — its
   shape is target-specific).
3. Add an entry to `targetHandlers` with `definition`, `normalizeOverrides`,
   optional `collectWarnings`, and `buildManagedFiles`.
4. Add the per-target action descriptors to `actions.ts` (each `actionKind`
   maps to a `DeploymentActionDescriptor` — typically a `{ command, args, cwd }`
   for shell-out actions, or a `healthUrl` for HTTP probes).
5. Add a Studio tab for the new target's settings in the SugarDeploy
   workspace at `apps/studio/src/plugins/catalog/sugardeploy/index.tsx`
   (the Targets section's tab list auto-includes any registered target).
6. Add tests to `packages/testing/src/plugin-infrastructure.test.ts`.

If the new target involves any cloud-side bootstrap (project creation,
project ID validation, etc.), that's its own helper file alongside
`gcp-bootstrap.ts` (e.g. `aws-bootstrap.ts`).
