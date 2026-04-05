export type DeploymentRequirementOwnerKind = "publish-target" | "plugin";

export type DeploymentRequirementKind =
  | "secret"
  | "proxy-route"
  | "runtime-service"
  | "topology";

export interface DeploymentRequirementBase {
  requirementId: string;
  ownerId: string;
  ownerKind: DeploymentRequirementOwnerKind;
  required: boolean;
  description?: string;
  tags?: string[];
}

export type SecretRequirementConsumption = "server-only" | "build-time";
export type SecretRequirementExposure = "public" | "private";

export interface SecretRequirement extends DeploymentRequirementBase {
  kind: "secret";
  secretKey: string;
  consumption: SecretRequirementConsumption;
  exposure: SecretRequirementExposure;
  mappingHint?: string;
}

export type ProxyRouteProtocol = "http-json" | "sse" | "websocket";
export type ProxyRouteConsumer = "browser-runtime" | "server-runtime";

export interface ProxyRouteRequirement extends DeploymentRequirementBase {
  kind: "proxy-route";
  routeId: string;
  protocol: ProxyRouteProtocol;
  consumer: ProxyRouteConsumer;
  pathHint?: string;
}

export type RuntimeServiceExecutionModel =
  | "request-response"
  | "worker"
  | "scheduled-job";

export type RuntimeServiceFamily = "node" | "python" | "container";
export type RuntimeServiceIsolation = "shared-allowed" | "isolated-required";
export type DeploymentResourceTier = "low" | "medium" | "high";

export interface DeploymentResourceProfile {
  tier?: DeploymentResourceTier;
  memoryInMb?: number;
  cpuUnits?: number;
}

export interface RuntimeServiceRequirement extends DeploymentRequirementBase {
  kind: "runtime-service";
  serviceId: string;
  executionModel: RuntimeServiceExecutionModel;
  runtimeFamily?: RuntimeServiceFamily;
  isolation: RuntimeServiceIsolation;
  resourceProfile?: DeploymentResourceProfile;
}

export type TopologyPlacement =
  | "co-locate-preferred"
  | "co-locate-required"
  | "separate-service-required";

export interface TopologyRequirement extends DeploymentRequirementBase {
  kind: "topology";
  subjectId: string;
  placement: TopologyPlacement;
}

export type DeploymentRequirement =
  | SecretRequirement
  | ProxyRouteRequirement
  | RuntimeServiceRequirement
  | TopologyRequirement;

export type DeploymentRequirementInput = Partial<DeploymentRequirement> & {
  kind?: DeploymentRequirementKind;
};

export interface DeploymentRequirementValidationIssue {
  index: number;
  requirementId?: string;
  ownerId?: string;
  kind?: DeploymentRequirementKind;
  field: string;
  message: string;
}

export interface DeploymentRequirementValidationResult {
  success: boolean;
  normalized: DeploymentRequirement[];
  errors: DeploymentRequirementValidationIssue[];
}

