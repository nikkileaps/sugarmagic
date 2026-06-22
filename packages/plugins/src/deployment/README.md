# SugarDeploy deployment package

This directory contains the deployment-target implementation that the SugarDeploy
plugin (`packages/plugins/src/catalog/sugardeploy/`) leans on. The catalog entry
is a thin shell that registers the plugin, contributes host middleware, and
exposes a Studio workspace; the substance — terraform generation, deploy script
emission, action descriptors, secret naming, override normalization, plugin
state — lives here.

For the architectural rules, read [ADR 017](/docs/adr/017-sugardeploy-cloud-run-architecture.md).
For the epic that shipped this, read [Plan 045](/docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md).

## File layout

| File                     | Owns                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `index.ts`               | Target handler registry (`targetHandlers`), `planGameDeployment`, the managed-file builders for local + GCR, public exports |
| `actions.ts`             | `DeploymentActionKind`, `DeploymentActionDescriptor`, `resolveDeploymentAction*` — shapes the host endpoints consume |
| `overrides.ts`           | `LocalDeploymentTargetOverrides`, `GoogleCloudRunDeploymentTargetOverrides`, their normalizers, `GITHUB_REPO_REGEX`, `stripGithubRepoPrefixes` |
| `cloud-run-terraform.ts` | Cloud Run terraform emitters, the `CLOUD_RUN_TEMPLATE_VERSION` stamp, the `TERRAFORM_RENAME_LEDGER`, `resolveSecretManagerName`, `collectSecretEnvBindings` |
| `gcp-bootstrap.ts`       | GCP-API helpers used by host middleware (`buildGcpProjectName`, `classifyProjectListResult`, `parseBillingAccountList`, `REQUIRED_GCP_APIS`, validators) |
| `plugin-state.ts`        | Read/write API for SugarDeploy's `pluginConfigurations[].config` slot (`getDeploymentSettings`, `getVersionedProjectIdentifiers`, builders) |

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
