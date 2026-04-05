import type { GameProject } from "@sugarmagic/domain";

export interface LocalDeploymentTargetOverrides {
  workingDirectory: string;
  composeProjectName: string;
  gatewayHostPortBase: number;
}

export type GoogleCloudRunIngress =
  | "all"
  | "internal"
  | "internal-and-cloud-load-balancing";

export interface GoogleCloudRunDeploymentTargetOverrides {
  workingDirectory: string;
  projectId: string;
  region: string;
  serviceNamePrefix: string;
  containerPort: number;
  minInstances: number;
  maxInstances: number;
  ingress: GoogleCloudRunIngress;
  allowUnauthenticated: boolean;
}

function slugify(input: string): string {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return value || "sugarmagic";
}

function clampInteger(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number }
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const floored = Math.floor(numeric);
  const min = options?.min ?? Number.MIN_SAFE_INTEGER;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, floored));
}

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function defaultDeploymentSlug(gameProject: Pick<GameProject, "displayName" | "identity">): string {
  return slugify(gameProject.displayName || gameProject.identity.id || "sugarmagic-game");
}

export function normalizeLocalDeploymentTargetOverrides(
  input: Record<string, unknown> | null | undefined,
  gameProject?: Pick<GameProject, "displayName" | "identity">
): LocalDeploymentTargetOverrides {
  const fallbackSlug = gameProject
    ? defaultDeploymentSlug(gameProject)
    : "sugarmagic-local";
  return {
    workingDirectory:
      typeof input?.workingDirectory === "string" ? input.workingDirectory.trim() : "",
    composeProjectName: slugify(
      asNonEmptyString(input?.composeProjectName, `${fallbackSlug}-local`)
    ),
    gatewayHostPortBase: clampInteger(input?.gatewayHostPortBase, 8787, {
      min: 1024,
      max: 65535
    })
  };
}

export function normalizeGoogleCloudRunDeploymentTargetOverrides(
  input: Record<string, unknown> | null | undefined,
  gameProject?: Pick<GameProject, "displayName" | "identity">
): GoogleCloudRunDeploymentTargetOverrides {
  const fallbackSlug = gameProject
    ? defaultDeploymentSlug(gameProject)
    : "sugarmagic";
  const ingress =
    input?.ingress === "internal" ||
    input?.ingress === "internal-and-cloud-load-balancing" ||
    input?.ingress === "all"
      ? input.ingress
      : "all";
  return {
    workingDirectory:
      typeof input?.workingDirectory === "string" ? input.workingDirectory.trim() : "",
    projectId:
      typeof input?.projectId === "string" ? input.projectId.trim() : "",
    region: asNonEmptyString(input?.region, "us-central1"),
    serviceNamePrefix: slugify(
      asNonEmptyString(input?.serviceNamePrefix, `${fallbackSlug}-gateway`)
    ),
    containerPort: clampInteger(input?.containerPort, 8080, {
      min: 1024,
      max: 65535
    }),
    minInstances: clampInteger(input?.minInstances, 0, { min: 0, max: 100 }),
    maxInstances: clampInteger(input?.maxInstances, 2, { min: 1, max: 100 }),
    ingress,
    allowUnauthenticated: input?.allowUnauthenticated !== false
  };
}
