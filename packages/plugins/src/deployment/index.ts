import type {
  DeploymentRequirement,
  ProxyRouteRequirement,
  RuntimeServiceFamily,
  RuntimeServiceRequirement,
  SecretRequirement,
  TopologyRequirement
} from "@sugarmagic/domain";
import { createDeploymentRequirementId } from "../../../domain/src/index";
import type { DeploymentSettings, DeploymentTargetId, GameProject } from "@sugarmagic/domain";
// IMPORTANT — these VALUE imports use the relative path on purpose. The
// SugarDeploy host middleware (catalog/sugardeploy/host/) is reachable
// from Studio's vite.config.ts at Vite's config-load phase, which bundles
// with esbuild and externalizes anything imported by package alias
// (`@sugarmagic/*`). The workspace's TS-source exports then fail to
// resolve at runtime. Type imports above stay on the alias — they're
// erased during bundling and don't externalize. See 45.4.6 for context.
import {
  getPluginConfiguration,
  getDeploymentTargetOverrides,
  normalizeDeploymentRequirements
} from "../../../domain/src/index";
import { getDiscoveredPluginDefinition } from "../builtin";
import { SUGARDEPLOY_PLUGIN_ID } from "../catalog/sugardeploy";
import {
  type GoogleCloudRunDeploymentTargetOverrides,
  type LocalDeploymentTargetOverrides,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides
} from "./overrides";
import { getDeploymentSettings, getPublishSettings } from "./plugin-state";
import type { PublishTargetId } from "./publish-targets";
import {
  buildCloudRunTerraformGitignore,
  buildCloudRunTerraformMainFile,
  buildCloudRunTerraformOutputsFile,
  buildCloudRunTerraformTfvarsFile,
  buildCloudRunTerraformVariablesFile,
  collectSecretEnvBindings
} from "./cloud-run-terraform";

export interface ManagedProjectFile {
  relativePath: string;
  content: string;
  contentType: "text" | "json";
}

export interface DeploymentConflict {
  conflictId: string;
  severity: "warning" | "error";
  kind:
    | "missing-plugin-definition"
    | "runtime-family-split"
    | "missing-target"
    | "unsupported-target";
  message: string;
  ownerIds: string[];
  requirementIds: string[];
}

export interface DeploymentRequirementSource {
  ownerId: string;
  displayName: string;
  requirements: DeploymentRequirement[];
}

export interface DeploymentServiceUnit {
  serviceUnitId: string;
  label: string;
  runtimeFamily: RuntimeServiceFamily | null;
  executionModel: RuntimeServiceRequirement["executionModel"];
  isolation: RuntimeServiceRequirement["isolation"];
  ownerIds: string[];
  requirements: DeploymentRequirement[];
  serviceRequirements: RuntimeServiceRequirement[];
  secrets: SecretRequirement[];
  proxyRoutes: ProxyRouteRequirement[];
  topology: TopologyRequirement[];
}

export interface DeploymentPlan {
  publishTargetId: PublishTargetId;
  deploymentTargetId: DeploymentTargetId | null;
  targetLabel: string | null;
  targetOverrides: Record<string, unknown>;
  status: "ready" | "warning" | "invalid";
  requirementSources: DeploymentRequirementSource[];
  requirements: DeploymentRequirement[];
  serviceUnits: DeploymentServiceUnit[];
  conflicts: DeploymentConflict[];
  warnings: string[];
  managedFiles: ManagedProjectFile[];
}

export interface DeploymentTargetDefinition {
  targetId: DeploymentTargetId;
  displayName: string;
  summary: string;
  implemented: boolean;
}

interface DeploymentTargetHandler {
  definition: DeploymentTargetDefinition;
  normalizeOverrides: (gameProject: GameProject) => Record<string, unknown>;
  collectWarnings?: (plan: DeploymentPlan) => string[];
  buildManagedFiles: (plan: DeploymentPlan, gameProject: GameProject) => ManagedProjectFile[];
}

export {
  GITHUB_REPO_REGEX,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  stripGithubRepoPrefixes,
  type GatewayAuthMode
} from "./overrides";

export {
  buildSetVersionedProjectIdentifierCommand,
  buildUpdateDeploymentSettingsCommand,
  buildUpdatePublishSettingsCommand,
  getDeploymentSettings,
  getPublishSettings,
  getVersionedProjectIdentifiers,
  type DeployStateInput
} from "./plugin-state";

export {
  createDefaultPublishTargetSettings,
  migrateLegacyPublishTargetId,
  normalizePublishTargetSettings,
  type PublishTargetId,
  type PublishTargetSettings
} from "./publish-targets";

/**
 * Resolve the full set of Cloud Run service names a plan declares, using the
 * same `${serviceNamePrefix}-${toComposeServiceName(serviceUnitId)}` formula
 * the deploy script and service.yaml generators use. Single source of truth
 * for "what services would terraform-NOT-touch and gcloud-WOULD-touch" —
 * consumed by the teardown-infra host action (gcloud delete loop) and any
 * future stop / health / status surfaces that need per-unit names.
 */
export function getCloudRunServiceNamesForPlan(plan: DeploymentPlan): string[] {
  const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(plan.targetOverrides);
  return plan.serviceUnits.map(
    (unit) => `${overrides.serviceNamePrefix}-${toComposeServiceName(unit.serviceUnitId)}`
  );
}
export {
  CLOUD_RUN_TEMPLATE_VERSION,
  TERRAFORM_RENAME_LEDGER,
  buildCloudRunTerraformGitignore,
  buildCloudRunTerraformMainFile,
  buildCloudRunTerraformOutputsFile,
  buildCloudRunTerraformTfvarsFile,
  buildCloudRunTerraformVariablesFile,
  collectSecretEnvBindings,
  parseTemplateVersionStamp,
  resolveSecretManagerName,
  type SecretEnvBinding
} from "./cloud-run-terraform";

export {
  GCP_PROJECT_ID_REGEX,
  GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH,
  GCP_SERVICE_ACCOUNT_ID_REGEX,
  REQUIRED_GCP_APIS,
  buildGcpProjectName,
  classifyProjectListResult,
  isValidGcpProjectId,
  isValidGcpServiceAccountId,
  parseBillingAccountList,
  stripBillingAccountPrefix,
  type BillingAccountSummary,
  type GcpProjectProbeStatus
} from "./gcp-bootstrap";

const DEPLOYMENT_HEADER = "GENERATED BY SUGARMAGIC - DO NOT EDIT";
const SUGARAGENT_PLUGIN_ID = "sugaragent";

interface SugarAgentLoreSourceSettings {
  kind: "local" | "github";
  localPath: string;
  repositoryUrl: string;
  repositoryRef: string;
}

interface SugarAgentLorePageSummary {
  pageId: string;
  title: string;
  relativePath: string;
  sectionCount: number;
}

interface SugarAgentResolvedLoreSection {
  heading: string;
  slug: string;
  content: string;
}

interface SugarAgentResolvedLorePage extends SugarAgentLorePageSummary {
  body: string;
  sections: SugarAgentResolvedLoreSection[];
}

function asTextFile(relativePath: string, content: string): ManagedProjectFile {
  return {
    relativePath,
    content,
    contentType: "text"
  };
}

function asJsonFile(relativePath: string, data: unknown): ManagedProjectFile {
  return {
    relativePath,
    content: JSON.stringify(data, null, 2),
    contentType: "json"
  };
}

function withHeader(commentPrefix: string, content: string): string {
  return `${commentPrefix} ${DEPLOYMENT_HEADER}\n${content}`;
}

function formatEnvExample(
  plan: DeploymentPlan,
  extras: string[] = []
): string {
  const lines = new Set<string>();
  for (const requirement of plan.requirements) {
    if (requirement.kind !== "secret") continue;
    const exampleKey = requirement.mappingHint ?? requirement.secretKey.toUpperCase();
    lines.add(`${exampleKey}=`);
  }
  for (const line of extras) {
    lines.add(line);
  }
  return withHeader(
    "#",
    Array.from(lines.values())
      .sort((left, right) => left.localeCompare(right))
      .join("\n")
  );
}

function readStringConfigValue(
  config: Record<string, unknown> | null | undefined,
  key: string
): string {
  return typeof config?.[key] === "string" ? config[key].trim() : "";
}

function readSugarAgentLoreSourceSettings(
  gameProject: GameProject
): SugarAgentLoreSourceSettings {
  const configuration = getPluginConfiguration(
    gameProject.pluginConfigurations,
    SUGARAGENT_PLUGIN_ID
  );
  const config = configuration?.config ?? null;
  return {
    kind: config?.loreSourceKind === "github" ? "github" : "local",
    localPath: readStringConfigValue(config, "loreLocalPath"),
    repositoryUrl: readStringConfigValue(config, "loreRepositoryUrl"),
    repositoryRef: readStringConfigValue(config, "loreRepositoryRef") || "main"
  };
}