export function createDeploymentRequirementId(input: {
  ownerId: string;
  kind: DeploymentRequirementKind;
  key: string;
}): string {
  const ownerId = input.ownerId.trim();
  const key = input.key.trim();
  if (!ownerId) {
    throw new Error("Deployment requirement ownerId is required");
  }
  if (!key) {
    throw new Error("Deployment requirement key is required");
  }
  return `${ownerId}:${input.kind}:${key}`;
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const normalized = Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePositiveInteger(
  value: number | undefined
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeResourceProfile(
  resourceProfile: DeploymentResourceProfile | undefined
): DeploymentResourceProfile | undefined {
  if (!resourceProfile) return undefined;
  const normalized: DeploymentResourceProfile = {
    tier: resourceProfile.tier,
    memoryInMb: normalizePositiveInteger(resourceProfile.memoryInMb),
    cpuUnits: normalizePositiveInteger(resourceProfile.cpuUnits)
  };
  if (!normalized.tier && !normalized.memoryInMb && !normalized.cpuUnits) {
    return undefined;
  }
  return normalized;
}

function normalizeBase<T extends DeploymentRequirementBase>(
  requirement: T
): Omit<T, "description" | "tags"> & {
  description?: string;
  tags?: string[];
} {
  const requirementId = requirement.requirementId.trim();
  const ownerId = requirement.ownerId.trim();
  if (!requirementId) {
    throw new Error("Deployment requirement id is required");
  }
  if (!ownerId) {
    throw new Error("Deployment requirement ownerId is required");
  }
  return {
    ...requirement,
    requirementId,
    ownerId,
    required: requirement.required !== false,
    description:
      typeof requirement.description === "string" &&
      requirement.description.trim().length > 0
        ? requirement.description.trim()
        : undefined,
    tags: normalizeTags(requirement.tags)
  };
}

function toValidationIssue(
  input: DeploymentRequirementInput,
  index: number,
  field: string,
  message: string
): DeploymentRequirementValidationIssue {
  return {
    index,
    requirementId:
      typeof input.requirementId === "string" && input.requirementId.trim().length > 0
        ? input.requirementId.trim()
        : undefined,
    ownerId:
      typeof input.ownerId === "string" && input.ownerId.trim().length > 0
        ? input.ownerId.trim()
        : undefined,
    kind: input.kind,
    field,
    message
  };
}

function normalizeDeploymentRequirementUnchecked(
  requirement: DeploymentRequirement
): DeploymentRequirement {
  const base = normalizeBase(requirement);
  switch (requirement.kind) {
    case "secret":
      return {
        ...base,
        kind: "secret",
        secretKey: requirement.secretKey.trim(),
        consumption: requirement.consumption,
        exposure: requirement.exposure,
        mappingHint:
          typeof requirement.mappingHint === "string" &&
          requirement.mappingHint.trim().length > 0
            ? requirement.mappingHint.trim()
            : undefined
      };
    case "proxy-route":
      return {
        ...base,
        kind: "proxy-route",
        routeId: requirement.routeId.trim(),
        protocol: requirement.protocol,
        consumer: requirement.consumer,
        pathHint:
          typeof requirement.pathHint === "string" && requirement.pathHint.trim()
            ? requirement.pathHint.trim()
            : undefined
      };
    case "runtime-service":
      return {
        ...base,
        kind: "runtime-service",
        serviceId: requirement.serviceId.trim(),
        executionModel: requirement.executionModel,
        runtimeFamily: requirement.runtimeFamily,
        isolation: requirement.isolation,
        resourceProfile: normalizeResourceProfile(requirement.resourceProfile)
      };
    case "topology":
      return {
        ...base,
        kind: "topology",
        subjectId: requirement.subjectId.trim(),
        placement: requirement.placement
      };
  }
}

export function validateDeploymentRequirements(
  requirements: DeploymentRequirementInput[] | null | undefined
): DeploymentRequirementValidationResult {
  if (!requirements) {
    return {
      success: true,
      normalized: [],
      errors: []
    };
  }

  const normalized: DeploymentRequirement[] = [];
  const errors: DeploymentRequirementValidationIssue[] = [];

  requirements.forEach((requirement, index) => {
    if (!requirement.kind) {
      errors.push(
        toValidationIssue(
          requirement,
          index,
          "kind",
          "Deployment requirement kind is required"
        )
      );
      return;
    }

    const requirementId =
      typeof requirement.requirementId === "string"
        ? requirement.requirementId.trim()
        : "";
    const ownerId =
      typeof requirement.ownerId === "string" ? requirement.ownerId.trim() : "";

    if (!requirementId) {
      errors.push(
        toValidationIssue(
          requirement,
          index,
          "requirementId",
          "Deployment requirement id is required"
        )
      );
    }
    if (!ownerId) {
      errors.push(
        toValidationIssue(
          requirement,
          index,
          "ownerId",
          "Deployment requirement ownerId is required"
        )
      );
    }
    if (!requirement.kind) {
      return;
    }

    switch (requirement.kind) {
      case "secret": {
        const secretKey =
          typeof requirement.secretKey === "string"
            ? requirement.secretKey.trim()
            : "";
        if (!secretKey) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "secretKey",
              "Secret requirement secretKey is required"
            )
          );
        }
        if (!requirement.consumption) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "consumption",
              "Secret requirement consumption is required"
            )
          );
        }
        if (!requirement.exposure) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "exposure",
              "Secret requirement exposure is required"
            )
          );
        }
        break;
      }
      case "proxy-route": {
        const routeId =
          typeof requirement.routeId === "string" ? requirement.routeId.trim() : "";
        if (!routeId) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "routeId",
              "Proxy route requirement routeId is required"
            )
          );
        }
        if (!requirement.protocol) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "protocol",
              "Proxy route requirement protocol is required"
            )
          );
        }
        if (!requirement.consumer) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "consumer",
              "Proxy route requirement consumer is required"
            )
          );
        }
        break;
      }
      case "runtime-service": {
        const serviceId =
          typeof requirement.serviceId === "string"
            ? requirement.serviceId.trim()
            : "";
        if (!serviceId) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "serviceId",
              "Runtime service requirement serviceId is required"
            )
          );
        }
        if (!requirement.executionModel) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "executionModel",
              "Runtime service requirement executionModel is required"
            )
          );
        }
        if (!requirement.isolation) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "isolation",
              "Runtime service requirement isolation is required"
            )
          );
        }
        break;
      }
      case "topology": {
        const subjectId =
          typeof requirement.subjectId === "string"
            ? requirement.subjectId.trim()
            : "";
        if (!subjectId) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "subjectId",
              "Topology requirement subjectId is required"
            )
          );
        }
        if (!requirement.placement) {
          errors.push(
            toValidationIssue(
              requirement,
              index,
              "placement",
              "Topology requirement placement is required"
            )
          );
        }
        break;
      }
    }

    const hasErrorsForRequirement = errors.some((error) => error.index === index);
    if (hasErrorsForRequirement) {
      return;
    }

    normalized.push(
      normalizeDeploymentRequirementUnchecked(requirement as DeploymentRequirement)
    );
  });

  return {
    success: errors.length === 0,
    normalized: errors.length === 0 ? normalized.sort((left, right) =>
      left.requirementId.localeCompare(right.requirementId)
    ) : [],
    errors
  };
}

export function normalizeDeploymentRequirement(
  requirement: DeploymentRequirement
): DeploymentRequirement {
  const result = validateDeploymentRequirements([requirement]);
  if (!result.success) {
    throw new Error(
      result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
    );
  }
  return result.normalized[0]!;
}

export function normalizeDeploymentRequirements(
  requirements: DeploymentRequirement[] | null | undefined
): DeploymentRequirement[] {
  const result = validateDeploymentRequirements(requirements);
  if (!result.success) {
    throw new Error(
      result.errors
        .map((error) => `[#${error.index} ${error.field}] ${error.message}`)
        .join("; ")
    );
  }
  return result.normalized;
}
