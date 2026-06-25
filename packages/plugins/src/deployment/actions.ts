import type {
  BackendDeploymentTargetId,
  DeploymentSettings,
  GameProject
} from "@sugarmagic/domain";
import type {
  DeploymentPlan,
} from "./index";
import {
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides
} from "./overrides";

export type DeploymentActionKind =
  | "deploy"
  | "destroy"
  | "status"
  | "health"
  | "setup-infra"
  | "teardown-infra";

export interface DeploymentHostCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface DeploymentActionDescriptor {
  targetId: BackendDeploymentTargetId;
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
  // Story 46.6 — renamed from `deploymentTargetId` for symmetry with
  // the new frontend axis. Backend-only because the action descriptors
  // built here (deploy/destroy/health/status/setup-infra/teardown-infra)
  // operate on services + secrets + IAM, all backend-side concerns.
  backendDeploymentTargetId: BackendDeploymentTargetId | null;
  targetOverrides: Record<string, Record<string, unknown>>;
  // 45.6 — the normalizer derives projectId / composeProjectName from the
  // game project's identity + majorVersion + versionedProjectIdentifiers
  // (45.4.7). Without it, gcloud-shaped descriptors (status, destroy)
  // fall back to the bare `sugarmagic-vN` slug and target the wrong GCP
  // project. Optional so callers without a project (CLI-style settings
  // resolution) still type-check; production callers must pass it.
  gameProject?: GameProject | null;
}

function joinPath(base: string, relative: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${relative}`;
}

function resolveLocalAction(
  context: DeploymentExecutionContext,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  const overrides = normalizeLocalDeploymentTargetOverrides(
    context.targetOverrides.local,
    context.gameProject ?? undefined
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
        healthUrl: `http://localhost:${healthPort}/health`
      };
    case "destroy":
      // Local "destroy" parallels Cloud Run "destroy": tear the running
      // deployment down completely. `docker compose down` removes the
      // containers (and the default network); a subsequent Deploy
      // rebuilds and recreates them. Images stay cached.
      return {
        targetId: "local",
        actionKind,
        supported: true,
        command: {
          command: "docker",
          args: ["compose", "down"],
          cwd
        },
        healthUrl: `http://localhost:${healthPort}/health`
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
        healthUrl: `http://localhost:${healthPort}/health`
      };
    case "health":
      return {
        targetId: "local",
        actionKind,
        supported: true,
        healthUrl: `http://localhost:${healthPort}/health`
      };
    case "setup-infra":
    case "teardown-infra":
      return {
        targetId: "local",
        actionKind,
        supported: false,
        reason:
          "Setup Infra / Teardown Infra are Cloud Run-only; the Local target uses docker compose lifecycle (deploy / stop) instead."
      };
  }
}

function resolveGoogleCloudRunAction(
  context: DeploymentExecutionContext,
  actionKind: DeploymentActionKind
): DeploymentActionDescriptor {
  const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    context.targetOverrides["google-cloud-run"],
    context.gameProject ?? undefined
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
    case "destroy":
      // Story 45.6: deletes the Cloud Run service(s) for this game's plan
      // (the middleware iterates the plan-derived service names, each
      // with not-found tolerance so re-Destroy is a clean no-op).
      // Artifact Registry, IAM, WIF, and Secret Manager state stay
      // intact; a subsequent Deploy brings the service back without
      // re-running Setup Infra. Destroy is the destructive counterpart
      // to Deploy at the service-definition level; full teardown
      // (terraform destroy) is a separate Teardown Infra action.
      if (!overrides.projectId) {
        return {
          targetId: "google-cloud-run",
          actionKind,
          supported: false,
          reason:
            "Google Cloud Run destroy requires a GCP project id override before SugarDeploy can run gcloud commands."
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
            "delete",
            "--quiet",
            "--project",
            overrides.projectId,
            "--region",
            overrides.region
          ],
          cwd
        }
      };
    case "health":
      // Story 45.6: the middleware resolves the deployed service URL via
      // `gcloud run services describe ... --format='value(status.url)'`
      // and probes <url>/health with a 5s AbortSignal timeout. If describe
      // returns no URL (service not deployed), middleware reports
      // supported: false with reason "Service is not deployed".
      if (!overrides.projectId) {
        return {
          targetId: "google-cloud-run",
          actionKind,
          supported: false,
          reason:
            "Google Cloud Run health requires a GCP project id override before SugarDeploy can run gcloud commands."
        };
      }
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: true
      };
    case "setup-infra":
      // Multi-step on the host side (terraform init + terraform apply). The
      // descriptor advertises the action as supported and points at the
      // terraform working directory; the middleware orchestrates the actual
      // command sequence and enforces the terraform-on-PATH precondition.
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: true,
        command: {
          command: "terraform",
          args: ["apply", "-auto-approve", "-input=false"],
          cwd: joinPath(cwd, "terraform")
        }
      };
    case "teardown-infra":
      // Multi-step on the host side: delete every declared Cloud Run service
      // first (each tolerating not-found), THEN run `terraform destroy`. The
      // service-delete pass is computed by the middleware against the plan,
      // not represented in this descriptor — the descriptor advertises the
      // terminal terraform destroy command for transparency / UI rendering.
      return {
        targetId: "google-cloud-run",
        actionKind,
        supported: true,
        command: {
          command: "terraform",
          args: ["destroy", "-auto-approve", "-input=false"],
          cwd: joinPath(cwd, "terraform")
        }
      };
  }
}

export function resolveDeploymentAction(
  plan: DeploymentPlan,
  actionKind: DeploymentActionKind,
  gameProject?: GameProject | null
): DeploymentActionDescriptor {
  return resolveDeploymentActionFromSettings(
    {
      backendDeploymentTargetId: plan.backendDeploymentTargetId,
      targetOverrides: {
        [plan.backendDeploymentTargetId ?? ""]: plan.targetOverrides
      }
    },
    actionKind,
    gameProject
  );
}

export function resolveDeploymentActionFromSettings(
  settings: Pick<DeploymentSettings, "backendDeploymentTargetId" | "targetOverrides">,
  actionKind: DeploymentActionKind,
  gameProject?: GameProject | null
): DeploymentActionDescriptor {
  const targetId = settings.backendDeploymentTargetId;
  if (!targetId) {
    return {
      targetId: "local",
      actionKind,
      supported: false,
      reason: "Select a deployment target before running SugarDeploy actions."
    };
  }

  const context: DeploymentExecutionContext = {
    backendDeploymentTargetId: settings.backendDeploymentTargetId,
    targetOverrides: settings.targetOverrides as Record<
      string,
      Record<string, unknown>
    >,
    gameProject
  };

  switch (targetId) {
    case "local":
      return resolveLocalAction(context, actionKind);
    case "google-cloud-run":
      return resolveGoogleCloudRunAction(context, actionKind);
  }
}

export function describeTargetOverrides(
  targetId: BackendDeploymentTargetId,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  switch (targetId) {
    case "local":
      return { ...normalizeLocalDeploymentTargetOverrides(overrides) };
    case "google-cloud-run":
      return { ...normalizeGoogleCloudRunDeploymentTargetOverrides(overrides) };
  }
}