function formatReadme(
  plan: DeploymentPlan,
  extraSections: string[] = []
): string {
  const lines = [
    `# ${plan.targetLabel ?? "Deployment"} (${plan.publishTargetId})`,
    "",
    "This directory is managed by SugarDeploy.",
    "",
    `Status: ${plan.status}`,
    "",
    "Service Units:"
  ];
  if (plan.serviceUnits.length === 0) {
    lines.push("- none");
  } else {
    for (const unit of plan.serviceUnits) {
      lines.push(
        `- ${unit.label} (${unit.executionModel}, ${unit.runtimeFamily ?? "unspecified"}, ${unit.isolation})`
      );
      for (const route of unit.proxyRoutes) {
        lines.push(`  - route ${route.pathHint ?? route.routeId}`);
      }
    }
  }
  if (plan.conflicts.length > 0) {
    lines.push("", "Conflicts:");
    for (const conflict of plan.conflicts) {
      lines.push(`- [${conflict.severity}] ${conflict.message}`);
    }
  }
  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  if (extraSections.length > 0) {
    lines.push("", ...extraSections);
  }
  return withHeader("#", lines.join("\n"));
}

function toComposeServiceName(input: string): string {
  return input.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").toLowerCase();
}

function getServiceDirectory(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit
): string {
  return `deployment/${targetId}/services/${toComposeServiceName(unit.serviceUnitId)}`;
}

function buildGatewayPackageFile(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit
): ManagedProjectFile {
  return asJsonFile(`${getServiceDirectory(targetId, unit)}/package.json`, {
    name: `${toComposeServiceName(unit.serviceUnitId)}-gateway`,
    private: true,
    type: "module"
  });
}

function buildGatewayDockerFile(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit,
  containerPort: number
): ManagedProjectFile {
  return asTextFile(
    `${getServiceDirectory(targetId, unit)}/Dockerfile`,
    withHeader(
      "#",
      [
        "FROM node:20-alpine",
        "WORKDIR /app",
        "COPY package.json ./package.json",
        "COPY routes.json ./routes.json",
        "COPY server.mjs ./server.mjs",
        `EXPOSE ${containerPort}`,
        'CMD ["node", "server.mjs"]'
      ].join("\n")
    )
  );
}

