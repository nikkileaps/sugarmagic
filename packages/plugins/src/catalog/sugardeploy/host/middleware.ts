// SugarDeploy plugin's host-middleware contribution. All `/__sugardeploy/*`
// routes live here, owned by the plugin end-to-end. Previously inline in
// apps/studio/vite.config.ts (45.4 + 45.4.5), which gave the Studio dev
// server hardcoded knowledge of one specific plugin and forced the React
// side to compute plugin-derived service names because the middleware
// couldn't reach planGameDeployment from the config-load bundle. The
// 45.4.6 refactor lifts everything inside the plugin tree, restores the
// server-side contract (planGameDeployment is a sibling import now), and
// reduces Studio's vite.config.ts to one plugin-agnostic registry line.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin as VitePlugin } from "vite";
import {
  ensureBinaryOnPath,
  runHostCommand,
  runHostCommandSequence,
  type HostCommandStep
} from "../../../host";
import {
  normalizeDeploymentSettings,
  normalizeGameProject,
  type GameProject
} from "../../../host/domain-bridge";
import {
  resolveDeploymentActionFromSettings,
  type DeploymentActionExecutionResult,
  type DeploymentActionKind
} from "../../../deployment/actions";
import {
  getCloudRunServiceNamesForPlan,
  planGameDeployment,
  resolveSecretManagerName
} from "../../../deployment/index";
import {
  CLOUD_RUN_TEMPLATE_VERSION,
  parseTemplateVersionStamp
} from "../../../deployment/cloud-run-terraform";
import {
  REQUIRED_GCP_APIS,
  buildGcpProjectName,
  classifyProjectListResult,
  isValidGcpProjectId,
  parseBillingAccountList,
  type GcpProjectProbeStatus
} from "../../../deployment/gcp-bootstrap";
import { normalizeGoogleCloudRunDeploymentTargetOverrides } from "../../../deployment/overrides";
import { getDeploymentSettings } from "../../../deployment/plugin-state";

interface SugarDeployActionRequest {
  actionKind: DeploymentActionKind;
  gameProject?: unknown;
}

interface CreateGcpProjectRequest {
  projectId: unknown;
  displayName: unknown;
  majorVersion: unknown;
  billingAccountId: unknown;
}

const SUGARDEPLOY_ACTION_KINDS: ReadonlySet<DeploymentActionKind> = new Set([
  "deploy",
  "destroy",
  "status",
  "health",
  "setup-infra",
  "teardown-infra"
]);

