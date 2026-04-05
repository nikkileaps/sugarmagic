import type { DeploymentTargetId, DeploymentSettings } from "@sugarmagic/domain";
import type {
  DeploymentPlan,
} from "./index";
import {
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides
} from "./overrides";

export type DeploymentActionKind = "deploy" | "stop" | "status" | "health";

export interface DeploymentHostCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface DeploymentActionDescriptor {
  targetId: DeploymentTargetId;
  actionKind: DeploymentActionKind;
  supported: boolean;
  reason?: string;
  command?: DeploymentHostCommand;
  healthUrl?: string;
}

export interface DeploymentActionExecutionResult {
  ok: boolean;
  descriptor: DeploymentActionDescriptor;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
}

interface DeploymentExecutionContext {
  deploymentTargetId: DeploymentTargetId | null;
  targetOverrides: Record<string, Record<string, unknown>>;
}

function joinPath(base: string, relative: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${relative}`;
}

function resolveLocalAction(
  context: DeploymentExecutionContext,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  const overrides = normalizeLocalDeploymentTargetOverrides(
    context.targetOverrides.local
  );
  if (!overrides.workingDirectory) {
    return {
      targetId: "local",
      actionKind,
      supported: false,
      reason:
        "Local deployment actions require a Working Directory override that points at the game root on disk."
    };
  }

  const cwd = joinPath(overrides.workingDirectory, "deployment/local");
  const healthPort = overrides.gatewayHostPortBase;
  switch (actionKind) {
    case "deploy":
      return {
        targetId: "local",
        actionKind,
        supported: true,
        command: {
          command: "docker",
          args: ["compose", "up", "--build", "-d"],
          cwd
        },
        healthUrl: `http://localhost:${healthPort}/healthz`
      };
    case "stop":
      return {
        targetId: "local",
        actionKind,
        supported: true,
        command: {
          command: "docker",
          args: ["compose", "down"],
          cwd
        },
        healthUrl: `http://localhost:${healthPort}/healthz`
      };
    case "status":
      return {
        targetId: "local",
        actionKind,
        supported: true,
        command: {
          command: "docker",
          args: ["compose", "ps"],
          cwd
        },
        healthUrl: `http://localhost:${healthPort}/healthz`
      };
    case "health":
      return {
        targetId: "local",
        actionKind,
        supported: true,
        healthUrl: `http://localhost:${healthPort}/healthz`
      };
  }
}

function resolveGoogleCloudRunAction(
  context: DeploymentExecutionContext,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    context.targetOverrides["google-cloud-run"]
  );
  if (!overrides.workingDirectory) {
    return {
      targetId: "google-cloud-run",
      actionKind,
      supported: false,
      reason:
        "Google Cloud Run deployment actions require a Working Directory override that points at the game root on disk."
    };
  }

  const cwd = joinPath(overrides.workingDirectory, "deployment/google-cloud-run");
  switch (actionKind) {
    case "deploy":
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: true,
        command: {
          command: "bash",
          args: ["deploy.sh"],
          cwd
        }
      };
    case "status":
      if (!overrides.projectId) {
        return {
          targetId: "google-cloud-run",
          actionKind,
          supported: false,
          reason:
            "Google Cloud Run status requires a GCP project id override before SugarDeploy can run gcloud commands."
        };
      }
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: true,
        command: {
          command: "gcloud",
          args: [
            "run",
            "services",
            "list",
            "--platform",
            "managed",
            "--project",
            overrides.projectId,
            "--region",
            overrides.region
          ],
          cwd
        }
      };
    case "stop":
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: false,
        reason:
          "Google Cloud Run stop is not modeled yet; use gcloud or extend SugarDeploy with a destroy/scale action."
      };
    case "health":
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: false,
        reason:
          "Google Cloud Run health requires a deployed service URL; SugarDeploy does not resolve that automatically yet."
      };
  }
}

export function resolveDeploymentAction(
  plan: DeploymentPlan,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  return resolveDeploymentActionFromSettings(
    {
      deploymentTargetId: plan.deploymentTargetId,
      targetOverrides: {
        [plan.deploymentTargetId ?? ""]: plan.targetOverrides
      }
    },
    actionKind
  );
}

export function resolveDeploymentActionFromSettings(
  settings: Pick<DeploymentSettings, "deploymentTargetId" | "targetOverrides">,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  const targetId = settings.deploymentTargetId;
  if (!targetId) {
    return {
      targetId: "local",
      actionKind,
      supported: false,
      reason: "Select a deployment target before running SugarDeploy actions."
    };
  }

  switch (targetId) {
    case "local":
      return resolveLocalAction(settings, actionKind);
    case "google-cloud-run":
      return resolveGoogleCloudRunAction(settings, actionKind);
    case "aws-fargate":
      return {
        targetId,
        actionKind,
        supported: false,
        reason: "AWS Fargate execution actions are not implemented yet."
      };
  }
}

export function describeTargetOverrides(
  targetId: DeploymentTargetId,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  switch (targetId) {
    case "local":
      return { ...normalizeLocalDeploymentTargetOverrides(overrides) };
    case "google-cloud-run":
      return { ...normalizeGoogleCloudRunDeploymentTargetOverrides(overrides) };
    case "aws-fargate":
      return overrides;
  }
}
