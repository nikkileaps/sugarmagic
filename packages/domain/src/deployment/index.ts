export type PublishTargetId = "web";

export type DeploymentTargetId = "local" | "google-cloud-run";

export interface DeploymentSettings {
  publishTargetId: PublishTargetId;
  deploymentTargetId: DeploymentTargetId | null;
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
    publishTargetId: "web",
    deploymentTargetId: null,
    workingDirectory: "",
    githubRepo: "",
    targetOverrides: {}
  };
}

export function normalizeDeploymentSettings(
  input: Partial<DeploymentSettings> | null | undefined
): DeploymentSettings {
  const publishTargetId = input?.publishTargetId === "web" ? "web" : "web";
  const deploymentTargetId =
    input?.deploymentTargetId === "local" ||
    input?.deploymentTargetId === "google-cloud-run"
      ? input.deploymentTargetId
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
    publishTargetId,
    deploymentTargetId,
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