function buildGatewayServerFile(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit,
  containerPort: number,
  gatewayAuthMode: "none" | "bearer" = "none"
): ManagedProjectFile {
  // TODO: Move this generated gateway scaffold out of the inline template string
  // and into dedicated template/source files so the gateway implementation can be
  // typechecked and linted directly instead of only being validated after generation.
  const content = `// ${DEPLOYMENT_HEADER}
import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";
import { timingSafeEqual } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const routeManifest = JSON.parse(readFileSync(join(__dirname, "routes.json"), "utf8"));
const routes = routeManifest.routes;
const serviceUnitId = routeManifest.serviceUnitId;
const loreIngestState = {
  active: false,
  phase: "idle",
  pageCount: 0,
  chunkCount: 0,
  uploadedCount: 0,
  currentChunkId: null,
  message: "Idle",
  warnings: [],
  startedAt: null,
  completedAt: null
};
const baseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": process.env.ALLOW_ORIGIN ?? "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, baseHeaders);
  res.end(JSON.stringify(payload, null, 2));
}

function logInfo(message, payload = undefined) {
  const suffix =
    payload && typeof payload === "object"
      ? " " + JSON.stringify(payload)
      : payload != null
        ? " " + String(payload)
        : "";
  console.log("[sugardeploy] " + message + suffix);
}

function logError(message, error, payload = undefined) {
  const details = {
    ...(payload && typeof payload === "object" ? payload : {}),
    error: error instanceof Error ? error.message : String(error)
  };
  console.error("[sugardeploy] " + message + " " + JSON.stringify(details));
}

function updateLoreIngestState(patch) {
  Object.assign(loreIngestState, patch);
}

function sendMethodNotAllowed(res, allowed) {
  res.writeHead(405, {
    ...baseHeaders,
    allow: allowed.join(", ")
  });
  res.end(
    JSON.stringify(
      {
        ok: false,
        error: "MethodNotAllowed",
        allowed
      },
      null,
      2
    )
  );
}

function normalizePath(url) {
  return (url || "/").split("?")[0] || "/";
}

// Story 45.5.8 — bearer-token authorization. Constant-time compare via
// node:crypto.timingSafeEqual prevents timing-based token guessing. Length
// mismatch short-circuits with false (timingSafeEqual requires equal-length
// buffers). The expected token comes from the deployment secret env var
// resolved at request time; missing env var (e.g. secret wasn't Set Value'd
// after enabling bearer mode) means the gate denies everything except /health.
function authorizeBearer(req) {
  const expected = process.env.SUGARMAGIC_GATEWAY_SHARED_TOKEN || "";
  if (!expected) return false;
  const header = (req.headers && req.headers["authorization"]) || "";
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const presented = header.slice(prefix.length).trim();
  if (!presented) return false;
  const expectedBuf = Buffer.from(expected, "utf8");
  const presentedBuf = Buffer.from(presented, "utf8");
  if (expectedBuf.length !== presentedBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, presentedBuf);
  } catch {
    return false;
  }
}

function resolveEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function requireEnv(name) {
  const value = resolveEnv(name);
  if (!value) {
    throw new Error("Missing required environment variable: " + name);
  }
  return value;
}

async function readJsonBody(req) {
  let requestBody = "";
  for await (const chunk of req) {
    requestBody += chunk.toString();
  }
  if (!requestBody.trim()) {
    return {};
  }
  try {
    return JSON.parse(requestBody);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function parseApiJsonResponse(response, label) {
  const raw = await response.text();
  let payload = null;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    throw new Error(
      label +
        " failed with status " +
        response.status +
        (raw.trim() ? ": " + raw : "")
    );
  }
  return payload;
}

async function requestJson(url, options, label) {
  logInfo("upstream:request", {
    label,
    url,
    method: options?.method ?? "GET"
  });
  const response = await fetch(url, options);
  const raw = await response.text();
  let payload = null;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    logError(label + " failed", new Error("upstream non-2xx"), {
      url,
      status: response.status,
      body: raw
    });
    throw new Error(
      label +
        " failed with status " +
        response.status +
        (typeof payload === "string"
          ? ": " + payload
          : payload && typeof payload === "object" && "error" in payload
            ? ": " + JSON.stringify(payload)
            : "")
    );
  }
  return {
    payload,
    headers: response.headers
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function sanitizeFilename(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-");
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\\n")) {
    return {
      metadata: {},
      body: raw
    };
  }

  const closingIndex = raw.indexOf("\\n---\\n", 4);
  if (closingIndex === -1) {
    return {
      metadata: {},
      body: raw
    };
  }

  const frontmatter = raw.slice(4, closingIndex);
  const body = raw.slice(closingIndex + 5);
  const metadata = {};
  for (const line of frontmatter.split("\\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    metadata[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return {
    metadata,
    body
  };
}

function splitLoreSections(markdown) {
  const lines = markdown.split("\\n");
  const sections = [];
  let current = {
    heading: "Overview",
    slug: "overview",
    contentLines: []
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const content = current.contentLines.join("\\n").trim();
      if (content) {
        sections.push({
          heading: current.heading,
          slug: current.slug,
          content
        });
      }
      const heading = headingMatch[2].trim();
      current = {
        heading,
        slug: slugify(heading),
        contentLines: []
      };
      continue;
    }
    current.contentLines.push(line);
  }

  const trailingContent = current.contentLines.join("\\n").trim();
  if (trailingContent) {
    sections.push({
      heading: current.heading,
      slug: current.slug,
      content: trailingContent
    });
  }

  return sections.length > 0
    ? sections
    : [
        {
          heading: "Overview",
          slug: "overview",
          content: markdown.trim()
        }
      ];
}

function walkMarkdownFiles(rootDir, currentDir = rootDir, files = []) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(rootDir, absolutePath, files);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (extension === ".md" || extension === ".markdown") {
      files.push(absolutePath);
    }
  }
  return files;
}

function resolveLoreSource() {
  const sourceKind = resolveEnv("SUGARMAGIC_LORE_SOURCE_KIND", "local");
  const sourcePath = resolveEnv("SUGARMAGIC_LORE_SOURCE_PATH");
  const repositoryUrl = resolveEnv("SUGARMAGIC_LORE_SOURCE_REPOSITORY_URL");
  const repositoryRef = resolveEnv("SUGARMAGIC_LORE_SOURCE_REPOSITORY_REF", "main");

  if (sourceKind === "github") {
    return {
      sourceKind,
      sourcePath: null,
      repositoryUrl,
      repositoryRef,
      sourceReady: false,
      warning:
        "GitHub-backed lore source resolution is planned but not implemented yet. Use a local checked-out lore repo for now."
    };
  }

  if (!sourcePath) {
    return {
      sourceKind: "local",
      sourcePath: null,
      repositoryUrl,
      repositoryRef,
      sourceReady: false,
      warning: "SUGARMAGIC_LORE_SOURCE_PATH is not configured in the gateway environment."
    };
  }

  try {
    const stats = statSync(sourcePath);
    if (!stats.isDirectory()) {
      return {
        sourceKind: "local",
        sourcePath,
        repositoryUrl,
        repositoryRef,
        sourceReady: false,
        warning: "Configured lore source path is not a directory: " + sourcePath
      };
    }
  } catch (error) {
    return {
      sourceKind: "local",
      sourcePath,
      repositoryUrl,
      repositoryRef,
      sourceReady: false,
      warning:
        "Configured lore source path is not readable: " +
        sourcePath +
        " (" +
        (error instanceof Error ? error.message : String(error)) +
        ")"
    };
  }

  return {
    sourceKind: "local",
    sourcePath,
    repositoryUrl,
    repositoryRef,
    sourceReady: true,
    warning: null
  };
}

function readLorePages() {
  const source = resolveLoreSource();
  if (!source.sourceReady || !source.sourcePath) {
    return {
      source,
      pages: [],
      chunks: [],
      warnings: source.warning ? [source.warning] : []
    };
  }

  const warnings = source.warning ? [source.warning] : [];
  const pages = [];
  const chunks = [];
  const markdownFiles = walkMarkdownFiles(source.sourcePath);

  for (const absolutePath of markdownFiles) {
    const raw = readFileSync(absolutePath, "utf8");
    const { metadata, body } = parseFrontmatter(raw);
    const pageId = typeof metadata.id === "string" ? metadata.id.trim() : "";
    if (!pageId) {
      warnings.push(
        "Skipped lore page without frontmatter id: " +
          relative(source.sourcePath, absolutePath)
      );
      continue;
    }

    const relativePath = relative(source.sourcePath, absolutePath);
    const title =
      (typeof metadata.title === "string" && metadata.title.trim()) ||
      pageId.split(".").at(-1) ||
      pageId;
    const sections = splitLoreSections(body);

    pages.push({
      pageId,
      title,
      relativePath,
      sectionCount: sections.length,
      body,
      sections
    });

    for (const section of sections) {
      const chunkId = pageId + "#" + section.slug;
      const embeddingText = [
        "Page ID: " + pageId,
        "Title: " + title,
        "Section: " + section.heading,
        section.content
      ]
        .filter(Boolean)
        .join("\\n\\n");

      chunks.push({
        pageId,
        chunkId,
        title,
        sectionHeading: section.heading,
        sectionSlug: section.slug,
        relativePath,
        embeddingText
      });
    }
  }

  pages.sort((left, right) => left.pageId.localeCompare(right.pageId));
  chunks.sort((left, right) => left.chunkId.localeCompare(right.chunkId));

  return {
    source,
    pages,
    chunks,
    warnings
  };
}

async function listVectorStoreFiles(vectorStoreId) {
  const items = [];
  let after = "";

  while (true) {
    const query = after ? "?after=" + encodeURIComponent(after) : "";
    const { payload } = await requestJson(
      "https://api.openai.com/v1/vector_stores/" + vectorStoreId + "/files" + query,
      {
        method: "GET",
        headers: {
          authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
        }
      },
      "OpenAI vector store file list"
    );

    const batch = Array.isArray(payload?.data) ? payload.data : [];
    items.push(...batch);
    if (!payload?.has_more || batch.length === 0) {
      break;
    }
    after = typeof batch[batch.length - 1]?.id === "string" ? batch[batch.length - 1].id : "";
    if (!after) break;
  }

  return items;
}

async function deleteVectorStoreFile(vectorStoreId, vectorStoreFileId) {
  await requestJson(
    "https://api.openai.com/v1/vector_stores/" + vectorStoreId + "/files/" + vectorStoreFileId,
    {
      method: "DELETE",
      headers: {
        authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
      }
    },
    "OpenAI vector store file delete"
  );
}

async function uploadChunkToVectorStore(vectorStoreId, chunk, onProgress = null) {
  onProgress?.({
    phase: "uploading",
    currentChunkId: chunk.chunkId,
    message: "Uploading chunk " + chunk.chunkId
  });
  const fileUpload = new FormData();
  fileUpload.append("purpose", "user_data");
  fileUpload.append(
    "file",
    new Blob([chunk.embeddingText], { type: "text/markdown" }),
    sanitizeFilename(chunk.chunkId) + ".md"
  );

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
    },
    body: fileUpload
  });
  const uploadPayload = await parseApiJsonResponse(
    uploadResponse,
    "OpenAI file upload"
  );

  const attachResponse = await fetch(
    "https://api.openai.com/v1/vector_stores/" + vectorStoreId + "/files",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
      },
      body: JSON.stringify({
        file_id: uploadPayload.id,
        attributes: {
          page_id: chunk.pageId,
          chunk_id: chunk.chunkId,
          section_slug: chunk.sectionSlug,
          section_heading: chunk.sectionHeading,
          title: chunk.title,
          relative_path: chunk.relativePath
        }
      })
    }
  );
  const vectorStoreFile = await parseApiJsonResponse(
    attachResponse,
    "OpenAI vector store file attach"
  );

  let attempts = 0;
  while (attempts < 30) {
    onProgress?.({
      phase: "waiting-for-indexing",
      currentChunkId: chunk.chunkId,
      message: "Waiting for indexing for " + chunk.chunkId
    });
    const statusResponse = await fetch(
      "https://api.openai.com/v1/vector_stores/" +
        vectorStoreId +
        "/files/" +
        vectorStoreFile.id,
      {
        method: "GET",
        headers: {
          authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
        }
      }
    );
    const statusPayload = await parseApiJsonResponse(
      statusResponse,
      "OpenAI vector store file status"
    );
    if (statusPayload.status === "completed") {
      return vectorStoreFile;
    }
    if (statusPayload.status === "failed" || statusPayload.status === "cancelled") {
      throw new Error(
        "Vector store file processing failed for " +
          chunk.chunkId +
          " with status " +
          statusPayload.status
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts += 1;
  }

  throw new Error(
    "Timed out waiting for vector store processing for chunk " + chunk.chunkId
  );
}

function findManagedRoute(path) {
  return routes.find(
    (route) => path === route.path || path.startsWith(route.path + "/")
  );
}

async function handleSugarAgentGenerate(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, ["POST", "OPTIONS"]);
    return;
  }

  const body = await readJsonBody(req);
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : resolveEnv("SUGARMAGIC_ANTHROPIC_MODEL", "claude-sonnet-4-5");
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const userPrompt =
    typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
  const maxTokens =
    typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens)
      ? Math.max(1, Math.floor(body.maxTokens))
      : 300;

  if (!systemPrompt || !userPrompt) {
    sendJson(res, 400, {
      ok: false,
      error: "InvalidRequest",
      message: "systemPrompt and userPrompt are required."
    });
    return;
  }

  const { payload, headers } = await requestJson(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": requireEnv("SUGARMAGIC_ANTHROPIC_API_KEY"),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    },
    "Anthropic request"
  );

  const text = Array.isArray(payload?.content)
    ? payload.content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\\n\\n")
    : "";

  if (!text) {
    throw new Error("Anthropic response did not include text content.");
  }

  sendJson(res, 200, {
    text,
    requestId: headers.get("request-id")
  });
}

async function handleSugarAgentEmbed(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, ["POST", "OPTIONS"]);
    return;
  }

  const body = await readJsonBody(req);
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : resolveEnv("SUGARMAGIC_OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");

  if (!input) {
    sendJson(res, 400, {
      ok: false,
      error: "InvalidRequest",
      message: "input is required."
    });
    return;
  }

  const { payload, headers } = await requestJson(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
      },
      body: JSON.stringify({
        input,
        model
      })
    },
    "OpenAI embeddings request"
  );

  const embedding = Array.isArray(payload?.data?.[0]?.embedding)
    ? payload.data[0].embedding
    : null;
  if (!embedding) {
    throw new Error("OpenAI embeddings response did not include an embedding.");
  }

  sendJson(res, 200, {
    embedding,
    requestId: headers.get("x-request-id")
  });
}

async function handleSugarAgentSearch(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, ["POST", "OPTIONS"]);
    return;
  }

  const body = await readJsonBody(req);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const vectorStoreId =
    typeof body.vectorStoreId === "string" && body.vectorStoreId.trim()
      ? body.vectorStoreId.trim()
      : resolveEnv("SUGARMAGIC_OPENAI_VECTOR_STORE_ID");
  const maxResults =
    typeof body.maxResults === "number" && Number.isFinite(body.maxResults)
      ? Math.max(1, Math.min(8, Math.floor(body.maxResults)))
      : 4;

  if (!query || !vectorStoreId) {
    sendJson(res, 400, {
      ok: false,
      error: "InvalidRequest",
      message: "query and vectorStoreId are required."
    });
    return;
  }

  const { payload, headers } = await requestJson(
    "https://api.openai.com/v1/vector_stores/" + vectorStoreId + "/search",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + requireEnv("SUGARMAGIC_OPENAI_API_KEY")
      },
      body: JSON.stringify({
        query,
        max_num_results: maxResults,
        filters:
          body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
            ? body.filters
            : undefined
      })
    },
    "OpenAI vector search"
  );

  const results = Array.isArray(payload?.data)
    ? payload.data.map((result, index) => ({
        fileId:
          typeof result?.file_id === "string" ? result.file_id : "vector-result-" + index,
        filename: typeof result?.filename === "string" ? result.filename : "unknown",
        score: typeof result?.score === "number" ? result.score : 0,
        attributes:
          result?.attributes && typeof result.attributes === "object"
            ? result.attributes
            : {},
        text: Array.isArray(result?.content)
          ? result.content
              .filter((item) => item?.type === "text" && typeof item.text === "string")
              .map((item) => item.text.trim())
              .filter(Boolean)
              .join("\\n\\n")
          : ""
      }))
    : [];

  sendJson(res, 200, {
    results,
    requestId: headers.get("x-request-id")
  });
}

async function handleSugarAgentLoreStatus(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, ["GET", "OPTIONS"]);
    return;
  }

  const lore = readLorePages();
  const vectorStoreId = resolveEnv("SUGARMAGIC_OPENAI_VECTOR_STORE_ID") || null;
  sendJson(res, 200, {
    ok: true,
    sourceKind: lore.source.sourceKind,
    sourceReady: lore.source.sourceReady,
    sourcePath: lore.source.sourcePath,
    vectorStoreId,
    pageCount: lore.pages.length,
    chunkCount: lore.chunks.length,
    warnings: lore.warnings,
    ingest: { ...loreIngestState }
  });
}

async function handleSugarAgentLorePages(req, res) {
  if (req.method !== "GET") {
    sendMethodNotAllowed(res, ["GET", "OPTIONS"]);
    return;
  }

  const lore = readLorePages();
  sendJson(res, 200, {
    ok: true,
    pages: lore.pages.map((page) => ({
      pageId: page.pageId,
      title: page.title,
      relativePath: page.relativePath,
      sectionCount: page.sectionCount
    })),
    warnings: lore.warnings
  });
}

async function handleSugarAgentLoreResolve(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, ["POST", "OPTIONS"]);
    return;
  }

  const body = await readJsonBody(req);
  const rawPageIds = Array.isArray(body?.pageIds) ? body.pageIds : [];
  const pageIds = [...new Set(
    rawPageIds
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));

  if (pageIds.length === 0) {
    sendJson(res, 400, {
      ok: false,
      error: "InvalidRequest",
      message: "pageIds must contain at least one non-empty lore page id."
    });
    return;
  }

  const lore = readLorePages();
  const pagesById = new Map(
    lore.pages.map((page) => [page.pageId, page])
  );
  const resolvedPages = [];
  const missingPageIds = [];

  for (const pageId of pageIds) {
    const page = pagesById.get(pageId);
    if (!page) {
      missingPageIds.push(pageId);
      continue;
    }
    resolvedPages.push({
      pageId: page.pageId,
      title: page.title,
      relativePath: page.relativePath,
      sectionCount: page.sectionCount,
      body: page.body,
      sections: page.sections
    });
  }

  sendJson(res, 200, {
    ok: true,
    pages: resolvedPages,
    missingPageIds,
    warnings: lore.warnings
  });
}

async function handleSugarAgentLoreIngest(req, res) {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, ["POST", "OPTIONS"]);
    return;
  }

  const body = await readJsonBody(req);
  const mode = "overwrite";
  const vectorStoreId =
    typeof body.vectorStoreId === "string" && body.vectorStoreId.trim()
      ? body.vectorStoreId.trim()
      : resolveEnv("SUGARMAGIC_OPENAI_VECTOR_STORE_ID");

  if (!vectorStoreId) {
    sendJson(res, 400, {
      ok: false,
      error: "InvalidRequest",
      message: "vectorStoreId is required."
    });
    return;
  }

  const lore = readLorePages();
  if (!lore.source.sourceReady) {
    sendJson(res, 400, {
      ok: false,
      error: "LoreSourceUnavailable",
      message: lore.warnings[0] ?? "Lore source is not available."
    });
    return;
  }

  if (lore.chunks.length === 0) {
    sendJson(res, 400, {
      ok: false,
      error: "LoreSourceEmpty",
      message: "No lore pages with canonical frontmatter ids were found in the configured lore source.",
      warnings: lore.warnings
    });
    return;
  }

  updateLoreIngestState({
    active: true,
    phase: "parsed",
    pageCount: lore.pages.length,
    chunkCount: lore.chunks.length,
    uploadedCount: 0,
    currentChunkId: null,
    message: "Parsed " + lore.pages.length + " pages into " + lore.chunks.length + " chunks.",
    warnings: lore.warnings,
    startedAt: new Date().toISOString(),
    completedAt: null
  });

  try {
    if (mode === "overwrite") {
      updateLoreIngestState({
        phase: "clearing-store",
        message: "Clearing existing vector store contents before overwrite."
      });
      const existingFiles = await listVectorStoreFiles(vectorStoreId);
      for (const item of existingFiles) {
        if (typeof item?.id === "string") {
          await deleteVectorStoreFile(vectorStoreId, item.id);
        }
      }
    }

    let uploadedCount = 0;
    for (const chunk of lore.chunks) {
      await uploadChunkToVectorStore(vectorStoreId, chunk, (progress) => {
        updateLoreIngestState({
          phase: progress.phase,
          currentChunkId: progress.currentChunkId ?? null,
          message: progress.message,
          uploadedCount
        });
      });
      uploadedCount += 1;
      updateLoreIngestState({
        phase: "uploading",
        currentChunkId: chunk.chunkId,
        uploadedCount,
        message: "Uploaded " + uploadedCount + " / " + lore.chunks.length + " chunks."
      });
    }

    updateLoreIngestState({
      active: false,
      phase: "completed",
      currentChunkId: null,
      uploadedCount,
      message: "Completed lore ingest.",
      completedAt: new Date().toISOString()
    });

    sendJson(res, 200, {
      ok: true,
      mode,
      vectorStoreId,
      pageCount: lore.pages.length,
      chunkCount: lore.chunks.length,
      uploadedCount,
      warnings: lore.warnings
    });
  } catch (error) {
    updateLoreIngestState({
      active: false,
      phase: "failed",
      message: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString()
    });
    throw error;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, baseHeaders);
    res.end();
    return;
  }

  const path = normalizePath(req.url);
  logInfo("gateway:request", {
    method: req.method ?? "GET",
    path
  });
  // /health (not /healthz): Cloud Run's frontend reserves /healthz
  // specifically — it gets intercepted before reaching the container,
  // returning Google's generic 404 page with no x-cloud-trace-context
  // header. Discovered the hard way during 45.5.7 verification.
  if (path === "/" || path === "/health") {
    sendJson(res, 200, {
      ok: true,
      target: ${JSON.stringify(targetId)},
      serviceUnitId,
      routes
    });
    return;
  }

  // Story 45.5.8 — bearer-token auth gate. Generated based on the
  // gatewayAuthMode override at plan time. /health stays public above; this
  // gate runs on EVERY other path before the route dispatcher.
${gatewayAuthMode === "bearer" ? `  if (!authorizeBearer(req)) {
    logInfo("gateway:unauthorized", { path });
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. This gateway requires a Bearer token; set the gateway-shared-token deployment secret and send \\"Authorization: Bearer <token>\\" on every request."
    });
    return;
  }` : `  // gatewayAuthMode === "none" — no auth check; all routes are public.
  // Set gatewayAuthMode to "bearer" in the Studio's Cloud Run section to
  // gate plugin routes behind the gateway-shared-token deployment secret.`}

  const match = findManagedRoute(path);
  if (!match) {
    logInfo("gateway:route-not-managed", {
      path,
      knownRoutes: routes.map((route) => route.path)
    });
    sendJson(res, 404, {
      ok: false,
      error: "RouteNotManaged",
      message: "SugarDeploy generated this gateway scaffold, but the requested route is not declared for this service unit.",
      path,
      knownRoutes: routes.map((route) => route.path)
    });
    return;
  }

  try {
    if (match.routeId === "sugaragent-generate" && path === match.path) {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentGenerate(req, res);
      return;
    }

    if (match.routeId === "sugaragent-retrieve" && path === match.path + "/embed") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentEmbed(req, res);
      return;
    }

    if (match.routeId === "sugaragent-retrieve" && path === match.path + "/search") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentSearch(req, res);
      return;
    }

    if (match.routeId === "sugaragent-lore" && path === match.path + "/status") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentLoreStatus(req, res);
      return;
    }

    if (match.routeId === "sugaragent-lore" && path === match.path + "/pages") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentLorePages(req, res);
      return;
    }

    if (match.routeId === "sugaragent-lore" && path === match.path + "/resolve") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentLoreResolve(req, res);
      return;
    }

    if (match.routeId === "sugaragent-lore" && path === match.path + "/ingest") {
      logInfo("gateway:dispatch", {
        routeId: match.routeId,
        path
      });
      await handleSugarAgentLoreIngest(req, res);
      return;
    }

    logInfo("gateway:route-unimplemented", {
      routeId: match.routeId,
      path
    });
    sendJson(res, 501, {
      ok: false,
      error: "ProxyHandlerNotImplemented",
      target: ${JSON.stringify(targetId)},
      serviceUnitId,
      route: match,
      request: {
        method: req.method,
        path
      },
      message:
        "SugarDeploy generated the backend gateway scaffold for this route, but no concrete handler is registered for this path yet."
    });
  } catch (error) {
    logError("gateway:handler-failure", error, {
      routeId: match.routeId,
      path
    });
    sendJson(res, 500, {
      ok: false,
      error: "GatewayProxyFailure",
      target: ${JSON.stringify(targetId)},
      serviceUnitId,
      route: match,
      path,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

const port = Number(process.env.PORT || ${containerPort});
server.listen(port, () => {
  console.log("[sugardeploy] gateway ${unit.serviceUnitId} listening on port " + port);
});
`;
  return asTextFile(`${getServiceDirectory(targetId, unit)}/server.mjs`, content);
}

function buildGatewayRoutesFile(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit
): ManagedProjectFile {
  return asJsonFile(`${getServiceDirectory(targetId, unit)}/routes.json`, {
    serviceUnitId: unit.serviceUnitId,
    label: unit.label,
    owners: unit.ownerIds,
    routes: unit.proxyRoutes.map((route) => ({
      routeId: route.routeId,
      path: route.pathHint ?? `/${route.routeId}`,
      protocol: route.protocol,
      consumer: route.consumer
    }))
  });
}

function buildGatewayScaffoldFiles(
  targetId: DeploymentTargetId,
  unit: DeploymentServiceUnit,
  containerPort: number,
  gatewayAuthMode: "none" | "bearer" = "none"
): ManagedProjectFile[] {
  return [
    buildGatewayPackageFile(targetId, unit),
    buildGatewayRoutesFile(targetId, unit),
    buildGatewayServerFile(targetId, unit, containerPort, gatewayAuthMode),
    buildGatewayDockerFile(targetId, unit, containerPort)
  ];
}

function formatLocalCompose(
  plan: DeploymentPlan,
  overrides: LocalDeploymentTargetOverrides,
  loreSource: SugarAgentLoreSourceSettings
): string {
  const services = plan.serviceUnits.map((unit, index) => {
    const serviceName = toComposeServiceName(unit.serviceUnitId);
    const hostPort = overrides.gatewayHostPortBase + index;
    const serviceDir = `./services/${serviceName}`;
    const environment = [
      `      PORT: "8787"`,
      `      ALLOW_ORIGIN: "*"`,
      `      SUGARMAGIC_LORE_SOURCE_KIND: "\${SUGARMAGIC_LORE_SOURCE_KIND:-${loreSource.kind}}"`,
      `      SUGARMAGIC_LORE_SOURCE_PATH: "/opt/sugarmagic/lore-source"`,
      `      SUGARMAGIC_LORE_SOURCE_REPOSITORY_URL: "\${SUGARMAGIC_LORE_SOURCE_REPOSITORY_URL:-${loreSource.repositoryUrl}}"`,
      `      SUGARMAGIC_LORE_SOURCE_REPOSITORY_REF: "\${SUGARMAGIC_LORE_SOURCE_REPOSITORY_REF:-${loreSource.repositoryRef}}"`,
    ];
    const volumes = [
      `    volumes:`,
      `      - "\${SUGARMAGIC_LORE_SOURCE_LOCAL_PATH:-./.sugarmagic-empty-lore}:/opt/sugarmagic/lore-source:ro"`
    ];
    return [
      `  ${serviceName}:`,
      `    build:`,
      `      context: ${serviceDir}`,
      `      dockerfile: Dockerfile`,
      `    env_file:`,
      `      - .env`,
      `    environment:`,
      ...environment,
      ...volumes,
      `    ports:`,
      `      - "${hostPort}:8787"`
    ].join("\n");
  });

  const body = [
    "services:",
    ...(services.length > 0 ? services : ["  # No backend services required"])
  ].join("\n");
  return withHeader("#", body);
}

function buildLocalManagedFiles(
  plan: DeploymentPlan,
  gameProject: GameProject
): ManagedProjectFile[] {
  const overrides = normalizeLocalDeploymentTargetOverrides(plan.targetOverrides);
  const loreSource = readSugarAgentLoreSourceSettings(gameProject);
  const files: ManagedProjectFile[] = [
    asTextFile(
      "deployment/local/README.md",
      formatReadme(plan, [
        "Local Target Notes:",
        "- Copy .env.example to .env before starting the stack.",
        "- Run `docker compose up --build` inside this directory to bring up the generated gateway scaffold.",
        "- For Studio preview to use the local gateway, set `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL=http://localhost:8787` in the Sugarmagic repo-root .env file (Studio's vite.config.ts uses envDir `../..`).",
        "- If you change SugarAgent's lore source path, save the project and redeploy SugarDeploy so the gateway remounts the lore wiki repo.",
        "- Use the SugarAgent workspace to inspect discovered pages and overwrite-ingest the live vector store after lore wiki edits.",
        "- Set a Working Directory override in the SugarDeploy workspace so host-side deploy actions know which game root to operate on.",
        `- Lore source kind: ${loreSource.kind}`,
        `- Lore source path: ${loreSource.localPath || "(unset)"}`,
        `- Compose project name: ${overrides.composeProjectName}`,
        `- Gateway host port base: ${overrides.gatewayHostPortBase}`
      ])
    ),
    asTextFile(
      "deployment/local/.env.example",
      formatEnvExample(plan, [
        `COMPOSE_PROJECT_NAME=${overrides.composeProjectName}`,
        `SUGARDEPLOY_WORKING_DIRECTORY=${overrides.workingDirectory}`,
        `SUGARMAGIC_LORE_SOURCE_KIND=${loreSource.kind}`,
        `SUGARMAGIC_LORE_SOURCE_LOCAL_PATH=${loreSource.localPath}`,
        `SUGARMAGIC_LORE_SOURCE_REPOSITORY_URL=${loreSource.repositoryUrl}`,
        `SUGARMAGIC_LORE_SOURCE_REPOSITORY_REF=${loreSource.repositoryRef}`,
        `SUGARMAGIC_ANTHROPIC_MODEL=claude-sonnet-4-5`,
        `SUGARMAGIC_OPENAI_EMBEDDING_MODEL=text-embedding-3-small`,
        `SUGARMAGIC_OPENAI_VECTOR_STORE_ID=`,
        `ALLOW_ORIGIN=*`
      ])
    ),
    asTextFile(
      "deployment/local/docker-compose.yml",
      formatLocalCompose(plan, overrides, loreSource)
    ),
    asTextFile(
      "deployment/local/.sugarmagic-empty-lore/.gitkeep",
      withHeader("#", "Placeholder lore mount target used when no local lore repo path is configured.")
    ),
    asJsonFile("deployment/local/deployment-plan.json", {
      publishTargetId: plan.publishTargetId,
      deploymentTargetId: plan.deploymentTargetId,
      status: plan.status,
      targetOverrides: overrides,
      loreSource,
      serviceUnits: plan.serviceUnits.map((unit, index) => ({
        serviceUnitId: unit.serviceUnitId,
        runtimeFamily: unit.runtimeFamily,
        executionModel: unit.executionModel,
        isolation: unit.isolation,
        ownerIds: unit.ownerIds,
        routes: unit.proxyRoutes.map((route) => route.pathHint ?? route.routeId),
        hostPort: overrides.gatewayHostPortBase + index
      })),
      conflicts: plan.conflicts,
      warnings: plan.warnings
    })
  ];

  for (const unit of plan.serviceUnits) {
    files.push(...buildGatewayScaffoldFiles("local", unit, 8787));
  }

  return files;
}

