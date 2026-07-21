import type {
  DeploymentRequirement,
  ProxyRouteRequirement,
  RuntimeServiceFamily,
  RuntimeServiceRequirement,
  SecretRequirement,
  TopologyRequirement
} from "@sugarmagic/domain";
import { createDeploymentRequirementId } from "../../../domain/src/index";
import type {
  BackendDeploymentTargetId,
  DeploymentSettings,
  FrontendDeploymentTargetId,
  GameProject
} from "@sugarmagic/domain";
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
import { validateGatewayRuntimeConfigKey } from "../sdk";
import { SUGARDEPLOY_PLUGIN_ID } from "../catalog/sugardeploy";
import {
  type EffectiveGatewayAuthMode,
  type GoogleCloudRunDeploymentTargetOverrides,
  type LocalDeploymentTargetOverrides,
  deriveEffectiveGatewayAuthMode,
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
import {
  buildNetlifyManagedFiles,
  collectNetlifyWarnings,
  FRONTEND_RENAME_LEDGER,
  NETLIFY_TEMPLATE_VERSION,
  normalizeNetlifyDeploymentTargetOverrides
} from "./netlify";
// Story 47.8 — SugarProfile-emitted Supabase managed files (CLI
// config + migration SQL). Gated on the plugin being enabled with
// `enableLogin: true` and a non-empty supabaseUrl.
import {
  buildSupabaseManagedFiles,
  SUPABASE_JWT_VERIFIER_FUNCTION_NAME,
  SUPABASE_URL_ENV_VAR
} from "./supabase";
import { GATEWAY_CORE_COMPILED_SOURCE } from "./gateway/core.compiled";
import {
  buildSugarDeployGithubWorkflowFile,
  getSugarDeployGithubWorkflowPath,
  parseWorkflowTemplateVersionStamp,
  planNeedsGithubWorkflow,
  SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION,
  WORKFLOW_RENAME_LEDGER
} from "./github-workflow";
import {
  BOOT_JSON_SCHEMA_VERSION,
  buildPublishedWebManagedFiles,
  getPublishedWebDirectory,
  type PublishedWebRuntimeSnapshot
} from "./published-web";

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
  // Story 46.6 — backend axis (where game services run). Renamed from
  // `deploymentTargetId` to disambiguate from the frontend axis added
  // alongside it. Generated sidecar JSON files (`deployment-plan.json`)
  // emit the renamed field too.
  backendDeploymentTargetId: BackendDeploymentTargetId | null;
  targetLabel: string | null;
  targetOverrides: Record<string, unknown>;
  // Story 46.6 — frontend axis (where the static client artifact runs).
  // Chosen independently of the backend; null when no frontend target
  // is configured. The matching handler's `buildManagedFiles` runs
  // alongside the backend handler's and appends to plan.managedFiles.
  frontendDeploymentTargetId: FrontendDeploymentTargetId | null;
  frontendTargetLabel: string | null;
  frontendTargetOverrides: Record<string, unknown>;
  status: "ready" | "warning" | "invalid";
  requirementSources: DeploymentRequirementSource[];
  requirements: DeploymentRequirement[];
  serviceUnits: DeploymentServiceUnit[];
  conflicts: DeploymentConflict[];
  warnings: string[];
  managedFiles: ManagedProjectFile[];
  /**
   * Story 46.15 — non-secret per-game env vars enabled plugins
   * declared via `gatewayRuntimeConfigKeys`, paired with the
   * values read from each plugin's per-game config slot. Empty
   * map when no plugin declares any. Threaded into deploy.sh's
   * `--set-env-vars` + the GHA workflow's `deploy-backend` env
   * block. Conflicts are NOT resolved here; if two plugins
   * declare the same envVarName (which they shouldn't given the
   * naming convention enforces a SUGARMAGIC_<PLUGIN>_<KEY>
   * prefix), the later one wins (insertion order from
   * `pluginConfigurations` iteration).
   */
  gatewayRuntimeConfigEnv: Record<string, string>;
}

