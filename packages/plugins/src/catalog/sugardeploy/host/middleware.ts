// SugarDeploy plugin's host-middleware contribution. All `/__sugardeploy/*`
// routes live here, owned by the plugin end-to-end. Previously inline in
// apps/studio/vite.config.ts (45.4 + 45.4.5), which gave the Studio dev
// server hardcoded knowledge of one specific plugin and forced the React
// side to compute plugin-derived service names because the middleware
// couldn't reach planGameDeployment from the config-load bundle. The
// 45.4.6 refactor lifts everything inside the plugin tree, restores the
// server-side contract (planGameDeployment is a sibling import now), and
// reduces Studio's vite.config.ts to one plugin-agnostic registry line.

import { existsSync, statSync } from "node:fs";
import { readFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  getSugarDeployGithubWorkflowPath,
  parseWorkflowTemplateVersionStamp,
  SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION
} from "../../../deployment/github-workflow";
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

async function ensureGitOnPath(): Promise<string | null> {
  const result = await ensureBinaryOnPath("git", {
    installHint:
      "Install git (https://git-scm.com/downloads) and ensure it is on your PATH before running Cut New Major Version."
  });
  return result.available ? null : result.reason;
}

// Story 45.8 — shared pre-flight for the cut-major-version saga. Verifies
// that the host can safely tag the prior major and commit the bump:
// git on PATH, working directory is inside a git work tree, working tree
// is clean (no uncommitted modifications + no untracked files that would
// be swept into a `git add -u`), and the tag we're about to create
// doesn't already exist. Returns null on pass, a user-readable reason
// string on fail. Re-run by every cut endpoint so the server enforces
// — the Studio UI's disable state is advisory, not authoritative.
async function preflightCutMajorVersion(
  workingDirectory: string,
  priorMajor: number
): Promise<string | null> {
  if (!workingDirectory || workingDirectory.length === 0) {
    return "workingDirectory is required.";
  }
  if (!existsSync(workingDirectory)) {
    return `workingDirectory does not exist on disk: ${workingDirectory}`;
  }
  const gitErr = await ensureGitOnPath();
  if (gitErr) return gitErr;
  const inside = await runHostCommand({
    command: "git",
    args: ["rev-parse", "--is-inside-work-tree"],
    cwd: workingDirectory
  });
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return `${workingDirectory} is not inside a git working tree.`;
  }
  const status = await runHostCommand({
    command: "git",
    args: ["status", "--porcelain"],
    cwd: workingDirectory
  });
  if (status.exitCode !== 0) {
    return `git status failed: ${status.stderr.trim() || `exit code ${status.exitCode}`}`;
  }
  if (status.stdout.trim().length > 0) {
    return "Working tree is not clean. Commit or stash uncommitted changes before cutting a new major version.";
  }
  if (
    typeof priorMajor !== "number" ||
    !Number.isFinite(priorMajor) ||
    priorMajor < 1 ||
    Math.floor(priorMajor) !== priorMajor
  ) {
    return `priorMajor must be a positive integer; got ${String(priorMajor)}.`;
  }
  const tagName = `v${priorMajor}.0.0`;
  const tagCheck = await runHostCommand({
    command: "git",
    args: ["rev-parse", "--verify", "--quiet", `refs/tags/${tagName}`],
    cwd: workingDirectory
  });
  if (tagCheck.exitCode === 0) {
    return `Tag ${tagName} already exists. Cut from a clean tag history (or delete the existing tag manually if it was created in error).`;
  }
  return null;
}

interface CutMajorVersionPrepareRequest {
  workingDirectory: unknown;
  priorMajor: unknown;
}

interface CutMajorVersionTagRequest {
  workingDirectory: unknown;
  priorMajor: unknown;
}

interface CutMajorVersionCommitRequest {
  workingDirectory: unknown;
  newMajor: unknown;
}

function readWorkingDirectory(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1) return null;
  if (Math.floor(value) !== value) return null;
  return value;
}