function formatCloudRunServiceYaml(
  unit: DeploymentServiceUnit,
  overrides: GoogleCloudRunDeploymentTargetOverrides
): string {
  const serviceName = `${overrides.serviceNamePrefix}-${toComposeServiceName(unit.serviceUnitId)}`;
  const primaryResourceProfile = unit.serviceRequirements[0]?.resourceProfile;
  const memory = `${Math.max(primaryResourceProfile?.memoryInMb ?? 512, 256)}Mi`;
  const cpu = `${Math.max(1, Math.ceil((primaryResourceProfile?.cpuUnits ?? 1000) / 1000))}`;
  return withHeader(
    "#",
    [
      "apiVersion: serving.knative.dev/v1",
      "kind: Service",
      "metadata:",
      `  name: ${serviceName}`,
      "  annotations:",
      `    run.googleapis.com/ingress: ${overrides.ingress}`,
      "spec:",
      "  template:",
      "    metadata:",
      "      annotations:",
      `        autoscaling.knative.dev/minScale: "${overrides.minInstances}"`,
      `        autoscaling.knative.dev/maxScale: "${overrides.maxInstances}"`,
      "    spec:",
      "      containers:",
      "        - image: IMAGE_PLACEHOLDER",
      "          ports:",
      `            - containerPort: ${overrides.containerPort}`,
      "          env:",
      `            - name: PORT`,
      `              value: "${overrides.containerPort}"`,
      `            - name: SUGARMAGIC_SERVICE_UNIT_ID`,
      `              value: "${unit.serviceUnitId}"`,
      "          resources:",
      "            limits:",
      `              cpu: "${cpu}"`,
      `              memory: ${memory}`
    ].join("\n")
  );
}

