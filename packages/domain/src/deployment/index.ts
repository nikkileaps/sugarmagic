export type PublishTargetId = "web";

export type DeploymentTargetId =
  | "local"
  | "google-cloud-run"
  | "aws-fargate";

export interface DeploymentSettings {
  publishTargetId: PublishTargetId;
  deploymentTargetId: DeploymentTargetId | null;
  targetOverrides: Record<string, Record<string, unknown>>;
}

export function createDefaultDeploymentSettings(): DeploymentSettings {
  return {
    publishTargetId: "web",
    deploymentTargetId: null,
    targetOverrides: {}
  };
}

export function normalizeDeploymentSettings(
  input: Partial<DeploymentSettings> | null | undefined
): DeploymentSettings {
  const publishTargetId = input?.publishTargetId === "web" ? "web" : "web";
  const deploymentTargetId =
    input?.deploymentTargetId === "local" ||
    input?.deploymentTargetId === "google-cloud-run" ||
    input?.deploymentTargetId === "aws-fargate"
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

  return {
    publishTargetId,
    deploymentTargetId,
    targetOverrides
  };
}

export function getDeploymentTargetOverrides(
  settings: DeploymentSettings,
  targetId: string
): Record<string, unknown> {
  return settings.targetOverrides[targetId] ?? {};
}