function createCutMajorVersionPreparePlugin(): VitePlugin {
  return {
    name: "sugardeploy-cut-major-version-prepare",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/prepare-cut-major-version",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<CutMajorVersionPrepareRequest>;
            const workingDirectory = readWorkingDirectory(body.workingDirectory);
            const priorMajor = readPositiveInteger(body.priorMajor);
            if (priorMajor === null) {
              sendJson(res, 400, {
                ok: false,
                reason: "priorMajor must be a positive integer."
              });
              return;
            }
            const reason = await preflightCutMajorVersion(
              workingDirectory,
              priorMajor
            );
            if (reason) {
              sendJson(res, 200, { ok: false, reason });
              return;
            }
            sendJson(res, 200, { ok: true });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createCutMajorVersionTagPlugin(): VitePlugin {
  return {
    name: "sugardeploy-cut-major-version-tag",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/tag-prior-major",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<CutMajorVersionTagRequest>;
            const workingDirectory = readWorkingDirectory(body.workingDirectory);
            const priorMajor = readPositiveInteger(body.priorMajor);
            if (priorMajor === null) {
              sendJson(res, 400, {
                ok: false,
                reason: "priorMajor must be a positive integer."
              });
              return;
            }
            // Server-enforced re-check: the saga's earlier prepare-call
            // could have raced an external git operation that polluted
            // the tree or claimed the tag. Re-validate before any side
            // effect.
            const reason = await preflightCutMajorVersion(
              workingDirectory,
              priorMajor
            );
            if (reason) {
              sendJson(res, 200, { ok: false, reason });
              return;
            }
            const tagName = `v${priorMajor}.0.0`;
            const tagResult = await runHostCommand({
              command: "git",
              args: ["tag", tagName, "HEAD"],
              cwd: workingDirectory
            });
            if (tagResult.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `git tag ${tagName} failed: ${tagResult.stderr.trim() || `exit code ${tagResult.exitCode}`}`,
                stdout: tagResult.stdout,
                stderr: tagResult.stderr
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              tagName,
              stdout: tagResult.stdout,
              stderr: tagResult.stderr
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 45.8 — saga rollback helper. The orchestrator calls this when
// the bump/persist/commit step fails after `git tag` already succeeded:
// `git tag -d v{prior}.0.0` removes the orphaned tag so the next attempt
// finds a clean tag history. Pre-flight is intentionally light (just
// git-on-PATH + work-tree check) because this runs as a recovery
// operation; the request that needed the strict pre-flight already ran.
function createCutMajorVersionUntagPlugin(): VitePlugin {
  return {
    name: "sugardeploy-cut-major-version-untag",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/untag-prior-major",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<CutMajorVersionTagRequest>;
            const workingDirectory = readWorkingDirectory(body.workingDirectory);
            const priorMajor = readPositiveInteger(body.priorMajor);
            if (workingDirectory.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "workingDirectory is required."
              });
              return;
            }
            if (priorMajor === null) {
              sendJson(res, 400, {
                ok: false,
                reason: "priorMajor must be a positive integer."
              });
              return;
            }
            const gitErr = await ensureGitOnPath();
            if (gitErr) {
              sendJson(res, 200, { ok: false, reason: gitErr });
              return;
            }
            const tagName = `v${priorMajor}.0.0`;
            const result = await runHostCommand({
              command: "git",
              args: ["tag", "-d", tagName],
              cwd: workingDirectory
            });
            if (result.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `git tag -d ${tagName} failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
                stdout: result.stdout,
                stderr: result.stderr
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              tagName,
              stdout: result.stdout,
              stderr: result.stderr
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createCutMajorVersionCommitPlugin(): VitePlugin {
  return {
    name: "sugardeploy-cut-major-version-commit",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/commit-major-version-bump",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<CutMajorVersionCommitRequest>;
            const workingDirectory = readWorkingDirectory(body.workingDirectory);
            const newMajor = readPositiveInteger(body.newMajor);
            if (workingDirectory.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "workingDirectory is required."
              });
              return;
            }
            if (newMajor === null) {
              sendJson(res, 400, {
                ok: false,
                reason: "newMajor must be a positive integer."
              });
              return;
            }
            // Lighter pre-flight than the prepare/tag steps: by the time
            // we reach commit, the working tree IS expected to be dirty
            // (Studio persisted the bumped project.sgrmagic + regenerated
            // managed files). We only re-verify git is on PATH + this is
            // a work tree.
            const gitErr = await ensureGitOnPath();
            if (gitErr) {
              sendJson(res, 200, { ok: false, reason: gitErr });
              return;
            }
            const inside = await runHostCommand({
              command: "git",
              args: ["rev-parse", "--is-inside-work-tree"],
              cwd: workingDirectory
            });
            if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
              sendJson(res, 200, {
                ok: false,
                reason: `${workingDirectory} is not inside a git working tree.`
              });
              return;
            }
            // Stage every tracked-file modification. The pre-flight at
            // prepare-time required a clean tree, so the only changes
            // present are the ones Studio just produced (project.sgrmagic
            // bump + regenerated managed files). `-u` skips untracked
            // files for safety.
            const addResult = await runHostCommand({
              command: "git",
              args: ["add", "-u"],
              cwd: workingDirectory
            });
            if (addResult.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `git add -u failed: ${addResult.stderr.trim() || `exit code ${addResult.exitCode}`}`,
                stdout: addResult.stdout,
                stderr: addResult.stderr
              });
              return;
            }
            const commitMessage = `chore: bump major version to ${newMajor}`;
            const commitResult = await runHostCommand({
              command: "git",
              args: ["commit", "-m", commitMessage],
              cwd: workingDirectory
            });
            if (commitResult.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `git commit failed: ${commitResult.stderr.trim() || `exit code ${commitResult.exitCode}`}`,
                stdout: commitResult.stdout,
                stderr: commitResult.stderr
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              commitMessage,
              stdout: commitResult.stdout,
              stderr: commitResult.stderr
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
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

            // Story 46.7 — same endpoint also probes the GHA workflow
            // file's stamp so the Studio gets both drift signals in one
            // round-trip. Existing fields preserved; new fields are
            // prefixed `workflow*`.
            const workflowPath = resolve(
              workingDirectory,
              getSugarDeployGithubWorkflowPath()
            );
            let workflowOnDiskVersion: number | null = null;
            let workflowFileExists = false;
            if (existsSync(workflowPath)) {
              workflowFileExists = true;
              const workflowContent = await readFile(workflowPath, "utf8");
              workflowOnDiskVersion = parseWorkflowTemplateVersionStamp(
                workflowContent
              );
            }

            sendJson(res, 200, {
              ok: true,
              fileExists,
              onDiskVersion,
              currentVersion: CLOUD_RUN_TEMPLATE_VERSION,
              mainTfPath,
              workflowFileExists,
              workflowOnDiskVersion,
              workflowCurrentVersion: SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION,
              workflowPath
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

// Story 46.8 — Setup GitHub Workflow host action. Synchronises the
// GitHub repo's vars/secrets so the workflow generated in 46.7 has
// what it needs at runtime. Idempotent: safe to re-run; each `gh
// variable set` / `gh secret set` overwrites the prior value.
//
// Body shape:
//   {
//     workingDirectory: string,       // absolute game-root path
//     githubRepo: string,             // "owner/repo"
//     netlifyAuthToken: string        // never persisted in Studio state
//   }
//
// Response shape:
//   { ok: true, message, stdout, stderr }
//   { ok: false, message, reason }
//
// The netlify token is piped to `gh secret set` via stdin so it never
// appears in argv (which surfaces in ps/audit logs). When Cloud Run
// is provisioned (terraform/ exists), the WIF provider + runtime SA
// email get set as repo VARS — they're identifiers, not secrets, so
// they're fine to live as vars where they're inspectable from the
// GitHub UI. NETLIFY_AUTH_TOKEN is always set as a SECRET.
interface SetupGithubWorkflowRequest {
  workingDirectory: unknown;
  githubRepo: unknown;
  netlifyAuthToken: unknown;
}

async function ensureGhCliOnPath(): Promise<string | null> {
  const result = await ensureBinaryOnPath("gh", {
    installHint:
      "Install the GitHub CLI (https://cli.github.com) and run `gh auth login` before clicking Setup GitHub Workflow."
  });
  return result.available ? null : result.reason;
}

function parseTerraformOutputs(
  json: string
): { runtimeSaEmail: string | null; githubWifProviderName: string | null } {
  try {
    const parsed = JSON.parse(json) as Record<
      string,
      { value?: unknown } | undefined
    >;
    const runtimeSaEmail =
      typeof parsed.runtime_sa_email?.value === "string"
        ? parsed.runtime_sa_email.value.trim()
        : null;
    const githubWifProviderName =
      typeof parsed.github_wif_provider_name?.value === "string"
        ? parsed.github_wif_provider_name.value.trim()
        : null;
    return {
      runtimeSaEmail: runtimeSaEmail || null,
      githubWifProviderName: githubWifProviderName || null
    };
  } catch {
    return { runtimeSaEmail: null, githubWifProviderName: null };
  }
}

function createSetupGithubWorkflowPlugin(): VitePlugin {
  return {
    name: "sugardeploy-setup-github-workflow",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/setup-github-workflow",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<SetupGithubWorkflowRequest>;
            const workingDirectory =
              typeof body.workingDirectory === "string"
                ? body.workingDirectory.trim()
                : "";
            const githubRepo =
              typeof body.githubRepo === "string" ? body.githubRepo.trim() : "";
            const netlifyAuthToken =
              typeof body.netlifyAuthToken === "string"
                ? body.netlifyAuthToken
                : "";
            if (workingDirectory.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "workingDirectory is required."
              });
              return;
            }
            if (githubRepo.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason:
                  "GitHub Repository is not set on this project. Fill it in under Sources before running Setup GitHub Workflow."
              });
              return;
            }
            if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(githubRepo)) {
              sendJson(res, 400, {
                ok: false,
                reason: `GitHub Repository "${githubRepo}" is not in owner/repo form.`
              });
              return;
            }
            if (netlifyAuthToken.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason:
                  "NETLIFY_AUTH_TOKEN value is required so the workflow can deploy to Netlify."
              });
              return;
            }

            const ghMissing = await ensureGhCliOnPath();
            if (ghMissing) {
              sendJson(res, 412, { ok: false, reason: ghMissing });
              return;
            }
            const authStatus = await runHostCommand({
              command: "gh",
              args: ["auth", "status"],
              cwd: workingDirectory
            });
            if (authStatus.exitCode !== 0) {
              sendJson(res, 412, {
                ok: false,
                reason:
                  "`gh auth status` failed. Run `gh auth login` and try again.",
                stdout: authStatus.stdout,
                stderr: authStatus.stderr
              });
              return;
            }

            const steps: HostCommandStep[] = [];
            let aggregatedStdout = "";
            let aggregatedStderr = "";

            // Read terraform outputs ONLY when terraform has been
            // applied. Frontend-only projects skip this block entirely
            // and end up just syncing the netlify secret.
            const terraformDir = resolve(
              workingDirectory,
              "deployment/google-cloud-run/terraform"
            );
            const terraformStateExists = existsSync(
              resolve(terraformDir, "terraform.tfstate")
            );

            let runtimeSaEmail: string | null = null;
            let githubWifProviderName: string | null = null;

            if (terraformStateExists) {
              const tfOutput = await runHostCommand({
                command: "terraform",
                args: ["output", "-json"],
                cwd: terraformDir
              });
              aggregatedStdout += `\n# terraform output -json\n${tfOutput.stdout}`;
              aggregatedStderr += tfOutput.stderr;
              if (tfOutput.exitCode !== 0) {
                sendJson(res, 500, {
                  ok: false,
                  reason:
                    "`terraform output -json` failed. Run Setup Infra first to apply terraform, then re-try Setup GitHub Workflow.",
                  stdout: aggregatedStdout,
                  stderr: aggregatedStderr
                });
                return;
              }
              ({ runtimeSaEmail, githubWifProviderName } =
                parseTerraformOutputs(tfOutput.stdout));
              if (!runtimeSaEmail || !githubWifProviderName) {
                sendJson(res, 500, {
                  ok: false,
                  reason:
                    "terraform outputs missing runtime_sa_email or github_wif_provider_name. Re-run Setup Infra and try again.",
                  stdout: aggregatedStdout,
                  stderr: aggregatedStderr
                });
                return;
              }
              steps.push(
                {
                  label: "Set SUGARMAGIC_WIF_PROVIDER repo variable",
                  command: "gh",
                  args: [
                    "variable",
                    "set",
                    "SUGARMAGIC_WIF_PROVIDER",
                    "--repo",
                    githubRepo,
                    "--body",
                    githubWifProviderName
                  ],
                  cwd: workingDirectory
                },
                {
                  label: "Set SUGARMAGIC_RUNTIME_SA_EMAIL repo variable",
                  command: "gh",
                  args: [
                    "variable",
                    "set",
                    "SUGARMAGIC_RUNTIME_SA_EMAIL",
                    "--repo",
                    githubRepo,
                    "--body",
                    runtimeSaEmail
                  ],
                  cwd: workingDirectory
                }
              );
            }

            for (const step of steps) {
              aggregatedStdout += `\n# ${step.label}\n# $ ${step.command} ${step.args.join(" ")}\n`;
              const result = await runHostCommand({
                command: step.command,
                args: step.args,
                cwd: step.cwd
              });
              aggregatedStdout += result.stdout;
              aggregatedStderr += result.stderr;
              if (result.exitCode !== 0) {
                sendJson(res, 500, {
                  ok: false,
                  reason: `${step.label} failed (exit ${result.exitCode}).`,
                  stdout: aggregatedStdout,
                  stderr: aggregatedStderr
                });
                return;
              }
            }

            // Pipe NETLIFY_AUTH_TOKEN to gh via stdin so the value
            // never appears in argv.
            aggregatedStdout += `\n# Set NETLIFY_AUTH_TOKEN repo secret\n# $ gh secret set NETLIFY_AUTH_TOKEN --repo ${githubRepo}\n`;
            const setSecret = await runHostCommand({
              command: "gh",
              args: ["secret", "set", "NETLIFY_AUTH_TOKEN", "--repo", githubRepo],
              cwd: workingDirectory,
              stdin: netlifyAuthToken
            });
            aggregatedStdout += setSecret.stdout;
            aggregatedStderr += setSecret.stderr;
            if (setSecret.exitCode !== 0) {
              sendJson(res, 500, {
                ok: false,
                reason: `gh secret set NETLIFY_AUTH_TOKEN failed (exit ${setSecret.exitCode}).`,
                stdout: aggregatedStdout,
                stderr: aggregatedStderr
              });
              return;
            }

            const summaryParts: string[] = [];
            if (terraformStateExists) {
              summaryParts.push(
                `Set repo VARS: SUGARMAGIC_WIF_PROVIDER, SUGARMAGIC_RUNTIME_SA_EMAIL.`
              );
            } else {
              summaryParts.push(
                `Skipped GCP vars (no terraform state under deployment/google-cloud-run/terraform).`
              );
            }
            summaryParts.push(`Set repo SECRET: NETLIFY_AUTH_TOKEN.`);

            sendJson(res, 200, {
              ok: true,
              message: summaryParts.join(" "),
              stdout: aggregatedStdout,
              stderr: aggregatedStderr,
              wifProviderName: githubWifProviderName,
              runtimeSaEmail
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 46.10 — dispatch + status endpoints that hand the Deploy
// workspace off to the generated GHA workflow instead of running
// `gcloud run deploy` inline. Pre-flight refuses on dirty tree or
// when HEAD isn't pushed — nikki's preference: deploys must come
// from a pushed git ref, no auto-snapshot branches behind the back.

interface DispatchDeployWorkflowRequest {
  workingDirectory: unknown;
  githubRepo: unknown;
  ref: unknown;
}

interface GetDeployWorkflowStatusRequest {
  githubRepo: unknown;
  runId: unknown;
}

interface RerunFailedJobsRequest {
  githubRepo: unknown;
  runId: unknown;
}

async function readGitWorkflowDispatchPreflight(
  workingDirectory: string,
  githubRepo: string
): Promise<{ ok: false; reason: string } | {
  ok: true;
  ref: string;
  headSha: string;
}> {
  if (workingDirectory.length === 0) {
    return { ok: false, reason: "workingDirectory is required." };
  }
  if (!existsSync(workingDirectory)) {
    return {
      ok: false,
      reason: `workingDirectory does not exist on disk: ${workingDirectory}`
    };
  }
  if (githubRepo.length === 0) {
    return {
      ok: false,
      reason:
        "GitHub Repository is not set on this project. Fill it in under Sources before deploying."
    };
  }
  const gitMissing = await ensureGitOnPath();
  if (gitMissing) return { ok: false, reason: gitMissing };
  const ghMissing = await ensureGhCliOnPath();
  if (ghMissing) return { ok: false, reason: ghMissing };

  const insideWorkTree = await runHostCommand({
    command: "git",
    args: ["rev-parse", "--is-inside-work-tree"],
    cwd: workingDirectory
  });
  if (
    insideWorkTree.exitCode !== 0 ||
    insideWorkTree.stdout.trim() !== "true"
  ) {
    return {
      ok: false,
      reason: `${workingDirectory} is not inside a git working tree.`
    };
  }

  const porcelain = await runHostCommand({
    command: "git",
    args: ["status", "--porcelain"],
    cwd: workingDirectory
  });
  if (porcelain.exitCode !== 0) {
    return {
      ok: false,
      reason: `git status failed: ${porcelain.stderr.trim() || `exit code ${porcelain.exitCode}`}`
    };
  }
  if (porcelain.stdout.trim().length > 0) {
    return {
      ok: false,
      reason:
        "Working tree is not clean. Commit (or stash) and push your changes before deploying — the GHA workflow only sees what's on the remote."
    };
  }

  const headSha = await runHostCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: workingDirectory
  });
  if (headSha.exitCode !== 0) {
    return {
      ok: false,
      reason: `git rev-parse HEAD failed: ${headSha.stderr.trim() || `exit code ${headSha.exitCode}`}`
    };
  }

  const branchName = await runHostCommand({
    command: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd: workingDirectory
  });
  if (branchName.exitCode !== 0) {
    return {
      ok: false,
      reason: `git rev-parse --abbrev-ref HEAD failed: ${branchName.stderr.trim() || `exit code ${branchName.exitCode}`}`
    };
  }

  // Verify HEAD is pushed: ahead-count vs upstream must be zero. If
  // there's no upstream configured, that's also a refuse — the
  // workflow can't dispatch against an untracked branch.
  const aheadCount = await runHostCommand({
    command: "git",
    args: ["rev-list", "--count", "@{u}..HEAD"],
    cwd: workingDirectory
  });
  if (aheadCount.exitCode !== 0) {
    return {
      ok: false,
      reason:
        "Current branch has no upstream / can't compare with remote. Run `git push -u origin <branch>` and try again."
    };
  }
  const ahead = Number.parseInt(aheadCount.stdout.trim(), 10);
  if (!Number.isFinite(ahead) || ahead > 0) {
    return {
      ok: false,
      reason: `Local branch is ${ahead || "?"} commit(s) ahead of remote. Push your changes (\`git push\`) before deploying — the GHA workflow only sees what's on the remote.`
    };
  }

  return {
    ok: true,
    ref: branchName.stdout.trim(),
    headSha: headSha.stdout.trim()
  };
}

function createPreflightDeployWorkflowPlugin(): VitePlugin {
  return {
    name: "sugardeploy-preflight-deploy-workflow",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/preflight-deploy-workflow",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<DispatchDeployWorkflowRequest>;
            const workingDirectory =
              typeof body.workingDirectory === "string"
                ? body.workingDirectory.trim()
                : "";
            const githubRepo =
              typeof body.githubRepo === "string" ? body.githubRepo.trim() : "";
            const preflight = await readGitWorkflowDispatchPreflight(
              workingDirectory,
              githubRepo
            );
            if (!preflight.ok) {
              sendJson(res, 200, { ok: false, reason: preflight.reason });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              ref: preflight.ref,
              headSha: preflight.headSha
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createDispatchDeployWorkflowPlugin(): VitePlugin {
  return {
    name: "sugardeploy-dispatch-deploy-workflow",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/dispatch-deploy-workflow",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<DispatchDeployWorkflowRequest>;
            const workingDirectory =
              typeof body.workingDirectory === "string"
                ? body.workingDirectory.trim()
                : "";
            const githubRepo =
              typeof body.githubRepo === "string" ? body.githubRepo.trim() : "";
            const requestedRef =
              typeof body.ref === "string" ? body.ref.trim() : "";

            const preflight = await readGitWorkflowDispatchPreflight(
              workingDirectory,
              githubRepo
            );
            if (!preflight.ok) {
              sendJson(res, 200, { ok: false, reason: preflight.reason });
              return;
            }
            const ref = requestedRef || preflight.ref;
            const headSha = preflight.headSha;

            const dispatch = await runHostCommand({
              command: "gh",
              args: [
                "workflow",
                "run",
                "sugardeploy-deploy.yml",
                "--repo",
                githubRepo,
                "--ref",
                ref
              ],
              cwd: workingDirectory
            });
            if (dispatch.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `gh workflow run failed (exit ${dispatch.exitCode}).`,
                stdout: dispatch.stdout,
                stderr: dispatch.stderr
              });
              return;
            }

            // gh's `workflow run` returns nothing useful about the run
            // id — it just dispatches. Sleep briefly so GitHub
            // registers the queued run, then list the most recent run
            // of this workflow that matches our headSha.
            await new Promise((resolveSleep) => setTimeout(resolveSleep, 2500));

            const list = await runHostCommand({
              command: "gh",
              args: [
                "run",
                "list",
                "--repo",
                githubRepo,
                "--workflow",
                "sugardeploy-deploy.yml",
                "--limit",
                "5",
                "--json",
                "databaseId,url,headSha,headBranch,createdAt,status,conclusion,event"
              ],
              cwd: workingDirectory
            });
            if (list.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `gh run list failed (exit ${list.exitCode}). Dispatched, but couldn't resolve runId.`,
                stdout: list.stdout,
                stderr: list.stderr
              });
              return;
            }
            const runs = (() => {
              try {
                return JSON.parse(list.stdout) as Array<{
                  databaseId: number;
                  url: string;
                  headSha: string;
                  headBranch: string;
                  createdAt: string;
                  status: string;
                  conclusion: string;
                  event: string;
                }>;
              } catch {
                return [];
              }
            })();
            // Prefer the most recent run on our headSha; fall back to the
            // newest workflow_dispatch run, then to the newest run.
            const matchByShaAndDispatch = runs.find(
              (entry) =>
                entry.headSha === headSha && entry.event === "workflow_dispatch"
            );
            const matchByDispatch = runs.find(
              (entry) => entry.event === "workflow_dispatch"
            );
            const fallback = runs[0];
            const resolved =
              matchByShaAndDispatch ?? matchByDispatch ?? fallback;
            if (!resolved) {
              sendJson(res, 200, {
                ok: false,
                reason:
                  "Dispatched, but no recent runs of sugardeploy-deploy.yml were found. Check the GitHub Actions tab.",
                stdout: list.stdout
              });
              return;
            }

            sendJson(res, 200, {
              ok: true,
              runId: resolved.databaseId,
              runUrl: resolved.url,
              ref,
              headSha
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createGetDeployWorkflowStatusPlugin(): VitePlugin {
  return {
    name: "sugardeploy-get-deploy-workflow-status",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/get-deploy-workflow-status",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<GetDeployWorkflowStatusRequest>;
            const githubRepo =
              typeof body.githubRepo === "string" ? body.githubRepo.trim() : "";
            const runId =
              typeof body.runId === "number" || typeof body.runId === "string"
                ? String(body.runId)
                : "";
            if (githubRepo.length === 0 || runId.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "githubRepo and runId are required."
              });
              return;
            }
            const ghMissing = await ensureGhCliOnPath();
            if (ghMissing) {
              sendJson(res, 412, { ok: false, reason: ghMissing });
              return;
            }
            const view = await runHostCommand({
              command: "gh",
              args: [
                "run",
                "view",
                runId,
                "--repo",
                githubRepo,
                "--json",
                "status,conclusion,url,jobs,headSha,headBranch,createdAt,updatedAt"
              ],
              cwd: process.cwd()
            });
            if (view.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `gh run view failed (exit ${view.exitCode}).`,
                stdout: view.stdout,
                stderr: view.stderr
              });
              return;
            }
            const parsed = (() => {
              try {
                return JSON.parse(view.stdout) as {
                  status: string;
                  conclusion: string | null;
                  url: string;
                  headSha: string;
                  headBranch: string;
                  createdAt: string;
                  updatedAt: string;
                  jobs: Array<{
                    name: string;
                    status: string;
                    conclusion: string | null;
                    url: string;
                    startedAt: string | null;
                    completedAt: string | null;
                  }>;
                };
              } catch {
                return null;
              }
            })();
            if (!parsed) {
              sendJson(res, 200, {
                ok: false,
                reason: "Could not parse gh run view output.",
                stdout: view.stdout
              });
              return;
            }
            // Story 46.10 — `gh run view --json conclusion` returns an
            // empty string while a run is queued / in_progress and
            // only fills in success / failure / cancelled at terminal.
            // Normalise empty -> null so downstream UI can rely on
            // `=== null` meaning "in flight" instead of having to
            // remember the gh quirk.
            const normalizeConclusion = (value: string | null) =>
              typeof value === "string" && value.length > 0 ? value : null;
            sendJson(res, 200, {
              ok: true,
              status: parsed.status,
              conclusion: normalizeConclusion(parsed.conclusion),
              url: parsed.url,
              headSha: parsed.headSha,
              headBranch: parsed.headBranch,
              createdAt: parsed.createdAt,
              updatedAt: parsed.updatedAt,
              jobs: parsed.jobs.map((job) => ({
                name: job.name,
                status: job.status,
                conclusion: normalizeConclusion(job.conclusion),
                url: job.url,
                startedAt: job.startedAt,
                completedAt: job.completedAt
              }))
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

// Story 46.10 follow-up — Build Frontend host action. Runs
// `pnpm --filter @sugarmagic/target-web build` in the sugarmagic
// monorepo root (the vite dev server's cwd) and copies the resulting
// `targets/web/dist/` into the wordlark project at
// `.sugarmagic/published-web/dist/`. Idempotent — replaces any
// existing dist before copying.
//
// Body shape:
//   { workingDirectory: string }   // wordlark root
//
// The sugarmagic root is whatever the vite dev server was launched
// from (process.cwd()). That's a hard requirement: this endpoint
// expects to be running INSIDE a sugarmagic monorepo checkout.
interface BuildPublishedWebRequest {
  workingDirectory: unknown;
}

function createBuildPublishedWebPlugin(): VitePlugin {
  return {
    name: "sugardeploy-build-published-web",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/build-published-web",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<BuildPublishedWebRequest>;
            const workingDirectory =
              typeof body.workingDirectory === "string"
                ? body.workingDirectory.trim()
                : "";
            if (workingDirectory.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "workingDirectory is required."
              });
              return;
            }
            if (!existsSync(workingDirectory)) {
              sendJson(res, 400, {
                ok: false,
                reason: `workingDirectory does not exist on disk: ${workingDirectory}`
              });
              return;
            }

            const sugarmagicRoot = process.cwd();
            if (!existsSync(resolve(sugarmagicRoot, "pnpm-workspace.yaml"))) {
              sendJson(res, 412, {
                ok: false,
                reason: `Studio dev server cwd (${sugarmagicRoot}) is not a sugarmagic monorepo root (no pnpm-workspace.yaml found). The Build Frontend action expects to run from inside a sugarmagic checkout.`
              });
              return;
            }

            const pnpmMissing = await ensureBinaryOnPath("pnpm", {
              installHint:
                "Install pnpm (https://pnpm.io/installation) and ensure it is on your PATH before running Build Frontend."
            });
            if (!pnpmMissing.available) {
              sendJson(res, 412, {
                ok: false,
                reason: pnpmMissing.reason
              });
              return;
            }

            let aggregatedStdout = "";
            let aggregatedStderr = "";

            // 1. pnpm --filter @sugarmagic/target-web build
            aggregatedStdout += `# pnpm --filter @sugarmagic/target-web build\n`;
            const build = await runHostCommand({
              command: "pnpm",
              args: ["--filter", "@sugarmagic/target-web", "build"],
              cwd: sugarmagicRoot
            });
            aggregatedStdout += build.stdout;
            aggregatedStderr += build.stderr;
            if (build.exitCode !== 0) {
              sendJson(res, 500, {
                ok: false,
                reason: `pnpm build failed (exit ${build.exitCode}).`,
                stdout: aggregatedStdout,
                stderr: aggregatedStderr
              });
              return;
            }

            const distSource = resolve(sugarmagicRoot, "targets/web/dist");
            if (!existsSync(distSource)) {
              sendJson(res, 500, {
                ok: false,
                reason: `targets/web/dist was not produced at ${distSource}. The pnpm build reported success but the dist directory is missing.`,
                stdout: aggregatedStdout,
                stderr: aggregatedStderr
              });
              return;
            }

            // 2. Wipe + recreate the destination so removed bundles
            // don't linger.
            const destDir = resolve(
              workingDirectory,
              ".sugarmagic/published-web/dist"
            );
            aggregatedStdout += `\n# clean ${destDir}\n`;
            try {
              await rm(destDir, { recursive: true, force: true });
            } catch (error) {
              aggregatedStderr += `\nrm failed: ${error instanceof Error ? error.message : String(error)}\n`;
            }
            await mkdir(dirname(destDir), { recursive: true });

            // 3. Recursive copy. node:fs/promises cp handles dirs +
            // files end-to-end on Node 18+; preserves nothing fancy
            // we need.
            aggregatedStdout += `# cp -r ${distSource} ${destDir}\n`;
            await cp(distSource, destDir, { recursive: true });

            const stat = statSync(destDir);
            sendJson(res, 200, {
              ok: true,
              message: `Built and copied target-web dist to ${destDir}.`,
              stdout: aggregatedStdout,
              stderr: aggregatedStderr,
              destDir,
              copiedAt: stat.mtime.toISOString()
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        }
      );
    }
  };
}

function createRerunFailedJobsPlugin(): VitePlugin {
  return {
    name: "sugardeploy-rerun-failed-jobs",
    configureServer(server) {
      server.middlewares.use(
        "/__sugardeploy/rerun-failed-jobs",
        async (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          try {
            const body = (await readJsonBody(req)) as Partial<RerunFailedJobsRequest>;
            const githubRepo =
              typeof body.githubRepo === "string" ? body.githubRepo.trim() : "";
            const runId =
              typeof body.runId === "number" || typeof body.runId === "string"
                ? String(body.runId)
                : "";
            if (githubRepo.length === 0 || runId.length === 0) {
              sendJson(res, 400, {
                ok: false,
                reason: "githubRepo and runId are required."
              });
              return;
            }
            const ghMissing = await ensureGhCliOnPath();
            if (ghMissing) {
              sendJson(res, 412, { ok: false, reason: ghMissing });
              return;
            }
            const rerun = await runHostCommand({
              command: "gh",
              args: [
                "run",
                "rerun",
                runId,
                "--repo",
                githubRepo,
                "--failed"
              ],
              cwd: process.cwd()
            });
            if (rerun.exitCode !== 0) {
              sendJson(res, 200, {
                ok: false,
                reason: `gh run rerun --failed failed (exit ${rerun.exitCode}).`,
                stdout: rerun.stdout,
                stderr: rerun.stderr
              });
              return;
            }
            sendJson(res, 200, {
              ok: true,
              message: "Re-running failed jobs.",
              stdout: rerun.stdout
            });
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
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
    createSetupGithubWorkflowPlugin(),
    createBuildPublishedWebPlugin(),
    createPreflightDeployWorkflowPlugin(),
    createDispatchDeployWorkflowPlugin(),
    createGetDeployWorkflowStatusPlugin(),
    createRerunFailedJobsPlugin(),
    createTemplateVersionPlugin(),
    createCutMajorVersionPreparePlugin(),
    createCutMajorVersionTagPlugin(),
    createCutMajorVersionUntagPlugin(),
    createCutMajorVersionCommitPlugin()
  ];
}