function formatCloudRunDeployScript(
  plan: DeploymentPlan,
  overrides: GoogleCloudRunDeploymentTargetOverrides
): string {
  const services = plan.serviceUnits.map((unit) => {
    const serviceName = `${overrides.serviceNamePrefix}-${toComposeServiceName(unit.serviceUnitId)}`;
    const serviceDir = `services/${toComposeServiceName(unit.serviceUnitId)}`;
    return { serviceName, serviceDir };
  });
  const serviceLines = services
    .map((service) => `  "${service.serviceName}|${service.serviceDir}"`)
    .join("\n");
  const secretBindings = collectSecretEnvBindings(plan, overrides.serviceNamePrefix);
  const secretArgLines = secretBindings
    .map(
      (binding) =>
        `  "--set-secrets=${binding.envVarName}=${binding.secretManagerName}:latest"`
    )
    .join("\n");
  const ingressArg = `--ingress=${overrides.ingress}`;
  // Story 45.8.5 — Cloud Run platform-level IAM is hardcoded open. End
  // users (browser/mobile/native) authenticate via the gateway's app
  // layer (gatewayAuthMode + Plan 047's per-user IDP plugins), never
  // via Google ID tokens. Flipping this to `--no-allow-unauthenticated`
  // would brick the service for any non-GCP-principal caller, which is
  // every consumer-facing client we ship to.
  const allowUnauthArg = "--allow-unauthenticated";
  // Story 45.5 baked-in defaults. cpu, memory, cpu-throttling are not yet
  // exposed as form fields (deferred to the 45.8.5 lifecycle UX overhaul);
  // these values are the right-sized shape for a thin HTTP proxy gateway.
  // min/max instances ARE exposed (the form's normalized defaults are now
  // 1/4 per the same 45.5 conversation).
  return `#!/usr/bin/env bash
# ${DEPLOYMENT_HEADER}
# Re-save the project in Studio to regenerate this file.
# Intentionally NOT using \`set -u\` (nounset) — macOS ships bash 3.2 which
# treats expanding an empty array (\`\${arr[@]}\`) as "unbound variable" and
# crashes the script before it does anything useful. The critical values
# that would benefit from \`-u\` (terraform outputs) are explicitly null-
# checked below; that's a stronger guard than \`-u\` would give us anyway.
set -eo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "[sugardeploy] jq is required to parse terraform outputs; install via brew/apt before running deploy.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="\${SCRIPT_DIR}/terraform"

if [ ! -d "\${TERRAFORM_DIR}" ]; then
  echo "[sugardeploy] terraform directory not found at \${TERRAFORM_DIR}" >&2
  echo "[sugardeploy] run Setup Infra from the SugarDeploy workspace first" >&2
  exit 1
fi

# Read authoritative deploy-time values from terraform outputs. Terraform
# is the single source of truth for resolved resource names; we don't
# duplicate them here.
TF_OUTPUTS="$(terraform -chdir="\${TERRAFORM_DIR}" output -json)"
ARTIFACT_REGISTRY_URL="$(echo "\${TF_OUTPUTS}" | jq -r '.artifact_registry_url.value')"
RUNTIME_SA_EMAIL="$(echo "\${TF_OUTPUTS}" | jq -r '.runtime_sa_email.value')"

if [ -z "\${ARTIFACT_REGISTRY_URL}" ] || [ "\${ARTIFACT_REGISTRY_URL}" = "null" ]; then
  echo "[sugardeploy] terraform output 'artifact_registry_url' is empty; did Setup Infra finish?" >&2
  exit 1
fi
if [ -z "\${RUNTIME_SA_EMAIL}" ] || [ "\${RUNTIME_SA_EMAIL}" = "null" ]; then
  echo "[sugardeploy] terraform output 'runtime_sa_email' is empty; did Setup Infra finish?" >&2
  exit 1
fi

PROJECT_ID="\${SUGARMAGIC_GCP_PROJECT_ID:-${overrides.projectId || "your-gcp-project"}}"
REGION="\${SUGARMAGIC_GCP_REGION:-${overrides.region}}"

# Secret bindings: env-var-name → Secret Manager secret id. The actual secret
# values live in Secret Manager (written via the SugarDeploy "Set Value" UI),
# NOT in this script. \`--set-secrets\` binds them at request time via the
# runtime SA's \`roles/secretmanager.secretAccessor\` grant (set up by
# terraform). Empty array when no plugin declares secrets.
SECRET_ARGS=(
${secretArgLines}
)

services=(
${serviceLines}
)

if [ \${#services[@]} -eq 0 ]; then
  echo "[sugardeploy] No runtime service units declared by enabled plugins." >&2
  echo "[sugardeploy] Enable a plugin with a runtime service (SugarAgent, etc.) and re-save the project to regenerate this script with services to deploy." >&2
  exit 0
fi

for entry in "\${services[@]}"; do
  IFS='|' read -r service_name service_dir <<<"\$entry"
  image="\${ARTIFACT_REGISTRY_URL}/\${service_name}:latest"

  echo "[sugardeploy] building \${service_name} from \${service_dir}"
  gcloud builds submit "\${service_dir}" \\
    --tag "\${image}" \\
    --project "\${PROJECT_ID}"

  echo "[sugardeploy] deploying \${service_name}"
  gcloud run deploy "\${service_name}" \\
    --image "\${image}" \\
    --project "\${PROJECT_ID}" \\
    --region "\${REGION}" \\
    --service-account "\${RUNTIME_SA_EMAIL}" \\
    --port=${overrides.containerPort} \\
    --cpu=1 \\
    --memory=512Mi \\
    --cpu-throttling \\
    --min-instances=${overrides.minInstances} \\
    --max-instances=${overrides.maxInstances} \\
    ${ingressArg} \\
    ${allowUnauthArg} \\
    "\${SECRET_ARGS[@]}"
done
`;
}

