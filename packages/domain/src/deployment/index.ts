// Story 45 — backend deployment targets (where the GAME SERVICES run).
// Pre-46.6 this enum was named `DeploymentTargetId` flat; renamed for
// symmetry once 46.6 introduced the parallel frontend axis.
export type BackendDeploymentTargetId = "local" | "google-cloud-run";

/**
 * @deprecated Use `BackendDeploymentTargetId`. Kept as an alias only to
 * tide the legacy `DeploymentTargetId` imports through the 46.6 rename
 * sweep; remove once the codebase fully adopts the role-specific names.
 */
export type DeploymentTargetId = BackendDeploymentTargetId;

// Story 46.6 — frontend deployment targets (where the GAME CLIENT static
// artifact runs). Lives on a separate axis from the backend so the user
// can pick "Cloud Run + Netlify" or future "Cloud Run + Cloudflare Pages"
// independently. Initial entry: Netlify.
export type FrontendDeploymentTargetId = "netlify";

export interface DeploymentSettings {
  // Story 46.2 — `publishTargetId` moved off `DeploymentSettings` and
  // into the SugarDeploy plugin's `config.publishSettings` slot. Reads
  // go through `getPublishSettings(gameProject)` from
  // `@sugarmagic/plugins`.
  //
  // Story 46.6 — `deploymentTargetId` renamed to
  // `backendDeploymentTargetId` and `frontendDeploymentTargetId` added
  // so the two axes can be chosen independently. Pre-46.6 project files
  // are migrated at read time in `normalizeDeploymentSettings` (legacy
  // `deploymentTargetId` is read into `backendDeploymentTargetId`).
  backendDeploymentTargetId: BackendDeploymentTargetId | null;
  frontendDeploymentTargetId: FrontendDeploymentTargetId | null;
  // Project-level source paths. These live on DeploymentSettings (not in
  // targetOverrides) because they describe the *source* the deployment
  // runs against, which is the same regardless of which target you ship
  // to. Story 45.8.5.
  workingDirectory: string;
  githubRepo: string;
  targetOverrides: Record<string, Record<string, unknown>>;
}

export function createDefaultDeploymentSettings(): DeploymentSettings {
  return {
    backendDeploymentTargetId: null,
    frontendDeploymentTargetId: null,
    workingDirectory: "",
    githubRepo: "",
    targetOverrides: {}
  };
}

export function normalizeDeploymentSettings(
  input: Partial<DeploymentSettings> & {
    // Story 46.6 — pre-rename projects persisted `deploymentTargetId`
    // at this slot; accept it on input for back-compat then forget it.
    deploymentTargetId?: BackendDeploymentTargetId | null;
  } | null | undefined
): DeploymentSettings {
  const rawBackend =
    input?.backendDeploymentTargetId ?? input?.deploymentTargetId ?? null;
  const backendDeploymentTargetId =
    rawBackend === "local" || rawBackend === "google-cloud-run"
      ? rawBackend
      : null;
  const frontendDeploymentTargetId =
    input?.frontendDeploymentTargetId === "netlify"
      ? input.frontendDeploymentTargetId
      : null;

  const targetOverrides: Record<string, Record<string, unknown>> = {};
  if (input?.targetOverrides && typeof input.targetOverrides === "object") {
    for (const [targetId, overrides] of Object.entries(input.targetOverrides)) {
      if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
        continue;
      }
      targetOverrides[targetId] = { ...overrides };
    }
  }

  // Story 45.8.5 — read project-level workingDirectory + githubRepo with
  // back-compat fallback into the legacy per-target locations. Old project
  // files persisted these under targetOverrides; new ones live at the
  // DeploymentSettings level. Fallback order: explicit project-level value
  // > GCR override > Local override > "".
  const workingDirectory =
    asTrimmedString(input?.workingDirectory) ||
    asTrimmedString(targetOverrides["google-cloud-run"]?.workingDirectory) ||
    asTrimmedString(targetOverrides.local?.workingDirectory) ||
    "";
  const githubRepo =
    asTrimmedString(input?.githubRepo) ||
    asTrimmedString(targetOverrides["google-cloud-run"]?.githubRepo) ||
    "";

  return {
    backendDeploymentTargetId,
    frontendDeploymentTargetId,
    workingDirectory,
    githubRepo,
    targetOverrides
  };
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getDeploymentTargetOverrides(
  settings: DeploymentSettings,
  targetId: string
): Record<string, unknown> {
  return settings.targetOverrides[targetId] ?? {};
}