export interface DeploymentTargetDefinition {
  targetId: BackendDeploymentTargetId;
  displayName: string;
  summary: string;
  implemented: boolean;
  /**
   * Story 46.6 — Discriminates backend vs frontend handlers. Every
   * existing `DeploymentTargetDefinition` is a backend target (services
   * + secrets + IAM); the parallel `FrontendDeploymentTargetDefinition`
   * for static-hosting targets carries `role: "frontend"`. Today the UI
   * uses this to render two separate Targets tab strips in the Provision
   * workspace.
   */
  role: "backend";
}

interface DeploymentTargetHandler {
  definition: DeploymentTargetDefinition;
  normalizeOverrides: (gameProject: GameProject) => Record<string, unknown>;
  collectWarnings?: (plan: DeploymentPlan) => string[];
  buildManagedFiles: (plan: DeploymentPlan, gameProject: GameProject) => ManagedProjectFile[];
}

// Story 46.6 — frontend-target counterpart of DeploymentTargetDefinition.
// Lives on a separate enum + registry so neither side has to know about
// the other's id space (Netlify isn't a backend target choice;
// google-cloud-run isn't a frontend target choice). The Provision UI
// renders two parallel tab strips driven by their respective lists.
export interface FrontendDeploymentTargetDefinition {
  targetId: FrontendDeploymentTargetId;
  displayName: string;
  summary: string;
  implemented: boolean;
  role: "frontend";
}

interface FrontendDeploymentTargetHandler {
  definition: FrontendDeploymentTargetDefinition;
  normalizeOverrides: (gameProject: GameProject) => Record<string, unknown>;
  collectWarnings?: (plan: DeploymentPlan) => string[];
  buildManagedFiles: (plan: DeploymentPlan, gameProject: GameProject) => ManagedProjectFile[];
}

export {
  GITHUB_REPO_REGEX,
  deriveEffectiveGatewayAuthMode,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  stripGithubRepoPrefixes,
  type EffectiveGatewayAuthMode,
  type GatewayAuthMode
} from "./overrides";

export {
  buildAppendDeployHistoryCommand,
  buildSetVersionedProjectIdentifierCommand,
  buildUpdateDeployHistoryEntryCommand,
  buildUpdateDeploymentSettingsCommand,
  buildUpdatePublishSettingsCommand,
  getDeployHistory,
  getDeploymentSettings,
  getPublishSettings,
  getVersionedProjectIdentifiers,
  type DeployHistoryEntry,
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
/**
 * Story 46.9 — derive the gateway's CORS-allowed origins from the
 * project's frontend configuration. The list flows through:
 *
 *   terraform var `allowed_origins`
 *     -> terraform output `allowed_origins`
 *     -> deploy.sh reads it
 *     -> `gcloud run deploy --set-env-vars=SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS=...`
 *     -> gateway server.mjs per-request Origin matching
 *
 * Built from (in order):
 *   1. Netlify per-deploy wildcard origin `https://*--{siteName}.netlify.app`
 *      (each deploy gets a unique <deploy-id>--<site> subdomain; the
 *      gateway pattern-matches at request time).
 *   2. Netlify alias / production URL `https://{siteName}.netlify.app`.
 *   3. PublishTargetSettings.liveDomain when set (custom domain).
 *
 * Empty array when no frontend target is configured — the gateway
 * then emits no ACAO header at all, blocking browsers from
 * cross-origin reads. That's the safe default.
 */
export function deriveGatewayAllowedOrigins(
  plan: DeploymentPlan,
  gameProject: GameProject
): string[] {
  const origins: string[] = [];
  if (plan.frontendDeploymentTargetId === "netlify") {
    const overrides = normalizeNetlifyDeploymentTargetOverrides(
      plan.frontendTargetOverrides
    );
    const siteName = overrides.siteName.trim();
    if (siteName.length > 0) {
      origins.push(`https://*--${siteName}.netlify.app`);
      origins.push(`https://${siteName}.netlify.app`);
    }
  }
  const publishSettings = getPublishSettings(gameProject);
  const liveDomain = publishSettings.liveDomain.trim();
  if (liveDomain.length > 0) {
    origins.push(
      liveDomain.startsWith("http://") || liveDomain.startsWith("https://")
        ? liveDomain
        : `https://${liveDomain}`
    );
  }
  // De-dupe; preserve insertion order.
  const seen = new Set<string>();
  return origins.filter((origin) => {
    if (seen.has(origin)) return false;
    seen.add(origin);
    return true;
  });
}

export function getCloudRunServiceNamesForPlan(plan: DeploymentPlan): string[] {
  const overrides = normalizeGoogleCloudRunDeploymentTargetOverrides(plan.targetOverrides);
  return plan.serviceUnits.map(
    (unit) => `${overrides.serviceNamePrefix}-${toComposeServiceName(unit.serviceUnitId)}`
  );
}
export {
  computeNextMinorTag,
  computeNextPatchTag,
  groupVersionTags,
  parseVersionTag,
  type ComputeNextPatchTagResult,
  type ComputeNextTagResult,
  type GroupedVersionMajor,
  type ParsedVersionTag
} from "./version-tags";

export {
  buildSupabaseManagedFiles,
  extractSupabaseProjectRef,
  getSugarProfileMigrationDirectory,
  SUPABASE_JWT_VERIFIER_FUNCTION_NAME,
  SUPABASE_MIGRATIONS_TEMPLATE_VERSION,
  SUPABASE_URL_ENV_VAR
} from "./supabase";
// NOTE: verifySupabaseJwt (gateway/supabase-jwt.ts) is deliberately NOT
// re-exported here. It imports node:crypto at top level, and this package's
// single entry is consumed by browser code (Studio, web target); tests that
// need the function import it by relative path instead.

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
  targetId: BackendDeploymentTargetId,
  unit: DeploymentServiceUnit
): string {
  return `deployment/${targetId}/services/${toComposeServiceName(unit.serviceUnitId)}`;
}