function buildGoogleCloudRunManagedFiles(
  plan: DeploymentPlan,
  gameProject: GameProject
): ManagedProjectFile[] {
  const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    plan.targetOverrides,
    gameProject
  );
  const files: ManagedProjectFile[] = [
    asTextFile(
      "deployment/google-cloud-run/README.md",
      formatReadme(plan, [
        "## Generated artifacts",
        "",
        "Everything under `deployment/google-cloud-run/` is plugin-managed: the SugarDeploy plugin overwrites it on every project save. Do not hand-edit any file with the `GENERATED BY SUGARMAGIC - DO NOT EDIT` header. To change behavior, edit Studio SugarDeploy fields or open the source plugin (`packages/plugins/src/deployment/`).",
        "",
        "- `terraform/` — Artifact Registry, runtime service account, Workload Identity Federation, IAM bindings, empty Secret Manager containers. Owned by terraform. Stamped with `# SUGARMAGIC TEMPLATE VERSION: NN`.",
        "- `services/<unit>/` — gateway scaffold (server.mjs, Dockerfile, package.json, routes.json, service.yaml). One subdirectory per service unit declared by enabled plugins. Same scaffold the Local target generates.",
        "- `deploy.sh` — Cloud Run service lifecycle. NOT owned by terraform. Reads terraform outputs at runtime and shells `gcloud run deploy`. Create on first run, update on subsequent runs.",
        "- `.env.example` — non-secret runtime env vars. Copy to `.env` only if you are running locally outside Studio; production values are baked into the Cloud Run deploy.",
        "- `.gitignore` — terraform state + .terraform/ are intentionally gitignored. State is local; remote-backend opt-in is a future epic.",
        "",
        "## Lifecycle (in dependency order)",
        "",
        "All of these are buttons in the Studio SugarDeploy workspace. They are idempotent (safe to re-run).",
        "",
        "1. **Create GCP Project** — `gcloud projects create` + billing link + `gcloud services enable` for every API in `REQUIRED_GCP_APIS`. Idempotent. Detects whether the project already exists.",
        "2. **Setup Infra** — `terraform init` + `terraform apply`. Stands up Artifact Registry, runtime SA, IAM, WIF, and empty Secret Manager containers. Idempotent. Re-run after enabling additional GCP APIs in the plugin.",
        "3. **Set Secret Value** (per secret in the Secrets section) — opens a password-masked modal; submit shells `gcloud secrets versions add` with the value piped via stdin. The value never enters Studio state, React props, console logs, or argv. Rotation: set a new value; previous version is retained in Secret Manager but only `:latest` is bound at deploy time.",
        "4. **Deploy** — `bash deploy.sh`. Builds the gateway image, pushes to Artifact Registry, deploys to Cloud Run with `--set-secrets=ENV=SECRET_NAME:latest` for every declared secret. Returns the deployed URL.",
        "5. **Status / Health** — `Status` shells `gcloud run services describe` (multi-second; on-demand). `Health` HTTP-GETs `/health` on the deployed URL (sub-second; auto-probed on workspace open).",
        "6. **Stop** — `gcloud run services delete --quiet`. Service is gone; Artifact Registry + IAM + secrets remain. A subsequent Deploy is fast (image is already in Artifact Registry).",
        "7. **Teardown Infra** (red, behind confirmation) — `gcloud run services delete` first (service is gcloud-owned, terraform doesn't know about it), THEN `terraform destroy`. Surrounding infrastructure is removed; the GCP project itself stays.",
        "",
        "Nuclear cleanup is `gcloud projects delete <id>` — wipes everything at once. Use when you want the GCP project gone too. There is no Studio button for this; it is intentional one-way infrastructure.",
        "",
        "## Cut New Major Version",
        "",
        "**Release New Version** in the Version panel cuts the current major into a git tag and bumps to the next major. The flow is a Studio-orchestrated saga:",
        "",
        "1. Pre-flight: git on PATH, working tree clean, target tag does not exist.",
        "2. `git tag v{priorMajor}.0.0 HEAD`.",
        "3. Studio bumps `gameProject.majorVersion` and registers a new 5-char suffix for the new major in the SugarDeploy plugin state slot.",
        "4. Studio saves the bumped `project.sgrmagic` + regenerates this directory at the new major version.",
        "5. `git add -u` + `git commit -m \"chore: bump major version to N\"`.",
        "",
        "After success, the SugarDeploy workspace resolves to `${slug}-v{newMajor}-{newSuffix}` for project id, service name prefix, and secret names. Create GCP Project re-enables (the new project id doesn't exist yet); Setup Infra + Deploy stand up the new major in a fresh GCP project. The prior major's GCP project keeps running untouched.",
        "",
        "Patching an old major: `git worktree add ../patch v{oldMajor}.0.0`, open that worktree in Studio. The worktree's `project.sgrmagic` carries the old `majorVersion`; SugarDeploy resolves back to the prior GCP project (its suffix is preserved forever in the plugin state slot). Edit, save, Deploy — the old major redeploys; the new major is unaffected.",
        "",
        "Push to remote git is NOT automatic. `git push && git push --tags` when you mean to ship.",
        "",
        "## Identity layout",
        "",
        `- GCP project id: \`${overrides.projectId}\``,
        `- Region: \`${overrides.region}\``,
        `- Service name prefix: \`${overrides.serviceNamePrefix}\``,
        `- Container port: \`${overrides.containerPort}\``,
        `- Ingress: \`${overrides.ingress}\``,
        `- Min / Max instances: \`${overrides.minInstances}\` / \`${overrides.maxInstances}\``,
        `- Runtime service account name override: \`${overrides.runtimeServiceAccountName || "(auto-derived: ${serviceNamePrefix}-runtime)"}\``,
        `- GitHub repo (for Workload Identity Federation): \`${overrides.githubRepo || "(unset)"}\``,
        "",
        "## Gateway auth mode",
        "",
        `Current mode: \`${overrides.gatewayAuthMode}\`.`,
        "",
        ...(overrides.gatewayAuthMode === "none"
          ? [
              "The deployed gateway has NO app-layer auth check. Any HTTP caller that finds the URL can hit any route. Treat any plugin route that costs money (LLM proxy, vector DB writes, etc.) as exposed and budget accordingly. Flip the auth mode to `bearer` in the Studio Cloud Run section to add the shared-token gate."
            ]
          : [
              "Every request EXCEPT `/health` requires `Authorization: Bearer <token>`. The expected token is the `gateway-shared-token` deployment secret, exposed in the container as `SUGARMAGIC_GATEWAY_SHARED_TOKEN`. Set it via the SugarDeploy Secrets section's Set Value modal; rotate by setting a new value (the previous version is retained in Secret Manager but only `:latest` is bound at deploy time). Game / CI / devtools clients must send the token on every request.",
              "",
              "Single shared token across all callers. Appropriate for solo-dev alpha; not real per-player identity. Per-user identity providers (Supabase / Auth0 / etc.) land in Plan 047."
            ]),
        "",
        "## Cloud Run platform-level auth",
        "",
        "`gcloud run deploy --allow-unauthenticated` is hardcoded by SugarDeploy. The deployed service is reachable from any client at the GCP edge; all auth happens at the app layer (Gateway Auth Mode above). Flipping the platform-level toggle would brick the service for any non-GCP-IAM caller, which is every browser / mobile / desktop game client.",
        "",
        "## References",
        "",
        "- Studio source: `apps/studio/src/plugins/catalog/sugardeploy/`",
        "- Plugin source: `packages/plugins/src/catalog/sugardeploy/` and `packages/plugins/src/deployment/`",
        "- Architectural decisions: docs/adr/017-sugardeploy-cloud-run-architecture.md",
        "- Epic: docs/plans/045-sugardeploy-cloud-run-plugin-owned-infrastructure-epic.md"
      ])
    ),
    asTextFile(
      "deployment/google-cloud-run/.env.example",
      formatEnvExample(plan, [
        `SUGARDEPLOY_WORKING_DIRECTORY=${overrides.workingDirectory}`,
        `SUGARMAGIC_GCP_PROJECT_ID=${overrides.projectId}`,
        `SUGARMAGIC_GCP_REGION=${overrides.region}`,
        `SUGARMAGIC_ANTHROPIC_MODEL=claude-sonnet-4-5`,
        `SUGARMAGIC_OPENAI_EMBEDDING_MODEL=text-embedding-3-small`,
        `SUGARMAGIC_OPENAI_VECTOR_STORE_ID=`
      ])
    ),
    asTextFile(
      "deployment/google-cloud-run/deploy.sh",
      formatCloudRunDeployScript(plan, overrides)
    ),
    asJsonFile("deployment/google-cloud-run/deployment-plan.json", {
      publishTargetId: plan.publishTargetId,
      deploymentTargetId: plan.deploymentTargetId,
      status: plan.status,
      targetOverrides: overrides,
      serviceUnits: plan.serviceUnits.map((unit) => ({
        serviceUnitId: unit.serviceUnitId,
        serviceName: `${overrides.serviceNamePrefix}-${toComposeServiceName(unit.serviceUnitId)}`,
        runtimeFamily: unit.runtimeFamily,
        executionModel: unit.executionModel,
        routes: unit.proxyRoutes.map((route) => route.pathHint ?? route.routeId)
      })),
      conflicts: plan.conflicts,
      warnings: plan.warnings
    })
  ];

  for (const unit of plan.serviceUnits) {
    const serviceDir = getServiceDirectory("google-cloud-run", unit);
    files.push(...buildGatewayScaffoldFiles("google-cloud-run", unit, overrides.containerPort, overrides.gatewayAuthMode));
    files.push(
      asTextFile(
        `${serviceDir}/service.yaml`,
        formatCloudRunServiceYaml(unit, overrides)
      )
    );
  }

  // Plugin-owned terraform: stand up the slow-changing infrastructure (Artifact
  // Registry, runtime SA, WIF for GitHub, IAM bindings, empty Secret Manager
  // containers). The Cloud Run service itself stays gcloud-managed by deploy.sh.
  const terraformDir = "deployment/google-cloud-run/terraform";
  files.push(
    asTextFile(`${terraformDir}/main.tf`, buildCloudRunTerraformMainFile(plan, overrides)),
    asTextFile(`${terraformDir}/variables.tf`, buildCloudRunTerraformVariablesFile()),
    asTextFile(`${terraformDir}/outputs.tf`, buildCloudRunTerraformOutputsFile()),
    asTextFile(
      `${terraformDir}/terraform.tfvars`,
      buildCloudRunTerraformTfvarsFile(plan, overrides)
    ),
    asTextFile(`${terraformDir}/.gitignore`, buildCloudRunTerraformGitignore())
  );

  return files;
}