function readJsonBody(
  req: import("node:http").IncomingMessage
): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    let buffer = "";
    req.on("data", (chunk) => {
      buffer += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolveBody(buffer.trim().length > 0 ? JSON.parse(buffer) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(
  res: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown
) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function tryNormalizeGameProject(input: unknown): GameProject | null {
  try {
    return normalizeGameProject(input as never);
  } catch {
    return null;
  }
}

async function ensureTerraformOnPath(): Promise<string | null> {
  const result = await ensureBinaryOnPath("terraform", {
    installHint:
      "Install terraform (https://developer.hashicorp.com/terraform/downloads) and ensure it is on your PATH before running Setup Infra / Teardown Infra."
  });
  return result.available ? null : result.reason;
}

async function ensureGcloudOnPath(): Promise<string | null> {
  const result = await ensureBinaryOnPath("gcloud", {
    installHint:
      "Install the Google Cloud SDK (https://cloud.google.com/sdk/docs/install) and run `gcloud auth login` + `gcloud auth application-default login` before running SugarDeploy GCP actions."
  });
  return result.available ? null : result.reason;
}

// Story 45.6 — Cloud Run + local health probe. Single-shot fetch with a 5s
// AbortSignal timeout; no retries, no redirect follow. The body is
// truncated to 512 bytes so a chatty gateway doesn't choke the response.
// For Cloud Run the deployed service URL isn't known until after deploy,
// so this resolves it via `gcloud run services describe <service-name>
// --format='value(status.url)' --project --region` first.
interface HealthProbeResult {
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  bodyPreview: string;
  resolvedUrl: string | null;
  error?: string;
}

async function probeServiceHealth(
  descriptor: import("../../../deployment/actions").DeploymentActionDescriptor,
  normalizedGameProject: GameProject | null
): Promise<HealthProbeResult> {
  let healthUrl: string | null = null;

  if (descriptor.targetId === "google-cloud-run") {
    if (!normalizedGameProject) {
      return {
        ok: false,
        statusCode: null,
        durationMs: 0,
        bodyPreview: "",
        resolvedUrl: null,
        error: "Game project payload required to resolve Cloud Run service URL."
      };
    }
    const plan = planGameDeployment(normalizedGameProject);
    const serviceNames = getCloudRunServiceNamesForPlan(plan);
    if (serviceNames.length === 0) {
      return {
        ok: false,
        statusCode: null,
        durationMs: 0,
        bodyPreview: "",
        resolvedUrl: null,
        error: "No service units declared by enabled plugins; nothing to probe."
      };
    }
    const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
      getDeploymentSettings(normalizedGameProject).targetOverrides["google-cloud-run"],
      normalizedGameProject
    );
    const gcloudError = await ensureGcloudOnPath();
    if (gcloudError !== null) {
      return {
        ok: false,
        statusCode: null,
        durationMs: 0,
        bodyPreview: "",
        resolvedUrl: null,
        error: gcloudError
      };
    }
    // Probe the FIRST service unit. Multi-service plans get treated as
    // single-gateway for now; per-unit probe expansion is a follow-up.
    const describeResult = await runHostCommand({
      command: "gcloud",
      args: [
        "run",
        "services",
        "describe",
        serviceNames[0],
        "--format=value(status.url)",
        "--project",
        cloudRunOverrides.projectId,
        "--region",
        cloudRunOverrides.region
      ],
      cwd: process.cwd()
    });
    if (describeResult.exitCode !== 0) {
      const notFound = /(?:NOT_FOUND|not found|could not be found)/i.test(
        describeResult.stderr
      );
      return {
        ok: false,
        statusCode: null,
        durationMs: 0,
        bodyPreview: "",
        resolvedUrl: null,
        error: notFound
          ? `Cloud Run service \`${serviceNames[0]}\` is not deployed.`
          : `gcloud describe failed with exit code ${describeResult.exitCode}: ${describeResult.stderr.trim()}`
      };
    }
    const baseUrl = describeResult.stdout.trim();
    if (!baseUrl) {
      return {
        ok: false,
        statusCode: null,
        durationMs: 0,
        bodyPreview: "",
        resolvedUrl: null,
        error: `gcloud described the service but returned an empty URL — is \`${serviceNames[0]}\` actually deployed?`
      };
    }
    healthUrl = `${baseUrl}/health`;
  } else if (descriptor.healthUrl) {
    healthUrl = descriptor.healthUrl;
  }

  if (!healthUrl) {
    return {
      ok: false,
      statusCode: null,
      durationMs: 0,
      bodyPreview: "",
      resolvedUrl: null,
      error: `Health probe needs a target URL; descriptor for ${descriptor.targetId} did not provide one.`
    };
  }

  const start = performance.now();
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual"
    });
    const bodyText = await response.text().catch(() => "");
    const bodyPreview = bodyText.slice(0, 512);
    return {
      ok: response.ok,
      statusCode: response.status,
      durationMs: performance.now() - start,
      bodyPreview,
      resolvedUrl: healthUrl
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      durationMs: performance.now() - start,
      bodyPreview: "",
      resolvedUrl: healthUrl,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeGcpProjectOwnership(projectId: string): Promise<{
  status: GcpProjectProbeStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  // Ownership probe — see classifyProjectListResult docstring for why this
  // uses `projects list --filter` instead of `projects describe`.
  const result = await runHostCommand({
    command: "gcloud",
    args: [
      "projects",
      "list",
      `--filter=projectId:${projectId}`,
      "--format=json"
    ],
    cwd: process.cwd()
  });
  return {
    status: classifyProjectListResult(result.exitCode, result.stdout),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function createActionDispatcherPlugin(): VitePlugin {
  return {
    name: "sugardeploy-host-actions",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/action",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<SugarDeployActionRequest>;
            const actionKind = body.actionKind;
            if (
              !actionKind ||
              !SUGARDEPLOY_ACTION_KINDS.has(actionKind as DeploymentActionKind)
            ) {
              sendJson(res, 400, {
                ok: false,
                message: "Invalid SugarDeploy action."
              });
              return;
            }

            const normalizedGameProject = tryNormalizeGameProject(body.gameProject);
            const deploymentSettings = normalizedGameProject
              ? getDeploymentSettings(normalizedGameProject)
              : normalizeDeploymentSettings(null);
            const descriptor = resolveDeploymentActionFromSettings(
              deploymentSettings,
              actionKind as DeploymentActionKind,
              normalizedGameProject
            );

            if (!descriptor.supported) {
              sendJson(res, 400, {
                ok: false,
                descriptor,
                exitCode: null,
                stdout: "",
                stderr: "",
                message:
                  descriptor.reason ?? "SugarDeploy action is not supported."
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            // Story 45.6 — health probe. No shell command runs; instead the
            // middleware resolves the service URL (gcloud describe for Cloud
            // Run, descriptor.healthUrl for local) and performs an HTTP
            // probe with a 5s AbortSignal timeout. Returns the structured
            // result via stdout so the existing result-box rendering picks
            // it up.
            if (actionKind === "health") {
              const probeResult = await probeServiceHealth(
                descriptor,
                normalizedGameProject
              );
              const summary = probeResult.ok
                ? `Health probe ${probeResult.resolvedUrl ?? ""}: ${probeResult.statusCode} OK in ${Math.round(probeResult.durationMs)}ms`
                : probeResult.error
                ? `Health probe ${probeResult.resolvedUrl ?? "<no url>"}: ${probeResult.error}`
                : `Health probe ${probeResult.resolvedUrl ?? "<no url>"}: HTTP ${probeResult.statusCode ?? "?"}`;
              sendJson(res, probeResult.ok ? 200 : 500, {
                ok: probeResult.ok,
                descriptor,
                exitCode: probeResult.ok ? 0 : 1,
                stdout: `${summary}\n${probeResult.bodyPreview}`,
                stderr: probeResult.error ?? "",
                message: summary
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            if (!descriptor.command) {
              sendJson(res, 200, {
                ok: true,
                descriptor,
                exitCode: 0,
                stdout: "",
                stderr: "",
                message:
                  descriptor.healthUrl != null
                    ? `SugarDeploy resolved ${actionKind} without a shell command.`
                    : "SugarDeploy action completed."
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            const resolvedCwd = resolve(descriptor.command.cwd);
            if (!existsSync(resolvedCwd)) {
              sendJson(res, 400, {
                ok: false,
                descriptor,
                exitCode: null,
                stdout: "",
                stderr: "",
                message:
                  `Working directory does not exist: ${resolvedCwd}. ` +
                  "Save the project first and make sure the Working Directory override points at the game root on disk."
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            // Multi-step host actions: setup-infra (terraform init + apply) and
            // teardown-infra (gcloud delete loop + terraform destroy). Both
            // require terraform on PATH. Teardown additionally computes the
            // plan's declared Cloud Run service names server-side via
            // planGameDeployment + getCloudRunServiceNamesForPlan — server
            // owns the contract end-to-end.
            // Story 45.6 — Cloud Run Destroy: gcloud delete loop over the
            // plan's declared service names, each with not-found tolerance
            // so re-Destroy on an already-deleted service is a clean
            // no-op. Doesn't touch Artifact Registry, IAM, WIF, or Secret
            // Manager — a subsequent Deploy brings the service back
            // without Setup Infra needing to re-run.
            if (
              actionKind === "destroy" &&
              descriptor.targetId === "google-cloud-run"
            ) {
              if (!normalizedGameProject) {
                sendJson(res, 400, {
                  ok: false,
                  descriptor,
                  exitCode: null,
                  stdout: "",
                  stderr: "",
                  message:
                    "Destroy requires the game project payload to compute Cloud Run service names; SugarDeploy received an unrecognized gameProject."
                } satisfies DeploymentActionExecutionResult);
                return;
              }
              const plan = planGameDeployment(normalizedGameProject);
              const serviceNames = getCloudRunServiceNamesForPlan(plan);
              const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
                getDeploymentSettings(normalizedGameProject).targetOverrides["google-cloud-run"],
                normalizedGameProject
              );
              const projectId = cloudRunOverrides.projectId;
              const region = cloudRunOverrides.region;
              if (!projectId || !region) {
                sendJson(res, 400, {
                  ok: false,
                  descriptor,
                  exitCode: null,
                  stdout: "",
                  stderr: "",
                  message:
                    "Destroy requires both `gcp_project_id` and `region` to be resolved; one or both are missing."
                } satisfies DeploymentActionExecutionResult);
                return;
              }
              const steps: HostCommandStep[] = serviceNames.map((name) => ({
                label: `gcloud run services delete ${name}`,
                command: "gcloud",
                args: [
                  "run",
                  "services",
                  "delete",
                  name,
                  "--quiet",
                  "--project",
                  projectId,
                  "--region",
                  region
                ],
                cwd: resolvedCwd,
                tolerateNotFound: true
              }));
              const seqResult = await runHostCommandSequence(steps);
              sendJson(res, seqResult.exitCode === 0 ? 200 : 500, {
                ok: seqResult.exitCode === 0,
                descriptor: {
                  ...descriptor,
                  command: { ...descriptor.command, cwd: resolvedCwd }
                },
                exitCode: seqResult.exitCode,
                stdout: seqResult.stdout,
                stderr: seqResult.stderr,
                message:
                  seqResult.exitCode === 0
                    ? serviceNames.length === 0
                      ? "No service units declared by enabled plugins; nothing to destroy."
                      : `Destroy completed for ${serviceNames.length} service${serviceNames.length === 1 ? "" : "s"}.`
                    : `Destroy failed with exit code ${seqResult.exitCode ?? "unknown"}.`
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            if (actionKind === "setup-infra" || actionKind === "teardown-infra") {
              const terraformError = await ensureTerraformOnPath();
              if (terraformError !== null) {
                sendJson(res, 400, {
                  ok: false,
                  descriptor,
                  exitCode: null,
                  stdout: "",
                  stderr: terraformError,
                  message: terraformError
                } satisfies DeploymentActionExecutionResult);
                return;
              }

              const steps: HostCommandStep[] = [];
              if (actionKind === "setup-infra") {
                steps.push({
                  label: "terraform init",
                  command: "terraform",
                  args: ["init", "-input=false", "-upgrade"],
                  cwd: resolvedCwd
                });
                steps.push({
                  label: "terraform apply",
                  command: descriptor.command.command,
                  args: descriptor.command.args,
                  cwd: resolvedCwd
                });
              } else {
                if (!normalizedGameProject) {
                  sendJson(res, 400, {
                    ok: false,
                    descriptor,
                    exitCode: null,
                    stdout: "",
                    stderr: "",
                    message:
                      "Teardown Infra requires the game project payload; SugarDeploy received an unrecognized gameProject."
                  } satisfies DeploymentActionExecutionResult);
                  return;
                }
                const plan = planGameDeployment(normalizedGameProject);
                const serviceNames = getCloudRunServiceNamesForPlan(plan);
                const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
                  getDeploymentSettings(normalizedGameProject).targetOverrides["google-cloud-run"],
                  normalizedGameProject
                );
                const projectId = cloudRunOverrides.projectId;
                const region = cloudRunOverrides.region;
                if (!projectId || !region) {
                  sendJson(res, 400, {
                    ok: false,
                    descriptor,
                    exitCode: null,
                    stdout: "",
                    stderr: "",
                    message:
                      "Teardown Infra requires both `gcp_project_id` and `region` to be resolved; one or both are missing."
                  } satisfies DeploymentActionExecutionResult);
                  return;
                }
                for (const serviceName of serviceNames) {
                  steps.push({
                    label: `gcloud run services delete ${serviceName}`,
                    command: "gcloud",
                    args: [
                      "run",
                      "services",
                      "delete",
                      serviceName,
                      "--quiet",
                      "--project",
                      projectId,
                      "--region",
                      region
                    ],
                    cwd: resolvedCwd,
                    tolerateNotFound: true
                  });
                }
                steps.push({
                  label: "terraform destroy",
                  command: descriptor.command.command,
                  args: descriptor.command.args,
                  cwd: resolvedCwd
                });
              }

              const seqResult = await runHostCommandSequence(steps);
              sendJson(res, seqResult.exitCode === 0 ? 200 : 500, {
                ok: seqResult.exitCode === 0,
                descriptor: {
                  ...descriptor,
                  command: { ...descriptor.command, cwd: resolvedCwd }
                },
                exitCode: seqResult.exitCode,
                stdout: seqResult.stdout,
                stderr: seqResult.stderr,
                message:
                  seqResult.exitCode === 0
                    ? `SugarDeploy ${actionKind} completed successfully.`
                    : `SugarDeploy ${actionKind} failed with exit code ${seqResult.exitCode ?? "unknown"}.`
              } satisfies DeploymentActionExecutionResult);
              return;
            }

            const runResult = await runHostCommand({
              ...descriptor.command,
              cwd: resolvedCwd
            });
            sendJson(res, runResult.exitCode === 0 ? 200 : 500, {
              ok: runResult.exitCode === 0,
              descriptor: {
                ...descriptor,
                command: { ...descriptor.command, cwd: resolvedCwd }
              },
              exitCode: runResult.exitCode,
              stdout: runResult.stdout,
              stderr: runResult.stderr,
              message:
                runResult.exitCode === 0
                  ? `SugarDeploy ${actionKind} completed successfully.`
                  : `SugarDeploy ${actionKind} failed with exit code ${runResult.exitCode ?? "unknown"}.`
            } satisfies DeploymentActionExecutionResult);
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createBillingListPlugin(): VitePlugin {
  return {
    name: "sugardeploy-gcp-billing-list",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/list-billing-accounts",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const gcloudError = await ensureGcloudOnPath();
            if (gcloudError !== null) {
              sendJson(res, 400, {
                ok: false,
                accounts: [],
                exitCode: null,
                stdout: "",
                stderr: gcloudError,
                message: gcloudError
              });
              return;
            }

            const runResult = await runHostCommand({
              command: "gcloud",
              args: ["billing", "accounts", "list", "--format=json"],
              cwd: process.cwd()
            });

            if (runResult.exitCode !== 0) {
              sendJson(res, 500, {
                ok: false,
                accounts: [],
                exitCode: runResult.exitCode,
                stdout: runResult.stdout,
                stderr: runResult.stderr,
                message: `gcloud billing accounts list exited with code ${runResult.exitCode ?? "unknown"}.`
              });
              return;
            }

            const accounts = parseBillingAccountList(runResult.stdout);
            sendJson(res, 200, {
              ok: true,
              accounts,
              exitCode: 0,
              stdout: runResult.stdout,
              stderr: runResult.stderr,
              message:
                accounts.length === 0
                  ? "No open billing accounts found. Create one at https://console.cloud.google.com/billing then retry."
                  : `Found ${accounts.length} open billing account${accounts.length === 1 ? "" : "s"}.`
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              accounts: [],
              exitCode: null,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createGcpProjectLifecyclePlugin(): VitePlugin {
  return {
    name: "sugardeploy-gcp-project-lifecycle",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/probe-gcp-project",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as { projectId?: unknown };
            const projectId = body.projectId;
            if (!isValidGcpProjectId(projectId)) {
              sendJson(res, 400, {
                ok: false,
                status: "unknown",
                exitCode: null,
                stdout: "",
                stderr: "",
                message:
                  "projectId is invalid. GCP project ids must be 6–30 chars, lowercase, start with a letter, end with letter/digit, and contain only `[a-z0-9-]`."
              });
              return;
            }

            const gcloudError = await ensureGcloudOnPath();
            if (gcloudError !== null) {
              sendJson(res, 400, {
                ok: false,
                status: "unknown",
                exitCode: null,
                stdout: "",
                stderr: gcloudError,
                message: gcloudError
              });
              return;
            }

            const probe = await probeGcpProjectOwnership(projectId);
            sendJson(res, 200, {
              ok: true,
              status: probe.status,
              exitCode: probe.exitCode,
              stdout: probe.stdout,
              stderr: probe.stderr,
              message:
                probe.status === "owned"
                  ? `GCP project \`${projectId}\` is owned by this account and ready to use.`
                  : probe.status === "not-owned"
                  ? `GCP project \`${projectId}\` is not owned by this account yet — clicking Create GCP Project will attempt to create it.`
                  : `Could not determine ownership of \`${projectId}\` — see stderr for details.`
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              status: "unknown",
              exitCode: null,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );

      server.middlewares.use(
        "/__sugardeploy/create-gcp-project",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<CreateGcpProjectRequest>;
            const projectId = body.projectId;
            const displayName = body.displayName;
            const majorVersion = body.majorVersion;
            const billingAccountId = body.billingAccountId;

            if (!isValidGcpProjectId(projectId)) {
              sendJson(res, 400, {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "",
                message:
                  "projectId is invalid. GCP project ids must be 6–30 chars, lowercase, start with a letter, end with letter/digit, and contain only `[a-z0-9-]`."
              });
              return;
            }
            if (typeof displayName !== "string" || displayName.length === 0) {
              sendJson(res, 400, {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "",
                message: "displayName is required."
              });
              return;
            }
            if (
              typeof majorVersion !== "number" ||
              !Number.isInteger(majorVersion) ||
              majorVersion < 1
            ) {
              sendJson(res, 400, {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "",
                message: "majorVersion must be a positive integer."
              });
              return;
            }
            if (typeof billingAccountId !== "string" || billingAccountId.length === 0) {
              sendJson(res, 400, {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "",
                message:
                  "billingAccountId is required. Pick an account via /__sugardeploy/list-billing-accounts."
              });
              return;
            }

            const gcloudError = await ensureGcloudOnPath();
            if (gcloudError !== null) {
              sendJson(res, 400, {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: gcloudError,
                message: gcloudError
              });
              return;
            }

            // Pre-flight ownership probe — only used to skip the create step
            // when we already own the project (cleanly idempotent). We can't
            // detect the "someone else has the global id" case here because
            // GCP intentionally doesn't distinguish "doesn't exist" from "no
            // access" — see classifyProjectListResult docstring. That case
            // surfaces below if `gcloud projects create` returns
            // ALREADY_EXISTS, at which point we return a clear UX-friendly
            // message pointing at the GCP Project Id override field.
            const preProbe = await probeGcpProjectOwnership(projectId);
            if (preProbe.status === "unknown") {
              sendJson(res, 500, {
                ok: false,
                exitCode: preProbe.exitCode,
                stdout: preProbe.stdout,
                stderr: preProbe.stderr,
                message: `Could not determine ownership of \`${projectId}\` before create — see stderr for details.`
              });
              return;
            }

            const steps: HostCommandStep[] = [];
            // Skip the create step when we already own the project. The
            // billing-link + services-enable steps are natively idempotent
            // so re-running them is a clean no-op.
            if (preProbe.status === "not-owned") {
              steps.push({
                label: `Create GCP project ${projectId}`,
                command: "gcloud",
                args: [
                  "projects",
                  "create",
                  projectId,
                  "--name",
                  buildGcpProjectName(displayName, majorVersion),
                  "--quiet"
                ],
                cwd: process.cwd()
              });
            }
            steps.push({
              label: `Link billing account ${billingAccountId}`,
              command: "gcloud",
              args: [
                "billing",
                "projects",
                "link",
                projectId,
                "--billing-account",
                billingAccountId
              ],
              cwd: process.cwd()
            });
            steps.push({
              label: `Enable ${REQUIRED_GCP_APIS.length} required APIs`,
              command: "gcloud",
              args: [
                "services",
                "enable",
                ...REQUIRED_GCP_APIS,
                "--project",
                projectId
              ],
              cwd: process.cwd()
            });

            // Story 45.5.7 — terraform's org-policy override resource
            // (`google_org_policy_policy.allow_public_invokers`) requires
            // `roles/orgpolicy.policyAdmin` at the ORG level on the
            // deploying principal. Bake the grant into the Create GCP
            // Project sequence so the user never has to run gcloud by hand
            // (per the feedback memory). Resolves the org id from the
            // project, gets the current user, and grants the role.
            // Idempotent — gcloud add-iam-policy-binding succeeds even if
            // the binding already exists. Fails with a clear error when
            // the deploying user lacks `resourcemanager.organizationAdmin`
            // at the org level (can't grant what you don't already have
            // the right to grant).
            steps.push({
              label: `Resolve org id for ${projectId}`,
              command: "bash",
              args: [
                "-c",
                `gcloud projects describe ${projectId} --format='value(parent.id)' > /tmp/sugardeploy-org-id-${projectId}`
              ],
              cwd: process.cwd()
            });
            steps.push({
              label: `Grant orgpolicy.policyAdmin to current user (for org policy override)`,
              command: "bash",
              args: [
                "-c",
                `org_id="$(cat /tmp/sugardeploy-org-id-${projectId})"; user="$(gcloud config get-value account)"; gcloud organizations add-iam-policy-binding "$org_id" --member="user:$user" --role="roles/orgpolicy.policyAdmin" --condition=None`
              ],
              cwd: process.cwd()
            });

            const seqResult = await runHostCommandSequence(steps);
            const ok = seqResult.exitCode === 0;
            // The one fail case we want to surface with a specific UX
            // message: someone else owns the global project id. gcloud
            // `projects create` returns a non-zero exit with stderr
            // mentioning "ALREADY_EXISTS" or "already in use" — distinct
            // from the create succeeding and a downstream step failing,
            // so we sniff the stderr for it.
            const globallyTaken =
              !ok &&
              /(?:ALREADY_EXISTS|already in use|already exists)/i.test(
                seqResult.stderr
              );
            sendJson(res, ok ? 200 : 400, {
              ok,
              exitCode: seqResult.exitCode,
              stdout: seqResult.stdout,
              stderr: seqResult.stderr,
              message: ok
                ? `GCP project \`${projectId}\` is ready: ${
                    preProbe.status === "owned" ? "already owned" : "created"
                  }, billing linked, ${REQUIRED_GCP_APIS.length} APIs enabled.`
                : globallyTaken
                ? `GCP project id \`${projectId}\` is taken globally by a project this account doesn't own. Edit the GCP Project Id override (or save the project to regenerate the random suffix) and retry.`
                : `create-gcp-project failed with exit code ${seqResult.exitCode ?? "unknown"}.`
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              exitCode: null,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

interface SecretRequestBody {
  gameProject: unknown;
  secretKey: unknown;
  value?: unknown;
}

// Story 45.5 — 64 KiB cap on individual secret values. Google's Secret
// Manager itself caps at 65 536 bytes; we set the same ceiling here so the
// error surfaces in our middleware (clean UX) instead of as a gcloud
// failure. Realistic API key / OAuth token / TLS material is much smaller;
// the cap exists to refuse pathological inputs (paste accidents, etc.).
const SECRET_VALUE_MAX_BYTES = 64 * 1024;

interface ResolvedSecretContext {
  projectId: string;
  secretManagerName: string;
}

function resolveSecretContext(
  normalizedGameProject: GameProject,
  secretKey: string
): { ok: true; context: ResolvedSecretContext } | { ok: false; reason: string } {
  const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    getDeploymentSettings(normalizedGameProject).targetOverrides["google-cloud-run"],
    normalizedGameProject
  );
  if (!cloudRunOverrides.projectId) {
    return {
      ok: false,
      reason:
        "GCP project id is not resolvable from the game project; configure the Cloud Run target before running secret actions."
    };
  }
  if (!cloudRunOverrides.serviceNamePrefix) {
    return {
      ok: false,
      reason:
        "Service name prefix is not resolvable from the game project; cannot derive Secret Manager name."
    };
  }
  try {
    const secretManagerName = resolveSecretManagerName(
      cloudRunOverrides.serviceNamePrefix,
      secretKey
    );
    return {
      ok: true,
      context: { projectId: cloudRunOverrides.projectId, secretManagerName }
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

// Story 45.5: write a new version to a Secret Manager secret container.
// The value is piped via stdin so it never appears in argv (no shell
// history, no `ps` listing, no process audit trail). The middleware
// explicitly does NOT log the body or the value anywhere — request stdout
// is gcloud's own (which prints the version id, not the value). Any future
// edit to this handler that introduces console.log on the request body
// or response payload is a security regression.
function createSetSecretValuePlugin(): VitePlugin {
  return {
    name: "sugardeploy-set-secret-value",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/set-secret-value",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<SecretRequestBody>;
            const secretKey = body.secretKey;
            const value = body.value;
            if (typeof secretKey !== "string" || secretKey.length === 0) {
              sendJson(res, 400, {
                ok: false,
                message: "secretKey is required."
              });
              return;
            }
            if (typeof value !== "string" || value.length === 0) {
              sendJson(res, 400, {
                ok: false,
                message: "value is required and must be a non-empty string."
              });
              return;
            }
            const byteLength = Buffer.byteLength(value, "utf8");
            if (byteLength > SECRET_VALUE_MAX_BYTES) {
              sendJson(res, 400, {
                ok: false,
                message: `value exceeds ${SECRET_VALUE_MAX_BYTES.toLocaleString()} bytes (Secret Manager's per-version limit). Got ${byteLength.toLocaleString()} bytes.`
              });
              return;
            }

            const normalizedGameProject = tryNormalizeGameProject(body.gameProject);
            if (!normalizedGameProject) {
              sendJson(res, 400, {
                ok: false,
                message: "Unrecognized gameProject payload."
              });
              return;
            }
            const resolved = resolveSecretContext(normalizedGameProject, secretKey);
            if (!resolved.ok) {
              sendJson(res, 400, { ok: false, message: resolved.reason });
              return;
            }

            const gcloudError = await ensureGcloudOnPath();
            if (gcloudError !== null) {
              sendJson(res, 400, { ok: false, message: gcloudError });
              return;
            }

            const result = await runHostCommand({
              command: "gcloud",
              args: [
                "secrets",
                "versions",
                "add",
                resolved.context.secretManagerName,
                "--project",
                resolved.context.projectId,
                "--data-file=-"
              ],
              cwd: process.cwd(),
              stdin: value
            });
            const ok = result.exitCode === 0;
            sendJson(res, ok ? 200 : 500, {
              ok,
              exitCode: result.exitCode,
              // stdout from `gcloud secrets versions add` prints the resource
              // name of the new version — `projects/.../secrets/<name>/versions/<n>`.
              // It does NOT echo the secret value. Safe to surface verbatim.
              stdout: result.stdout,
              stderr: result.stderr,
              secretKey,
              secretManagerName: resolved.context.secretManagerName,
              message: ok
                ? `Wrote new version for \`${resolved.context.secretManagerName}\`.`
                : `gcloud secrets versions add failed with exit code ${result.exitCode ?? "unknown"}.`
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 45.5: probe whether a Secret Manager container has any ENABLED
// version. Returns { isSet, latestVersion?, createdAt? } without ever
// reading or returning the secret VALUE — the value is only readable by
// the runtime SA at request time. This is purely a status indicator for
// the Studio Secrets section ("Not Set" vs "Set ✓ (v3, 2026-06-18)").
function createSecretStatusPlugin(): VitePlugin {
  return {
    name: "sugardeploy-secret-status",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/secret-status",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<SecretRequestBody>;
            const secretKey = body.secretKey;
            if (typeof secretKey !== "string" || secretKey.length === 0) {
              sendJson(res, 400, {
                ok: false,
                message: "secretKey is required."
              });
              return;
            }
            const normalizedGameProject = tryNormalizeGameProject(body.gameProject);
            if (!normalizedGameProject) {
              sendJson(res, 400, {
                ok: false,
                message: "Unrecognized gameProject payload."
              });
              return;
            }
            const resolved = resolveSecretContext(normalizedGameProject, secretKey);
            if (!resolved.ok) {
              sendJson(res, 400, { ok: false, message: resolved.reason });
              return;
            }

            const gcloudError = await ensureGcloudOnPath();
            if (gcloudError !== null) {
              sendJson(res, 400, { ok: false, message: gcloudError });
              return;
            }

            const result = await runHostCommand({
              command: "gcloud",
              args: [
                "secrets",
                "versions",
                "list",
                resolved.context.secretManagerName,
                "--filter=state:ENABLED",
                "--format=json",
                "--project",
                resolved.context.projectId
              ],
              cwd: process.cwd()
            });

            // NOT_FOUND when the secret container itself doesn't exist
            // (Setup Infra hasn't run, or the secret name doesn't match what
            // terraform created). Surface as `isSet: false` with a clear
            // message so the user can act.
            if (result.exitCode !== 0) {
              const containerMissing = /(?:NOT_FOUND|could not be found|not found)/i.test(
                result.stderr
              );
              sendJson(res, containerMissing ? 200 : 500, {
                ok: containerMissing,
                isSet: false,
                secretKey,
                secretManagerName: resolved.context.secretManagerName,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                message: containerMissing
                  ? `Secret container \`${resolved.context.secretManagerName}\` does not exist in GCP. Did Setup Infra finish, and is this secret declared by an enabled plugin?`
                  : `gcloud secrets versions list failed with exit code ${result.exitCode ?? "unknown"}.`
              });
              return;
            }

            let versions: Array<{ name?: string; createTime?: string }> = [];
            try {
              const parsed = JSON.parse(result.stdout) as unknown;
              if (Array.isArray(parsed)) {
                versions = parsed as Array<{ name?: string; createTime?: string }>;
              }
            } catch {
              // fall through with empty versions
            }
            const latest = versions[0] ?? null;
            const latestVersion =
              latest?.name?.split("/").pop() ?? null;
            sendJson(res, 200, {
              ok: true,
              isSet: versions.length > 0,
              latestVersion,
              createdAt: latest?.createTime ?? null,
              secretKey,
              secretManagerName: resolved.context.secretManagerName,
              exitCode: 0,
              stdout: result.stdout,
              stderr: result.stderr,
              message:
                versions.length > 0
                  ? `Secret \`${resolved.context.secretManagerName}\` is Set (version ${latestVersion ?? "?"}).`
                  : `Secret \`${resolved.context.secretManagerName}\` is Not Set (container exists, no enabled versions).`
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 45.7 — template-drift probe. Reads the SUGARMAGIC TEMPLATE VERSION
// stamp at the top of the on-disk generated `main.tf` and returns it
// alongside the plugin's current CLOUD_RUN_TEMPLATE_VERSION so the Studio
// can render a non-blocking drift banner. Strictly read-only: never writes,
// never re-generates. The banner clears on the next save / Setup Infra run
// because both regenerate the file from the current template and the
// Studio re-probes after each. Pure parser lives in cloud-run-terraform.ts
// (45.2 shipped it specifically for this story).
interface TemplateVersionRequest {
  workingDirectory: unknown;
}

function createTemplateVersionPlugin(): VitePlugin {
  return {
    name: "sugardeploy-template-version",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/template-version",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<TemplateVersionRequest>;
            const workingDirectory =
              typeof body.workingDirectory === "string"
                ? body.workingDirectory.trim()
                : "";
            if (workingDirectory.length === 0) {
              sendJson(res, 400, {
                ok: false,
                message: "workingDirectory is required."
              });
              return;
            }
            const mainTfPath = resolve(
              workingDirectory,
              "deployment/google-cloud-run/terraform/main.tf"
            );
            let onDiskVersion: number | null = null;
            let fileExists = false;
            if (existsSync(mainTfPath)) {
              fileExists = true;
              const content = await readFile(mainTfPath, "utf8");
              onDiskVersion = parseTemplateVersionStamp(content);
            }
            sendJson(res, 200, {
              ok: true,
              fileExists,
              onDiskVersion,
              currentVersion: CLOUD_RUN_TEMPLATE_VERSION,
              mainTfPath
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

export function createSugarDeployHostMiddleware(): VitePlugin[] {
  return [
    createActionDispatcherPlugin(),
    createBillingListPlugin(),
    createGcpProjectLifecyclePlugin(),
    createSetSecretValuePlugin(),
    createSecretStatusPlugin(),
    createTemplateVersionPlugin()
  ];
}