function buildGatewayPackageFile(
  targetId: BackendDeploymentTargetId,
  unit: DeploymentServiceUnit
): ManagedProjectFile {
  return asJsonFile(`${getServiceDirectory(targetId, unit)}/package.json`, {
    name: `${toComposeServiceName(unit.serviceUnitId)}-gateway`,
    private: true,
    type: "module"
  });
}

function buildGatewayDockerFile(
  targetId: BackendDeploymentTargetId,
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

function buildGatewayAuthGateSnippet(gatewayAuthMode: EffectiveGatewayAuthMode): string {
  if (gatewayAuthMode === "bearer") {
    return `  if (!authorizeBearer(req)) {
    logInfo("gateway:unauthorized", { path });
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. This gateway requires a Bearer token; set the gateway-shared-token deployment secret and send \\"Authorization: Bearer <token>\\" on every request."
    });
    return;
  }`;
  }
  if (gatewayAuthMode === "supabase-jwt") {
    return `  const verifiedUser = await ${SUPABASE_JWT_VERIFIER_FUNCTION_NAME}(req);
  if (!verifiedUser) {
    logInfo("gateway:unauthorized", { path });
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized",
      message: "Missing or invalid Supabase JWT. This gateway requires \\"Authorization: Bearer <jwt>\\" signed by the configured Supabase project."
    });
    return;
  }
  req.user = verifiedUser;`;
  }
  return `  // gatewayAuthMode === "none" — no auth check; all routes are public.
  // Set gatewayAuthMode to "bearer" in the Studio's Cloud Run section to
  // gate plugin routes behind the gateway-shared-token deployment secret;
  // enable SugarProfile alongside "bearer" to upgrade the gate to Supabase
  // JWT verification (Plan 047 §47.9).`;
}

function buildGatewayServerFile(
  targetId: BackendDeploymentTargetId,
  unit: DeploymentServiceUnit,
  _containerPort: number,
  gatewayAuthMode: EffectiveGatewayAuthMode = "none"
): ManagedProjectFile {
  // Story 071.9 — gateway source moved from inline template to typechecked
  // TypeScript in packages/plugins/src/deployment/gateway/{core,supabase-jwt}.ts.
  // The compiled bundle is pre-generated by `pnpm build:gateway-source` and
  // committed as core.compiled.ts. This function assembles the final server.mjs
  // by injecting the per-plan auth gate at the /*! __GATEWAY_AUTH_GATE__ */
  // placeholder the esbuild output preserves via legalComments: "inline".
  const authGate = buildGatewayAuthGateSnippet(gatewayAuthMode);
  const content = GATEWAY_CORE_COMPILED_SOURCE.replace("/*! __GATEWAY_AUTH_GATE__ */", authGate);
  if (content === GATEWAY_CORE_COMPILED_SOURCE) {
    throw new Error(
      "buildGatewayServerFile: /*! __GATEWAY_AUTH_GATE__ */ placeholder not found in compiled gateway source. " +
      "Run `pnpm --filter @sugarmagic/plugins build:gateway-source` to regenerate."
    );
  }
  // esbuild strips core.ts's header comment; re-add the managed-file marker
  // the scaffold README points users at.
  return asTextFile(
    `${getServiceDirectory(targetId, unit)}/server.mjs`,
    withHeader("//", content)
  );
}

// MARKER_REPLACED_TEMPLATE: the ~1250-line buildGatewayServerFile template string
// that was here before 071.9 is now in packages/plugins/src/deployment/gateway/core.ts
// (typechecked TypeScript) and compiled to core.compiled.ts by build:gateway-source.
// The historical template was: import { createServer } from "node:http";

function buildGatewayRoutesFile(
  targetId: BackendDeploymentTargetId,
  unit: DeploymentServiceUnit,
  containerPort: number,
  gatewayAuthMode: EffectiveGatewayAuthMode = "none"
): ManagedProjectFile {
  return asJsonFile(`${getServiceDirectory(targetId, unit)}/routes.json`, {
    serviceUnitId: unit.serviceUnitId,
    targetId,
    authMode: gatewayAuthMode,
    containerPort,
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
  targetId: BackendDeploymentTargetId,
  unit: DeploymentServiceUnit,
  containerPort: number,
  gatewayAuthMode: EffectiveGatewayAuthMode = "none"
): ManagedProjectFile[] {
  return [
    buildGatewayPackageFile(targetId, unit),
    buildGatewayRoutesFile(targetId, unit, containerPort, gatewayAuthMode),
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
      `      SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS: "*"`,
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
        `SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL=claude-sonnet-4-5`,
        `SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID=`,
        `SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS=*`
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
      backendDeploymentTargetId: plan.backendDeploymentTargetId,
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

/**
 * Story 46.15 — collects the union of `runtime-config` requirements
 * from every plugin enabled on this plan. Used by
 * `formatCloudRunDeployScript` to emit per-key `--set-env-vars`
 * stanzas alongside `SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS`. Caller
 * supplies the resolved values (from sugarmagic-root `.env` via the
 * host endpoint); the generator just lays out the variable plumbing
 * + the gcloud invocation shape.
 */
function collectRuntimeConfigEnvKeys(plan: DeploymentPlan): string[] {
  // Story 46.15 reshape — keys come from the plan's pre-computed
  // gatewayRuntimeConfigEnv (populated by planGameDeployment from
  // enabled plugins' `gatewayRuntimeConfigKeys` + their per-game
  // config slot values).
  return Object.keys(plan.gatewayRuntimeConfigEnv).sort();
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
  // Story 46.15 — non-secret runtime env keys the gateway needs.
  // Values are read from deploy.sh's own process env at runtime; the
  // CI workflow (or local studio's host action) sets them before
  // shelling deploy.sh, so the values reach Cloud Run via
  // --set-env-vars without the script having to read .env directly.
  const runtimeConfigKeys = collectRuntimeConfigEnvKeys(plan);
  const runtimeConfigEnvLines = runtimeConfigKeys
    .map(
      (key) =>
        `RUNTIME_CONFIG_PAIRS+=("${key}=\${${key}:-}")`
    )
    .join("\n");
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
# Story 46.10 — env-vars-or-terraform resolution. GHA can't run
# terraform (no state in the runner; no terraform binary by default),
# so the workflow injects the three values it knows directly:
#   - SUGARMAGIC_RUNTIME_SA_EMAIL (already a repo VAR from 46.8)
#   - SUGARMAGIC_ARTIFACT_REGISTRY_URL (derived at workflow-gen time)
#   - SUGARMAGIC_ALLOWED_ORIGINS (derived at workflow-gen time)
# When ANY are missing (local dev runs deploy.sh by hand), we fall
# back to terraform output -json for the missing pieces.
NEED_TF=0
[ -z "\${SUGARMAGIC_RUNTIME_SA_EMAIL:-}" ] && NEED_TF=1
[ -z "\${SUGARMAGIC_ARTIFACT_REGISTRY_URL:-}" ] && NEED_TF=1
[ -z "\${SUGARMAGIC_ALLOWED_ORIGINS:-}" ] && NEED_TF=1
TF_OUTPUTS=""
if [ "\${NEED_TF}" = "1" ]; then
  if ! command -v terraform >/dev/null 2>&1; then
    echo "[sugardeploy] terraform is required to resolve deploy-time values when SUGARMAGIC_RUNTIME_SA_EMAIL / SUGARMAGIC_ARTIFACT_REGISTRY_URL / SUGARMAGIC_ALLOWED_ORIGINS are not all preset; install terraform or pre-set those env vars." >&2
    exit 1
  fi
  TF_OUTPUTS="$(terraform -chdir="\${TERRAFORM_DIR}" output -json)"
fi
RUNTIME_SA_EMAIL="\${SUGARMAGIC_RUNTIME_SA_EMAIL:-$(echo "\${TF_OUTPUTS}" | jq -r '.runtime_sa_email.value')}"
ARTIFACT_REGISTRY_URL="\${SUGARMAGIC_ARTIFACT_REGISTRY_URL:-$(echo "\${TF_OUTPUTS}" | jq -r '.artifact_registry_url.value')}"
ALLOWED_ORIGINS="\${SUGARMAGIC_ALLOWED_ORIGINS:-$(echo "\${TF_OUTPUTS}" | jq -r '.allowed_origins.value | join(",")')}"

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

# Story 46.15 — non-secret runtime config env vars the gateway needs.
# Each entry reads its value from deploy.sh's own process env at run
# time (set by the GHA workflow or by the Studio host action that
# spawned this script). Keys whose env value is empty are SKIPPED to
# avoid setting EMPTY env on Cloud Run (which would shadow a future
# default the gateway might bake in).
RUNTIME_CONFIG_PAIRS=()
${runtimeConfigEnvLines}
RUNTIME_CONFIG_VARS=""
for pair in "\${RUNTIME_CONFIG_PAIRS[@]}"; do
  key="\${pair%%=*}"
  value="\${pair#*=}"
  if [ -n "\${value}" ]; then
    # gcloud --set-env-vars="^@^k1=v1@k2=v2" uses @ as the kvpair
    # delimiter (the ^@^ prefix sets it). Join entries with @ here
    # so the parser sees distinct env vars; joining with , would
    # collapse them into a single value (allowed-origins absorbs
    # everything that follows the first comma).
    if [ -z "\${RUNTIME_CONFIG_VARS}" ]; then
      RUNTIME_CONFIG_VARS="\${pair}"
    else
      RUNTIME_CONFIG_VARS="\${RUNTIME_CONFIG_VARS}@\${pair}"
    fi
  fi
done

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

  # Story 46.10 — local docker build + push instead of \`gcloud builds
  # submit\`. The submit path uploads source to Cloud Build's implicit
  # source bucket, which requires the caller (WIF principal on GHA) to
  # hold \`serviceusage.services.use\` on the project. Building locally
  # sidesteps the whole Cloud Build IAM surface: \`gcloud auth
  # configure-docker\` already wired docker's credential helper to the
  # active gcloud credentials, so \`docker push\` just works against
  # Artifact Registry. Faster too (no upload step).
  echo "[sugardeploy] building \${service_name} from \${service_dir}"
  if ! command -v docker >/dev/null 2>&1; then
    echo "[sugardeploy] docker is required to build the gateway image; install Docker (https://docs.docker.com/get-docker/) and retry." >&2
    exit 1
  fi
  docker build -t "\${image}" "\${service_dir}"

  echo "[sugardeploy] pushing \${service_name} to \${ARTIFACT_REGISTRY_URL}"
  docker push "\${image}"

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
    --set-env-vars="^@^SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS=\${ALLOWED_ORIGINS}\${RUNTIME_CONFIG_VARS:+@\${RUNTIME_CONFIG_VARS}}" \\
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
        `SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL=claude-sonnet-4-5`,
        `SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID=`
      ])
    ),
    asTextFile(
      "deployment/google-cloud-run/deploy.sh",
      formatCloudRunDeployScript(plan, overrides)
    ),
    asJsonFile("deployment/google-cloud-run/deployment-plan.json", {
      publishTargetId: plan.publishTargetId,
      backendDeploymentTargetId: plan.backendDeploymentTargetId,
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

  const effectiveGatewayAuthMode = deriveEffectiveGatewayAuthMode(
    overrides.gatewayAuthMode,
    gameProject
  );
  for (const unit of plan.serviceUnits) {
    const serviceDir = getServiceDirectory("google-cloud-run", unit);
    files.push(...buildGatewayScaffoldFiles("google-cloud-run", unit, overrides.containerPort, effectiveGatewayAuthMode));
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
      buildCloudRunTerraformTfvarsFile(
        plan,
        overrides,
        // Story 46.9 — derived origins flow tfvars → terraform output →
        // deploy.sh → Cloud Run env var → gateway server.mjs.
        deriveGatewayAllowedOrigins(plan, gameProject)
      )
    ),
    asTextFile(`${terraformDir}/.gitignore`, buildCloudRunTerraformGitignore())
  );

  return files;
}

const targetHandlers: Record<BackendDeploymentTargetId, DeploymentTargetHandler> = {
  local: {
    definition: {
      targetId: "local",
      displayName: "Local",
      summary: "Local same-origin deployment target with generated proxy and service scaffolding.",
      implemented: true,
      role: "backend"
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
      implemented: true,
      role: "backend"
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

// Story 46.6 — frontend deployment target registry, parallel to the
// backend `targetHandlers` above. Single concrete entry (Netlify) for
// now; the structure is the same so adding "cloudflare-pages", "s3",
// etc. is a one-line entry plus a generator module.
const frontendDeploymentTargetHandlers: Record<
  FrontendDeploymentTargetId,
  FrontendDeploymentTargetHandler
> = {
  netlify: {
    definition: {
      targetId: "netlify",
      displayName: "Netlify",
      summary:
        "Static-host the targets/web build on Netlify. CI deploys via the generated GHA workflow (story 46.7+).",
      implemented: true,
      role: "frontend"
    },
    normalizeOverrides: (gameProject) =>
      ({
        ...normalizeNetlifyDeploymentTargetOverrides(
          getDeploymentTargetOverrides(
            getDeploymentSettings(gameProject),
            "netlify"
          )
        )
      }),
    collectWarnings: (plan) => collectNetlifyWarnings(plan),
    buildManagedFiles: (plan, gameProject) =>
      buildNetlifyManagedFiles(plan, gameProject)
  }
};

export function listFrontendDeploymentTargets(): FrontendDeploymentTargetDefinition[] {
  return Object.values(frontendDeploymentTargetHandlers)
    .map((handler) => handler.definition)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export {
  buildNetlifyManagedFiles,
  FRONTEND_RENAME_LEDGER,
  NETLIFY_TEMPLATE_VERSION,
  normalizeNetlifyDeploymentTargetOverrides
};
export {
  isValidNetlifySiteId,
  type NetlifyDeploymentTargetOverrides,
  type NetlifyProductionContext
} from "./netlify";

// Story 46.7 — GitHub Actions workflow generator surface.
export {
  buildSugarDeployGithubWorkflowFile,
  getSugarDeployGithubWorkflowPath,
  parseWorkflowTemplateVersionStamp,
  planNeedsGithubWorkflow,
  SUGARDEPLOY_WORKFLOW_TEMPLATE_VERSION,
  WORKFLOW_RENAME_LEDGER
};

// Story 46.10 follow-up — published-web boot.json generator surface.
export {
  BOOT_JSON_SCHEMA_VERSION,
  buildPublishedWebManagedFiles,
  getPublishedWebDirectory,
  type PublishedWebRuntimeSnapshot
};

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
  backendDeploymentTargetId: BackendDeploymentTargetId | null
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
  if (serviceUnits.length === 0 && backendDeploymentTargetId !== null) {
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

export function planGameDeployment(
  gameProject: GameProject,
  // Story 46.10 follow-up — Studio passes the live in-memory
  // runtime snapshot (regions, content library, asset sources) so
  // boot.json bakes the real game data. Non-Studio callers (test
  // fixtures, the plugin's own UI-display call) omit it; the
  // published-web generator falls back to empty defaults.
  publishedWebSnapshot?: PublishedWebRuntimeSnapshot
): DeploymentPlan {
  const { sources, conflicts: sourceConflicts } = collectRequirementSources(gameProject);
  const deploymentSettings = getDeploymentSettings(gameProject);
  const targetId = deploymentSettings.backendDeploymentTargetId;
  const frontendTargetId = deploymentSettings.frontendDeploymentTargetId;
  const requirements = sources.flatMap((source) => source.requirements);
  const { serviceUnits, conflicts: serviceConflicts } = buildServiceUnits(
    requirements,
    targetId
  );

  // Story 45.5.8 / Story 47.9 — gateway auth secret injection. The
  // persisted GatewayAuthMode is "none" | "bearer"; with SugarProfile
  // enabled, "bearer" is upgraded to "supabase-jwt" — same gateway, but
  // the inline gate verifies a Supabase HS256 JWT instead of a shared
  // token. Each mode injects its own SecretRequirement onto the shared
  // request-response service units; "none" injects nothing.
  if (targetId === "google-cloud-run") {
    const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
      deploymentSettings.targetOverrides["google-cloud-run"],
      gameProject
    );
    const effectiveMode = deriveEffectiveGatewayAuthMode(
      cloudRunOverrides.gatewayAuthMode,
      gameProject
    );
    if (effectiveMode === "bearer") {
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
    // "supabase-jwt" mode injects no secret — the JWKS verifier
    // reads SugarProfile's existing supabase-url runtime env var
    // and fetches the public JWKS endpoint at request time.
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

  // Story 46.6 — resolve the frontend handler in parallel with the
  // backend one. Frontend target is OPTIONAL; missing it doesn't add a
  // conflict (lots of projects deploy only to a backend during
  // standup). When set, its buildManagedFiles runs alongside the
  // backend's and appends to managedFiles.
  const frontendHandler = frontendTargetId
    ? frontendDeploymentTargetHandlers[frontendTargetId]
    : null;
  if (frontendTargetId && !frontendHandler) {
    conflicts.push({
      conflictId: `unsupported-frontend-target:${frontendTargetId}`,
      severity: "error",
      kind: "unsupported-target",
      message: `Frontend deployment target ${frontendTargetId} is not supported by SugarDeploy.`,
      ownerIds: [],
      requirementIds: []
    });
  }
  const frontendTargetOverrides = frontendHandler
    ? frontendHandler.normalizeOverrides(gameProject)
    : {};
  if (frontendHandler && !frontendHandler.definition.implemented) {
    warnings.push(
      `${frontendHandler.definition.displayName} is planned but not fully implemented yet; SugarDeploy will generate stub deployment artifacts for review.`
    );
  }

  // Story 46.15 reshape — walk enabled plugins, validate each
  // gatewayRuntimeConfigKey, read the matching value from the
  // plugin's per-game config slot. Empty / missing values are
  // skipped so deploy.sh + workflow YAML carry only meaningful
  // entries.
  const gatewayRuntimeConfigEnv: Record<string, string> = {};
  for (const configuration of gameProject.pluginConfigurations) {
    if (!configuration.enabled) continue;
    const definition = getDiscoveredPluginDefinition(configuration.pluginId);
    const keys = definition?.gatewayRuntimeConfigKeys;
    if (!keys || keys.length === 0) continue;
    const config = (configuration.config ?? {}) as Record<string, unknown>;
    for (const key of keys) {
      const validation = validateGatewayRuntimeConfigKey(
        configuration.pluginId,
        key
      );
      if (!validation.ok) {
        conflicts.push({
          conflictId: `gateway-runtime-config:${configuration.pluginId}:${key.envVarName}`,
          severity: "error",
          kind: "unsupported-target",
          message: validation.reason ?? "Invalid gatewayRuntimeConfigKey.",
          ownerIds: [configuration.pluginId],
          requirementIds: []
        });
        continue;
      }
      const rawValue = config[key.configKey];
      if (typeof rawValue !== "string") continue;
      const trimmed = rawValue.trim();
      if (trimmed.length === 0) continue;
      gatewayRuntimeConfigEnv[key.envVarName] = trimmed;
    }
  }

  const provisionalPlan: DeploymentPlan = {
    publishTargetId: getPublishSettings(gameProject).publishTargetId,
    backendDeploymentTargetId: targetId,
    targetLabel: handler?.definition.displayName ?? null,
    targetOverrides,
    frontendDeploymentTargetId: frontendTargetId,
    frontendTargetLabel: frontendHandler?.definition.displayName ?? null,
    frontendTargetOverrides,
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
    managedFiles: [],
    gatewayRuntimeConfigEnv
  };

  if (handler?.collectWarnings) {
    provisionalPlan.warnings.push(...handler.collectWarnings(provisionalPlan));
  }
  if (frontendHandler?.collectWarnings) {
    provisionalPlan.warnings.push(
      ...frontendHandler.collectWarnings(provisionalPlan)
    );
  }
  provisionalPlan.status =
    provisionalPlan.conflicts.some((conflict) => conflict.severity === "error")
      ? "invalid"
      : provisionalPlan.conflicts.length > 0 || provisionalPlan.warnings.length > 0
        ? "warning"
        : "ready";

  const backendManagedFiles = handler
    ? handler.buildManagedFiles(provisionalPlan, gameProject)
    : [];
  const frontendManagedFiles = frontendHandler
    ? frontendHandler.buildManagedFiles(provisionalPlan, gameProject)
    : [];
  // Story 46.7 — when at least one hosted target is set (Cloud Run on
  // the backend or Netlify on the frontend), append the
  // `.github/workflows/sugardeploy-deploy.yml`. Local-only backends
  // don't need a workflow (docker-compose handles its own lifecycle).
  // Story 053.6 follow-up — derive the effective gateway auth mode
  // here too (the earlier compute inside the targetId loop is
  // scoped to the secret-injection block). Same pure function;
  // safe to call twice. The workflow YAML's deploy-frontend job
  // needs this to gate the bearer-token bake step.
  const workflowEffectiveGatewayAuthMode =
    targetId === "google-cloud-run"
      ? deriveEffectiveGatewayAuthMode(
          normalizeGoogleCloudRunDeploymentTargetOverrides(
            deploymentSettings.targetOverrides["google-cloud-run"],
            gameProject
          ).gatewayAuthMode,
          gameProject
        )
      : "none";

  const workflowFile = buildSugarDeployGithubWorkflowFile(
    provisionalPlan,
    gameProject,
    // Story 46.10 — same derived list the tfvars + terraform output
    // emit; the workflow injects it directly so deploy.sh can skip
    // terraform entirely on the GHA runner.
    deriveGatewayAllowedOrigins(provisionalPlan, gameProject),
    // Story 46.15 reshape — runtime config env was computed
    // earlier into the plan itself from enabled plugins'
    // gatewayRuntimeConfigKeys + their per-game config slots.
    provisionalPlan.gatewayRuntimeConfigEnv,
    workflowEffectiveGatewayAuthMode
  );
  // Story 46.10 follow-up — when Netlify (or any future frontend
  // target) is configured, regenerate the boot.json + published-web
  // README into the per-game artifact root. The frontend bundle
  // (target-web dist) lands in the same directory via a separate
  // host action (`/__sugardeploy/build-published-web`), not on save.
  const publishedWebFiles = frontendTargetId
    ? buildPublishedWebManagedFiles(gameProject, publishedWebSnapshot)
    : [];

  // Story 47.8 — SugarProfile's Supabase migration artifacts.
  // Empty when SugarProfile is disabled / missing config; emitted
  // into `deployment/supabase/` when enabled with a configured URL.
  const supabaseFiles = buildSupabaseManagedFiles(gameProject);
  return {
    ...provisionalPlan,
    managedFiles: [
      ...backendManagedFiles,
      ...frontendManagedFiles,
      ...publishedWebFiles,
      ...supabaseFiles,
      ...(workflowFile ? [workflowFile] : [])
    ]
  };
}