const targetHandlers: Record<DeploymentTargetId, DeploymentTargetHandler> = {
  local: {
    definition: {
      targetId: "local",
      displayName: "Local",
      summary: "Local same-origin deployment target with generated proxy and service scaffolding.",
      implemented: true
    },
    normalizeOverrides: (gameProject) =>
      ({
        ...normalizeLocalDeploymentTargetOverrides(
          getDeploymentTargetOverrides(getDeploymentSettings(gameProject), "local"),
          gameProject
        )
      }),
    buildManagedFiles: buildLocalManagedFiles
  },
  "google-cloud-run": {
    definition: {
      targetId: "google-cloud-run",
      displayName: "Google Cloud Run",
      summary: "Hosted deployment target for Cloud Run services and managed proxy topology.",
      implemented: true
    },
    normalizeOverrides: (gameProject) =>
      ({
        ...normalizeGoogleCloudRunDeploymentTargetOverrides(
          getDeploymentTargetOverrides(
            getDeploymentSettings(gameProject),
            "google-cloud-run"
          ),
          gameProject
        )
      }),
    collectWarnings: (plan) => {
      const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(plan.targetOverrides);
      return overrides.projectId.length === 0
        ? [
            "Google Cloud Run target is selected but the GCP project id override is empty; deploy.sh will need SUGARMAGIC_GCP_PROJECT_ID set before deployment."
          ]
        : [];
    },
    buildManagedFiles: buildGoogleCloudRunManagedFiles
  },
};

export function listDeploymentTargets(): DeploymentTargetDefinition[] {
  return Object.values(targetHandlers)
    .map((handler) => handler.definition)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function collectRequirementSources(
  gameProject: GameProject
): {
  sources: DeploymentRequirementSource[];
  conflicts: DeploymentConflict[];
} {
  const sources: DeploymentRequirementSource[] = [];
  const conflicts: DeploymentConflict[] = [];

  for (const configuration of gameProject.pluginConfigurations) {
    if (!configuration.enabled) continue;
    const definition = getDiscoveredPluginDefinition(configuration.pluginId);
    if (!definition) {
      conflicts.push({
        conflictId: `missing-plugin:${configuration.pluginId}`,
        severity: "error",
        kind: "missing-plugin-definition",
        message: `Enabled plugin ${configuration.pluginId} is not available in this Sugarmagic install, so deployment requirements cannot be resolved.`,
        ownerIds: [configuration.pluginId],
        requirementIds: []
      });
      continue;
    }
    const requirements = normalizeDeploymentRequirements(
      definition.deploymentRequirements ?? []
    );
    if (requirements.length === 0) continue;
    sources.push({
      ownerId: definition.manifest.pluginId,
      displayName: definition.manifest.displayName,
      requirements
    });
  }

  return { sources, conflicts };
}

function buildServiceUnits(
  requirements: DeploymentRequirement[],
  deploymentTargetId: DeploymentTargetId | null
): {
  serviceUnits: DeploymentServiceUnit[];
  conflicts: DeploymentConflict[];
} {
  const conflicts: DeploymentConflict[] = [];
  const serviceRequirements = requirements.filter(
    (requirement): requirement is RuntimeServiceRequirement =>
      requirement.kind === "runtime-service"
  );
  const proxyRoutes = requirements.filter(
    (requirement): requirement is ProxyRouteRequirement =>
      requirement.kind === "proxy-route"
  );
  const secrets = requirements.filter(
    (requirement): requirement is SecretRequirement => requirement.kind === "secret"
  );
  const topology = requirements.filter(
    (requirement): requirement is TopologyRequirement => requirement.kind === "topology"
  );

  const sharedRequestResponse = serviceRequirements.filter(
    (requirement) =>
      requirement.executionModel === "request-response" &&
      requirement.isolation === "shared-allowed"
  );
  const isolatedOrBackground = serviceRequirements.filter(
    (requirement) => !sharedRequestResponse.includes(requirement)
  );

  const sharedByRuntime = new Map<
    RuntimeServiceFamily | "unspecified",
    RuntimeServiceRequirement[]
  >();
  for (const requirement of sharedRequestResponse) {
    const key = requirement.runtimeFamily ?? "unspecified";
    const bucket = sharedByRuntime.get(key) ?? [];
    bucket.push(requirement);
    sharedByRuntime.set(key, bucket);
  }

  if (sharedByRuntime.size > 1) {
    conflicts.push({
      conflictId: "runtime-family-split:shared-request-response",
      severity: "warning",
      kind: "runtime-family-split",
      message:
        "Shared request-response requirements use multiple runtime families, so SugarDeploy will split them into separate gateway service units.",
      ownerIds: Array.from(
        new Set(sharedRequestResponse.map((requirement) => requirement.ownerId))
      ),
      requirementIds: sharedRequestResponse.map((requirement) => requirement.requirementId)
    });
  }

  const serviceUnits: DeploymentServiceUnit[] = [];
  for (const [runtimeFamilyKey, bucket] of sharedByRuntime.entries()) {
    const ownerIds = Array.from(new Set(bucket.map((requirement) => requirement.ownerId)));
    const relatedRequirements = requirements.filter((requirement) =>
      ownerIds.includes(requirement.ownerId)
    );
    serviceUnits.push({
      serviceUnitId:
        runtimeFamilyKey === "unspecified"
          ? "sugarmagic-gateway"
          : `sugarmagic-gateway-${runtimeFamilyKey}`,
      label:
        runtimeFamilyKey === "unspecified"
          ? "Sugarmagic Gateway"
          : `Sugarmagic Gateway (${runtimeFamilyKey})`,
      runtimeFamily: runtimeFamilyKey === "unspecified" ? null : runtimeFamilyKey,
      executionModel: "request-response",
      isolation: "shared-allowed",
      ownerIds,
      requirements: relatedRequirements,
      serviceRequirements: bucket,
      secrets: secrets.filter((requirement) => ownerIds.includes(requirement.ownerId)),
      proxyRoutes: proxyRoutes.filter((requirement) => ownerIds.includes(requirement.ownerId)),
      topology: topology.filter((requirement) => ownerIds.includes(requirement.ownerId))
    });
  }

  for (const requirement of isolatedOrBackground) {
    const ownerIds = [requirement.ownerId];
    const relatedRequirements = requirements.filter((item) =>
      ownerIds.includes(item.ownerId)
    );
    serviceUnits.push({
      serviceUnitId: `${requirement.ownerId}-${requirement.serviceId}`,
      label: `${requirement.ownerId} ${requirement.serviceId}`,
      runtimeFamily: requirement.runtimeFamily ?? null,
      executionModel: requirement.executionModel,
      isolation: requirement.isolation,
      ownerIds,
      requirements: relatedRequirements,
      serviceRequirements: [requirement],
      secrets: secrets.filter((item) => ownerIds.includes(item.ownerId)),
      proxyRoutes: proxyRoutes.filter((item) => ownerIds.includes(item.ownerId)),
      topology: topology.filter((item) => ownerIds.includes(item.ownerId))
    });
  }

  // Story 45.5.5 — baseline gateway. When no enabled plugin contributes a
  // shared-allowed request-response runtime-service requirement AND a
  // deployment target is selected, inject a default `sugarmagic-gateway`
  // service unit. Gives every deployment a guaranteed-deployable artifact
  // with the existing /healthz endpoint, so the build+push+deploy pipeline
  // is verifiable end-to-end without first committing to a plugin. Plugin
  // contributions still merge in normally when other plugins are enabled
  // (those go through the bucket logic above and produce their own unit,
  // so this branch is skipped).
  if (serviceUnits.length === 0 && deploymentTargetId !== null) {
    serviceUnits.push({
      serviceUnitId: "sugarmagic-gateway",
      label: "Sugarmagic Gateway",
      runtimeFamily: null,
      executionModel: "request-response",
      isolation: "shared-allowed",
      ownerIds: ["sugardeploy"],
      requirements: [],
      serviceRequirements: [],
      secrets: [],
      proxyRoutes: [],
      topology: []
    });
  }

  return {
    serviceUnits,
    conflicts
  };
}

export function planGameDeployment(gameProject: GameProject): DeploymentPlan {
  const { sources, conflicts: sourceConflicts } = collectRequirementSources(gameProject);
  const deploymentSettings = getDeploymentSettings(gameProject);
  const targetId = deploymentSettings.deploymentTargetId;
  const requirements = sources.flatMap((source) => source.requirements);
  const { serviceUnits, conflicts: serviceConflicts } = buildServiceUnits(
    requirements,
    targetId
  );

  // Story 45.5.8 — bearer-token auth secret injection. When the Cloud Run
  // target's gatewayAuthMode is "bearer", inject the gateway-shared-token
  // SecretRequirement into the gateway service unit's secrets list so it
  // flows through the existing terraform tfvars + deploy.sh --set-secrets +
  // Studio Set Value paths. Single shared token across all callers; not
  // per-user identity (that's Plan 047's job).
  if (targetId === "google-cloud-run") {
    const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
      deploymentSettings.targetOverrides["google-cloud-run"],
      gameProject
    );
    if (cloudRunOverrides.gatewayAuthMode === "bearer") {
      const bearerSecret: SecretRequirement = {
        requirementId: createDeploymentRequirementId({
          ownerId: SUGARDEPLOY_PLUGIN_ID,
          kind: "secret",
          key: "gateway-shared-token"
        }),
        ownerId: SUGARDEPLOY_PLUGIN_ID,
        ownerKind: "plugin",
        kind: "secret",
        required: true,
        secretKey: "gateway-shared-token",
        consumption: "server-only",
        exposure: "private",
        mappingHint: "SUGARMAGIC_GATEWAY_SHARED_TOKEN",
        description:
          "Shared bearer token gating every plugin route on the deployed Cloud Run gateway. Clients (game build, CI, devtools) send `Authorization: Bearer <token>`; the gateway compares against this value using a constant-time check. Story 45.5.8.",
        tags: ["auth", "gateway"]
      };
      for (const unit of serviceUnits) {
        if (
          unit.executionModel === "request-response" &&
          unit.isolation === "shared-allowed"
        ) {
          unit.secrets = [...unit.secrets, bearerSecret];
        }
      }
    }
  }

  const conflicts = [...sourceConflicts, ...serviceConflicts];
  const warnings: string[] = [];

  if (!targetId) {
    conflicts.push({
      conflictId: "missing-target",
      severity: "warning",
      kind: "missing-target",
      message: "No deployment target is selected.",
      ownerIds: [],
      requirementIds: []
    });
  }

  const handler = targetId ? targetHandlers[targetId] : null;
  if (targetId && !handler) {
    conflicts.push({
      conflictId: `unsupported-target:${targetId}`,
      severity: "error",
      kind: "unsupported-target",
      message: `Deployment target ${targetId} is not supported by SugarDeploy.`,
      ownerIds: [],
      requirementIds: []
    });
  }

  const targetOverrides = handler ? handler.normalizeOverrides(gameProject) : {};

  if (handler && !handler.definition.implemented) {
    warnings.push(
      `${handler.definition.displayName} is planned but not fully implemented yet; SugarDeploy will generate stub deployment artifacts for review.`
    );
  }

  const provisionalPlan: DeploymentPlan = {
    publishTargetId: getPublishSettings(gameProject).publishTargetId,
    deploymentTargetId: targetId,
    targetLabel: handler?.definition.displayName ?? null,
    targetOverrides,
    status:
      conflicts.some((conflict) => conflict.severity === "error")
        ? "invalid"
        : conflicts.length > 0 || warnings.length > 0
          ? "warning"
          : "ready",
    requirementSources: sources,
    requirements,
    serviceUnits,
    conflicts,
    warnings,
    managedFiles: []
  };

  if (handler?.collectWarnings) {
    provisionalPlan.warnings.push(...handler.collectWarnings(provisionalPlan));
    provisionalPlan.status =
      provisionalPlan.conflicts.some((conflict) => conflict.severity === "error")
        ? "invalid"
        : provisionalPlan.conflicts.length > 0 || provisionalPlan.warnings.length > 0
          ? "warning"
          : "ready";
  }

  return {
    ...provisionalPlan,
    managedFiles: handler ? handler.buildManagedFiles(provisionalPlan, gameProject) : []
  };
}
