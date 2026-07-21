import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const hasTerraform = (() => {
  try {
    execFileSync("terraform", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
import {
  applyCommand,
  createAuthoringSession,
  createDefaultDeploymentSettings,
  createDeploymentRequirementId,
  createPluginConfigurationRecord,
  normalizeDeploymentRequirements,
  validateDeploymentRequirements,
  normalizeGameProject,
  type GameProject
} from "@sugarmagic/domain";
import {
  collectPluginShellContributions,
  createRuntimePluginInstances,
  FIREFLIES_PLUGIN_ID,
  GCP_PROJECT_ID_REGEX,
  GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH,
  GCP_SERVICE_ACCOUNT_ID_REGEX,
  GITHUB_REPO_REGEX,
  HELLO_PLUGIN_ID,
  REQUIRED_GCP_APIS,
  buildGcpProjectName,
  classifyProjectListResult,
  buildAppendDeployHistoryCommand,
  buildSetVersionedProjectIdentifierCommand,
  buildUpdateDeployHistoryEntryCommand,
  buildUpdatePublishSettingsCommand,
  getDeployHistory,
  type DeployHistoryEntry,
  collectSecretEnvBindings,
  computeNextMinorTag,
  computeNextPatchTag,
  createDefaultPublishTargetSettings,
  groupVersionTags,
  parseVersionTag,
  getPublishSettings,
  getVersionedProjectIdentifiers,
  isValidGcpProjectId,
  isValidGcpServiceAccountId,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  parseBillingAccountList,
  parseTemplateVersionStamp,
  SUPABASE_JWT_VERIFIER_FUNCTION_NAME,
  SUPABASE_URL_ENV_VAR,
  type PluginSettingsSchemaField,
  resolveDeploymentAction,
  resolveSecretManagerName,
  stripBillingAccountPrefix,
  stripGithubRepoPrefixes,
  SUGARAGENT_PLUGIN_ID,
  SUGARDEPLOY_PLUGIN_ID,
  SUGARLANG_PLUGIN_ID,
  SUGARPROFILE_PLUGIN_ID,
  getDiscoveredPluginDefinition,
  listDiscoveredPluginDefinitions,
  listDeploymentTargets,
  listFrontendDeploymentTargets,
  parseWorkflowTemplateVersionStamp,
  normalizeHelloPluginConfig,
  normalizeSugarAgentPluginConfig,
  listBundledRuntimePluginIds,
  planGameDeployment,
  validateGatewayRuntimeConfigKey,
  validatePluginSettingsSchema
} from "@sugarmagic/plugins";
// Relative import on purpose: supabase-jwt.ts imports node:crypto at top
// level, so it is kept off @sugarmagic/plugins' browser-consumed entry.
import { verifySupabaseJwt } from "../../plugins/src/deployment/gateway/supabase-jwt";
import {
  createRuntimeBootModel,
  createRuntimePluginManager,
  type ConversationMiddleware,
  type ConversationProvider
} from "@sugarmagic/runtime-core";

function makeProject(): GameProject {
  return normalizeGameProject({
    identity: { id: "project", schema: "GameProject", version: 1 },
    displayName: "Project",
    gameRootPath: ".",
    deployment: createDefaultDeploymentSettings(),
    regionRegistry: [],
    pluginConfigurations: [],
    contentLibraryId: "project:content-library",
    playerDefinition: {
      definitionId: "player",
      displayName: "Player",
      physicalProfile: { height: 1.8, radius: 0.35, eyeHeight: 1.62 },
      movementProfile: { walkSpeed: 4.5, runSpeed: 6.5, acceleration: 10 },
      presentation: {
        modelAssetDefinitionId: null,
        animationAssetBindings: { idle: null, walk: null, run: null }
      },
      casterProfile: {
        initialBattery: 100,
        rechargeRate: 1,
        initialResonance: 0,
        allowedSpellTags: [],
        blockedSpellTags: []
      }
    },
    spellDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: [],
    npcDefinitions: [],
    dialogueDefinitions: [],
    questDefinitions: []
  });
}

describe("plugin infrastructure", () => {
  it("normalizes project-owned plugin configurations as canonical truth", () => {
    const normalized = normalizeGameProject({
      ...makeProject(),
      pluginConfigurations: [
        { pluginId: "sugarlang", enabled: true },
        { pluginId: "sugarlang", enabled: false },
        { pluginId: "sugaragent", enabled: true }
      ]
    });

    expect(normalized.pluginConfigurations).toHaveLength(2);
    expect(normalized.pluginConfigurations.map((entry) => entry.pluginId)).toEqual([
      "sugaragent",
      "sugarlang"
    ]);
    expect(normalized.pluginConfigurations.every((entry) => entry.identity.schema === "PluginConfiguration")).toBe(true);
  });

  it("builds ordered runtime plugin contributions from enabled installed plugins only", async () => {
    const boot = createRuntimeBootModel({
      hostKind: "published-web",
      compileProfile: "runtime-preview",
      contentSource: "published-artifact"
    });
    const configurations = [
      createPluginConfigurationRecord("alpha", true),
      createPluginConfigurationRecord("beta", true),
      createPluginConfigurationRecord("gamma", false)
    ];
    const alphaProvider: ConversationProvider = {
      providerId: "alpha",
      displayName: "Alpha Provider",
      priority: 100,
      canHandle: () => true,
      startSession: () => ({
        session: { advance: () => null },
        initialTurn: null
      })
    };
    const betaProvider: ConversationProvider = {
      providerId: "beta",
      displayName: "Beta Provider",
      priority: 60,
      canHandle: () => true,
      startSession: () => ({
        session: { advance: () => null },
        initialTurn: null
      })
    };
    const betaMiddleware: ConversationMiddleware = {
      middlewareId: "beta",
      displayName: "Beta Middleware",
      priority: 50,
      stage: "policy"
    };
    const instances = createRuntimePluginInstances(
      boot,
      configurations,
      (pluginId) => {
        if (pluginId === "alpha") {
          return {
            displayName: "Alpha",
            runtime: {
              runtimeContributions: [
                {
                  pluginId,
                  contributionId: "alpha.provider",
                  kind: "conversation.provider",
                  displayName: "Alpha Provider",
                  priority: 100,
                  payload: {
                    providerId: "alpha",
                    summary: "alpha",
                    status: "ready",
                    provider: alphaProvider
                  }
                }
              ]
            }
          };
        }
        if (pluginId === "beta") {
          return {
            displayName: "Beta",
            runtime: {
              runtimeContributions: [
                {
                  pluginId,
                  contributionId: "beta.middleware",
                  kind: "conversation.middleware",
                  displayName: "Beta Middleware",
                  priority: 50,
                  payload: {
                    middlewareId: "beta",
                    summary: "beta",
                    stage: "policy",
                    status: "ready",
                    middleware: betaMiddleware
                  }
                },
                {
                  pluginId,
                  contributionId: "beta.provider",
                  kind: "conversation.provider",
                  displayName: "Beta Provider",
                  priority: 60,
                  payload: {
                    providerId: "beta",
                    summary: "beta",
                    status: "ready",
                    provider: betaProvider
                  }
                }
              ]
            }
          };
        }
        return null;
      }
    );
    const manager = createRuntimePluginManager({ boot, plugins: instances });

    await manager.init();

    expect(manager.getEnabledPluginIds()).toEqual(["alpha", "beta"]);
    expect(manager.getContributions("conversation.middleware").map((entry) => entry.pluginId)).toEqual([
      "beta"
    ]);
    expect(manager.getContributions("conversation.provider").map((entry) => entry.pluginId)).toEqual([
      "beta",
      "alpha"
    ]);
  });

  it("resolves shell contribution models from installed plugin definitions only", () => {
    const contributions = collectPluginShellContributions(
      [
        createPluginConfigurationRecord(HELLO_PLUGIN_ID, true),
        createPluginConfigurationRecord("missing-plugin", true)
      ],
      (pluginId) => getDiscoveredPluginDefinition(pluginId)?.shell ?? null
    );

    expect(contributions.designWorkspaces.map((entry) => entry.workspaceKind)).toEqual([
      HELLO_PLUGIN_ID
    ]);
    expect(contributions.projectSettings).toEqual([]);
    expect(contributions.designSections).toEqual([]);
  });

  it("registers SugarDeploy's three publish workspaces in cadence order", () => {
    // Story 46.5 — SugarDeploy contributes Provision / Release /
    // Deploy in the Publish productmode (no Design workspace
    // anymore). The shell aggregator sorts publishWorkspaces by
    // `order` so the sub-nav always shows them in this cadence
    // order regardless of plugin-discovery order.
    const contributions = collectPluginShellContributions(
      [createPluginConfigurationRecord(SUGARDEPLOY_PLUGIN_ID, true)],
      (pluginId) => getDiscoveredPluginDefinition(pluginId)?.shell ?? null
    );

    expect(contributions.designWorkspaces).toEqual([]);
    expect(
      contributions.publishWorkspaces.map((entry) => ({
        workspaceKind: entry.workspaceKind,
        label: entry.label,
        order: entry.order
      }))
    ).toEqual([
      {
        workspaceKind: "sugardeploy-provision",
        label: "Provision",
        order: 100
      },
      {
        workspaceKind: "sugardeploy-release",
        label: "Release",
        order: 110
      },
      {
        workspaceKind: "sugardeploy-deploy",
        label: "Deploy",
        order: 120
      }
    ]);
  });

  it("lists only actually installed plugins in the app registry", () => {
    expect(listDiscoveredPluginDefinitions().map((plugin) => plugin.manifest.pluginId)).toEqual([
      FIREFLIES_PLUGIN_ID,
      HELLO_PLUGIN_ID,
      SUGARAGENT_PLUGIN_ID,
      SUGARDEPLOY_PLUGIN_ID,
      SUGARLANG_PLUGIN_ID,
      SUGARPROFILE_PLUGIN_ID
    ]);
  });

  it("SugarDeploy plugin definition exposes a hostMiddleware contribution", async () => {
    // 45.4.6: Studio's vite.config.ts mounts plugin host middleware
    // generically via the registry. SugarDeploy's plugin definition must
    // expose `hostMiddleware.createMiddleware()` returning at least one
    // Vite plugin with a configureServer hook. The factory is async
    // because the middleware module uses node-only APIs and must be
    // loaded via dynamic import to keep it out of the browser bundle —
    // see the comment on PluginHostMiddlewareDefinition in the SDK.
    const definition = getDiscoveredPluginDefinition(SUGARDEPLOY_PLUGIN_ID);
    expect(definition).not.toBeNull();
    expect(definition?.hostMiddleware).toBeDefined();
    expect(typeof definition?.hostMiddleware?.createMiddleware).toBe("function");
    const contributedPlugins = await definition!.hostMiddleware!.createMiddleware();
    expect(Array.isArray(contributedPlugins)).toBe(true);
    expect(contributedPlugins.length).toBeGreaterThan(0);
    for (const plugin of contributedPlugins) {
      expect(typeof plugin.name).toBe("string");
      expect(typeof plugin.configureServer).toBe("function");
    }
    // SugarDeploy contributes the following middleware plugins:
    // - action dispatcher (/__sugardeploy/action)
    // - billing list (/__sugardeploy/list-billing-accounts)
    // - GCP project lifecycle (/__sugardeploy/probe-gcp-project + /create-gcp-project)
    // - set-secret-value (/__sugardeploy/set-secret-value, story 45.5)
    // - secret-status (/__sugardeploy/secret-status, story 45.5)
    // - template-version (/__sugardeploy/template-version, story 45.7)
    // - setup-github-workflow (/__sugardeploy/setup-github-workflow, story 46.8)
    // - preflight-deploy-workflow (/__sugardeploy/preflight-deploy-workflow, story 46.10)
    // - dispatch-deploy-workflow (/__sugardeploy/dispatch-deploy-workflow, story 46.10)
    // - get-deploy-workflow-status (/__sugardeploy/get-deploy-workflow-status, story 46.10)
    // - rerun-failed-jobs (/__sugardeploy/rerun-failed-jobs, story 46.10)
    // - cut-major-version prepare/tag/untag/commit (/__sugardeploy/{prepare,tag,untag}-..., story 45.8)
    expect(contributedPlugins.map((plugin) => plugin.name).sort()).toEqual([
      "sugardeploy-cut-major-version-commit",
      "sugardeploy-cut-major-version-prepare",
      "sugardeploy-cut-major-version-tag",
      "sugardeploy-cut-major-version-untag",
      "sugardeploy-dispatch-deploy-workflow",
      // Auto-bootstrap the current major's base tag (v{N}.0.0)
      // on Release-workspace mount so new projects + projects
      // that never went through cut-major don't dead-end the
      // Tag Patch flow.
      "sugardeploy-ensure-current-major-tag",
      "sugardeploy-gcp-billing-list",
      "sugardeploy-gcp-project-lifecycle",
      "sugardeploy-get-deploy-workflow-status",
      "sugardeploy-host-actions",
      "sugardeploy-list-version-tags",
      "sugardeploy-preflight-deploy-workflow",
      "sugardeploy-rerun-failed-jobs",
      "sugardeploy-secret-status",
      "sugardeploy-set-secret-value",
      "sugardeploy-setup-github-workflow",
      "sugardeploy-tag-patch-version",
      "sugardeploy-template-version"
    ]);
  });

  it("plugins contributing host middleware in the current registry", () => {
    // 45.4.6 exit signal: SugarLang, SugarAgent, Fireflies, Hello don't
    // shell out to host binaries and shouldn't grow a hostMiddleware
    // contribution accidentally. SugarDeploy (gcloud / terraform / gh /
    // git) and SugarProfile (supabase CLI + probe) are the two that
    // legitimately need one. Future plugins update this test along
    // with their definition.
    const idsWithHostMiddleware = listDiscoveredPluginDefinitions()
      .filter((definition) => definition.hostMiddleware != null)
      .map((definition) => definition.manifest.pluginId)
      .sort();
    expect(idsWithHostMiddleware).toEqual(
      [SUGARDEPLOY_PLUGIN_ID, SUGARPROFILE_PLUGIN_ID].sort()
    );
  });

  it("lists SugarDeploy deployment targets with local as the implemented baseline", () => {
    // Story 46.6 — added `role: "backend"` to disambiguate from
    // frontend-axis targets (see listFrontendDeploymentTargets below).
    expect(listDeploymentTargets()).toEqual([
      {
        targetId: "google-cloud-run",
        displayName: "Google Cloud Run",
        summary: "Hosted deployment target for Cloud Run services and managed proxy topology.",
        implemented: true,
        role: "backend"
      },
      {
        targetId: "local",
        displayName: "Local",
        summary:
          "Local same-origin deployment target with generated proxy and service scaffolding.",
        implemented: true,
        role: "backend"
      }
    ]);
  });

  it("lists frontend deployment targets with Netlify implemented (story 46.6)", () => {
    expect(listFrontendDeploymentTargets()).toEqual([
      {
        targetId: "netlify",
        displayName: "Netlify",
        summary:
          "Static-host the targets/web build on Netlify. CI deploys via the generated GHA workflow (story 46.7+).",
        implemented: true,
        role: "frontend"
      }
    ]);
  });

  it("normalizes deployment requirements as a vendor-neutral shared contract", () => {
    const requirements = normalizeDeploymentRequirements([
      {
        requirementId: createDeploymentRequirementId({
          ownerId: "sugaragent",
          kind: "secret",
          key: "anthropic-api-key"
        }),
        ownerId: "sugaragent",
        ownerKind: "plugin",
        kind: "secret",
        required: true,
        secretKey: " anthropic-api-key ",
        consumption: "server-only",
        exposure: "private",
        mappingHint: " prod/ai-service/anthropic-key ",
        tags: [" llm ", "server", "llm"]
      }
    ]);

    expect(requirements).toEqual([
      {
        requirementId: "sugaragent:secret:anthropic-api-key",
        ownerId: "sugaragent",
        ownerKind: "plugin",
        kind: "secret",
        required: true,
        secretKey: "anthropic-api-key",
        consumption: "server-only",
        exposure: "private",
        mappingHint: "prod/ai-service/anthropic-key",
        tags: ["llm", "server"]
      }
    ]);
  });

  it("supports build-time public configuration keys without treating them as server-only secrets", () => {
    const requirements = normalizeDeploymentRequirements([
      {
        requirementId: createDeploymentRequirementId({
          ownerId: "web-publish",
          kind: "secret",
          key: "firebase-public-config"
        }),
        ownerId: "web-publish",
        ownerKind: "publish-target",
        kind: "secret",
        required: true,
        secretKey: "firebase-public-config",
        consumption: "build-time",
        exposure: "public",
        mappingHint: "VITE_FIREBASE_API_KEY"
      }
    ]);

    expect(requirements).toEqual([
      {
        requirementId: "web-publish:secret:firebase-public-config",
        ownerId: "web-publish",
        ownerKind: "publish-target",
        kind: "secret",
        required: true,
        secretKey: "firebase-public-config",
        consumption: "build-time",
        exposure: "public",
        mappingHint: "VITE_FIREBASE_API_KEY"
      }
    ]);
  });

  it("can report multiple deployment requirement validation errors without failing on the first one", () => {
    const result = validateDeploymentRequirements([
      {
        kind: "secret",
        ownerKind: "plugin",
        required: true
      },
      {
        kind: "runtime-service",
        requirementId: "broken:runtime-service:game-api",
        ownerKind: "plugin",
        required: true,
        serviceId: "game-api"
      }
    ]);

    expect(result.success).toBe(false);
    expect(result.normalized).toEqual([]);
    expect(result.errors.map((error) => [error.index, error.field])).toEqual([
      [0, "requirementId"],
      [0, "ownerId"],
      [0, "secretKey"],
      [0, "consumption"],
      [0, "exposure"],
      [1, "ownerId"],
      [1, "executionModel"],
      [1, "isolation"]
    ]);
  });

  it("lets SugarAgent declare deployment requirements without depending on deployment implementation types", () => {
    const plugin = getDiscoveredPluginDefinition(SUGARAGENT_PLUGIN_ID);

    expect(plugin?.deploymentRequirements?.map((requirement) => requirement.kind)).toEqual([
      "secret",
      "secret",
      "runtime-service",
      "proxy-route",
      "proxy-route",
      "proxy-route"
    ]);
    // Story 46.15 reshape — non-secret runtime config moved off
    // DeploymentRequirement onto the dedicated
    // `gatewayRuntimeConfigKeys` field (validated separately).
    expect(plugin?.gatewayRuntimeConfigKeys).toBeDefined();
    expect(
      plugin?.deploymentRequirements?.every(
        (requirement) => requirement.ownerId === SUGARAGENT_PLUGIN_ID
      )
    ).toBe(true);
    expect(
      plugin?.deploymentRequirements
        ?.filter((requirement) => requirement.kind === "secret")
        .map((requirement) => requirement.mappingHint)
    ).toEqual([
      "SUGARMAGIC_ANTHROPIC_API_KEY",
      "SUGARMAGIC_OPENAI_API_KEY"
    ]);
    expect(
      plugin?.deploymentRequirements?.find(
        (requirement) => requirement.kind === "runtime-service"
      )
    ).toMatchObject({
      resourceProfile: {
        tier: "medium",
        memoryInMb: 512,
        cpuUnits: 256
      }
    });
  });

  it("normalizes runtime service resource profiles for deployment planning", () => {
    const requirements = normalizeDeploymentRequirements([
      {
        requirementId: createDeploymentRequirementId({
          ownerId: "vector-plugin",
          kind: "runtime-service",
          key: "vector-worker"
        }),
        ownerId: "vector-plugin",
        ownerKind: "plugin",
        kind: "runtime-service",
        required: true,
        serviceId: " vector-worker ",
        executionModel: "worker",
        isolation: "isolated-required",
        resourceProfile: {
          tier: "high",
          memoryInMb: 4096.8,
          cpuUnits: 1024.2
        }
      }
    ]);

    expect(requirements).toEqual([
      {
        requirementId: "vector-plugin:runtime-service:vector-worker",
        ownerId: "vector-plugin",
        ownerKind: "plugin",
        kind: "runtime-service",
        required: true,
        serviceId: "vector-worker",
        executionModel: "worker",
        isolation: "isolated-required",
        resourceProfile: {
          tier: "high",
          memoryInMb: 4096,
          cpuUnits: 1024
        }
      }
    ]);
  });

  it("emits Netlify managed files when the frontend deployment target is selected (story 46.6)", () => {
    // No frontend target selected → no netlify/ files appear.
    const withoutFrontend = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local"
        }
      })
    );
    expect(
      withoutFrontend.managedFiles.some((file) =>
        file.relativePath.startsWith("deployment/netlify/")
      )
    ).toBe(false);

    // Frontend target = "netlify" → three managed files with the
    // expected stamps + content shape.
    const withFrontend = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          frontendDeploymentTargetId: "netlify",
          targetOverrides: {
            netlify: {
              siteId: "abc12345-6789-4def-9012-3456789abcde",
              siteName: "project-v1",
              productionContext: "production"
            }
          }
        }
      })
    );

    const netlifyFiles = withFrontend.managedFiles.filter((file) =>
      file.relativePath.startsWith("deployment/netlify/")
    );
    expect(netlifyFiles.map((file) => file.relativePath).sort()).toEqual([
      "deployment/netlify/README.md",
      "deployment/netlify/build-config.json",
      "deployment/netlify/netlify.toml"
    ]);

    const toml = netlifyFiles.find(
      (file) => file.relativePath === "deployment/netlify/netlify.toml"
    );
    expect(toml?.content).toContain("# GENERATED BY SUGARMAGIC - DO NOT EDIT");
    expect(toml?.content).toContain("# SUGARMAGIC FRONTEND TEMPLATE VERSION: 1");
    expect(toml?.content).toContain(
      'command = "pnpm --filter @sugarmagic/target-web build"'
    );
    expect(toml?.content).toContain('publish = "targets/web/dist"');
    expect(toml?.content).toContain('from = "/*"');
    expect(toml?.content).toContain('to = "/index.html"');

    const buildConfig = netlifyFiles.find(
      (file) => file.relativePath === "deployment/netlify/build-config.json"
    );
    expect(buildConfig?.contentType).toBe("json");
    const parsedConfig = JSON.parse(buildConfig?.content ?? "{}");
    expect(parsedConfig).toMatchObject({
      generator: "sugarmagic",
      templateVersion: 1,
      publishTargetId: "web",
      frontendDeploymentTargetId: "netlify",
      backendDeploymentTargetId: "local",
      gameProjectSlug: "project",
      majorVersion: 1,
      build: {
        command: "pnpm --filter @sugarmagic/target-web build",
        publishDir: "targets/web/dist"
      },
      site: {
        siteId: "abc12345-6789-4def-9012-3456789abcde",
        siteName: "project-v1",
        productionContext: "production"
      }
    });

    const readme = netlifyFiles.find(
      (file) => file.relativePath === "deployment/netlify/README.md"
    );
    expect(readme?.content).toContain("# GENERATED BY SUGARMAGIC - DO NOT EDIT");
    expect(readme?.content).toContain(
      "# SUGARMAGIC FRONTEND TEMPLATE VERSION: 1"
    );
    expect(readme?.content).toContain("Netlify deployment for project");
    expect(readme?.content).toContain("`project-v1`");

    // Plan-level fields reflect the frontend axis.
    expect(withFrontend.frontendDeploymentTargetId).toBe("netlify");
    expect(withFrontend.frontendTargetLabel).toBe("Netlify");
    expect(withFrontend.frontendTargetOverrides).toMatchObject({
      siteId: "abc12345-6789-4def-9012-3456789abcde",
      siteName: "project-v1",
      productionContext: "production"
    });
  });

  it("generates .github/workflows/sugardeploy-deploy.yml when at least one hosted target is configured (story 46.7)", () => {
    // Local-only backend → no workflow file (docker-compose handles
    // its own lifecycle locally).
    const localOnly = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local"
        }
      })
    );
    expect(
      localOnly.managedFiles.some(
        (file) =>
          file.relativePath === ".github/workflows/sugardeploy-deploy.yml"
      )
    ).toBe(false);

    // Backend Cloud Run + Netlify frontend → both jobs present, both
    // stamps + headers correct.
    const fullPlan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          frontendDeploymentTargetId: "netlify",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "wordlark-v1-abcd",
              region: "us-central1",
              serviceNamePrefix: "wordlark-v1-abcd",
              gatewayAuthMode: "bearer",
              githubRepo: "nikki/wordlark"
            },
            netlify: {
              siteId: "abc12345-6789-4def-9012-3456789abcde",
              siteName: "wordlark-prod"
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    const workflowFile = fullPlan.managedFiles.find(
      (file) =>
        file.relativePath === ".github/workflows/sugardeploy-deploy.yml"
    );
    expect(workflowFile).toBeDefined();
    expect(workflowFile?.contentType).toBe("text");
    const yaml = workflowFile?.content ?? "";

    // Header + stamp.
    expect(yaml.startsWith("# GENERATED BY SUGARMAGIC - DO NOT EDIT")).toBe(true);
    // 46.7 v1 → 46.10 v2 (env-var injection) → 46.10 v3 (dropped
    // auth@v2 service_account:) → 46.10 v4 (thin checkout-and-
    // netlify-deploy off the pre-baked .sugarmagic/published-web/)
    // → 46.15 v5 (non-secret runtime config env injection)
    // → 053.2 v6 (deploy-frontend rebuilds target-web on the runner
    // off a sugarmagic checkout; pre-baked dist/ no longer required)
    // → 053.6 follow-up v7 (deploy-frontend resolves the Cloud Run
    // gateway URL and bakes VITE_SUGARMAGIC_* envs on the build
    // step; restores the env injection lost when 053.2 moved the
    // build off Studio's Build Frontend action).
    expect(yaml).toContain("# SUGARMAGIC WORKFLOW TEMPLATE VERSION: 9");
    expect(parseWorkflowTemplateVersionStamp(yaml)).toBe(9);
    // Template v9 — the game-repo checkout fetches full history
    // (so `git describe` in the next step sees tags) and exports
    // SUGARMAGIC_GAME_VERSION into the engine build env.
    expect(yaml).toContain("      - name: Resolve game version");
    expect(yaml).toContain(
      "          GAME_VERSION=$(git describe --tags --always --dirty)"
    );
    expect(yaml).toContain(
      "          SUGARMAGIC_GAME_VERSION: ${{ steps.game-version.outputs.version }}"
    );

    // Workflow name pulls in the project slug + major version.
    expect(yaml).toContain("name: SugarDeploy — project v1");

    // Both triggers wired up.
    expect(yaml).toContain("on:");
    expect(yaml).toContain("  push:");
    expect(yaml).toContain("    tags:");
    expect(yaml).toContain("      - 'v*'");
    expect(yaml).toContain("  workflow_dispatch:");
    expect(yaml).toContain("      ref:");

    // Backend job: WIF auth + deploy.sh invocation with overrides.
    expect(yaml).toContain("  deploy-backend:");
    expect(yaml).toContain("google-github-actions/auth@v2");
    expect(yaml).toContain(
      "workload_identity_provider: ${{ vars.SUGARMAGIC_WIF_PROVIDER }}"
    );
    // Story 46.10 v3 — auth@v2 no longer impersonates the runtime
    // SA. Runtime SA still gets attached to the Cloud Run service,
    // but via `gcloud run deploy --service-account=...` in
    // deploy.sh (env-injected as SUGARMAGIC_RUNTIME_SA_EMAIL below).
    expect(yaml).not.toContain(
      "service_account: ${{ vars.SUGARMAGIC_RUNTIME_SA_EMAIL }}"
    );
    expect(yaml).toContain(
      "SUGARMAGIC_RUNTIME_SA_EMAIL: ${{ vars.SUGARMAGIC_RUNTIME_SA_EMAIL }}"
    );
    expect(yaml).toContain(
      "gcloud auth configure-docker us-central1-docker.pkg.dev --quiet"
    );
    expect(yaml).toContain("SUGARMAGIC_GCP_PROJECT_ID: wordlark-v1-abcd");
    expect(yaml).toContain("SUGARMAGIC_GCP_REGION: us-central1");
    expect(yaml).toContain("SUGARMAGIC_SERVICE_NAME_PREFIX: wordlark-v1-abcd");
    expect(yaml).toContain("run: bash deploy.sh");

    // Frontend job: needs backend (so backend failure aborts
    // frontend). Story 053.2 — deploy-frontend now rebuilds
    // target-web at deploy time off a sugarmagic checkout instead
    // of consuming a pre-baked dist. Verifies: dual checkout,
    // pnpm/node setup, install, build, dist stage, boot.json
    // overlay, netlify deploy.
    expect(yaml).toContain("  deploy-frontend:");
    expect(yaml).toContain("    needs: deploy-backend");
    // 053.6 follow-up — gateway URL resolution IS back inside the
    // deploy-frontend job (without it the bundle ships with an
    // empty plugin runtime env and crashes). But the old
    // `--project=foo --region=bar` argument format (= signs) is
    // not how the rewritten step writes it; assert the old shape
    // does not regress.
    expect(yaml).not.toContain(
      "gcloud run services describe wordlark-v1-abcd-sugarmagic-gateway --project=wordlark-v1-abcd --region=us-central1"
    );
    // Dual checkout — game repo + sugarmagic engine into
    // ./sugarmagic/ subdirectory. Default ref is `main`; operator
    // can override via the workflow_dispatch input.
    expect(yaml).toContain("      - name: Checkout sugarmagic engine");
    expect(yaml).toContain("          repository: nikkileaps/sugarmagic");
    expect(yaml).toContain(
      "          ref: ${{ github.event.inputs.sugarmagic_ref || 'main' }}"
    );
    expect(yaml).toContain("          path: sugarmagic");
    // Template v8 — fetch full history + tags so `git describe`
    // inside the build resolves to the actual tag name (e.g.
    // `v0.1.0`) instead of just a short sha.
    expect(yaml).toContain("          fetch-depth: 0");
    // Workflow_dispatch input for engine ref pin.
    expect(yaml).toContain("      sugarmagic_ref:");
    // pnpm + node setup with sugarmagic lockfile cache.
    expect(yaml).toContain("        uses: pnpm/action-setup@v4");
    expect(yaml).toContain("          package_json_file: sugarmagic/package.json");
    expect(yaml).toContain("        uses: actions/setup-node@v4");
    expect(yaml).toContain("          node-version: '20'");
    expect(yaml).toContain("          cache: pnpm");
    expect(yaml).toContain(
      "          cache-dependency-path: sugarmagic/pnpm-lock.yaml"
    );
    // Install + build inside the engine checkout.
    expect(yaml).toContain("        working-directory: sugarmagic");
    expect(yaml).toContain("        run: pnpm install --frozen-lockfile");
    expect(yaml).toContain(
      "        run: pnpm --filter @sugarmagic/target-web build"
    );
    // 053.6 follow-up — gateway URL resolution + VITE_SUGARMAGIC_*
    // env injection on the build step. This restores what Build
    // Frontend used to do; without it the deployed bundle ships
    // with an empty plugin runtime env and crashes on first
    // gateway-touching action.
    expect(yaml).toContain("      - name: Authenticate to GCP via WIF");
    expect(yaml).toContain("      - name: Resolve Cloud Run gateway URL");
    expect(yaml).toContain(
      "          URL=$(gcloud run services describe wordlark-v1-abcd-sugarmagic-gateway --project wordlark-v1-abcd --region us-central1 --format 'value(status.url)')"
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_GATEWAY_URL: ${{ steps.gateway.outputs.url }}"
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: ${{ steps.gateway.outputs.url }}"
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_SUGARLANG_PROXY_BASE_URL: ${{ steps.gateway.outputs.url }}"
    );
    expect(yaml).toContain(
      `          VITE_SUGARMAGIC_GAME_MAJOR_VERSION: "1"`
    );
    expect(yaml).toContain(
      `          VITE_SUGARMAGIC_VERSIONED_SLUG: "wordlark-v1-abcd"`
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_GIT_SHA: ${{ github.sha }}"
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_BUILD_TIMESTAMP: ${{ github.run_started_at }}"
    );
    expect(yaml).toContain("          NODE_ENV: production");
    // This test fixture sets gatewayAuthMode: "bearer" without
    // SugarProfile (no upgrade to supabase-jwt), so effective mode
    // is bearer — the gateway-shared-token bake step should appear
    // and the bearer token should be baked into the bundle.
    expect(yaml).toContain("      - name: Resolve gateway bearer token");
    expect(yaml).toContain(
      "          TOKEN=$(gcloud secrets versions access latest --secret wordlark-v1-abcd-gateway-shared-token --project wordlark-v1-abcd)"
    );
    expect(yaml).toContain(
      "          VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN: ${{ steps.bearer.outputs.token }}"
    );
    // Stage the freshly built dist into the game repo's expected
    // location, then overlay boot.json.
    expect(yaml).toContain("          rm -rf .sugarmagic/published-web/dist");
    expect(yaml).toContain("          mkdir -p .sugarmagic/published-web/dist");
    expect(yaml).toContain(
      "          cp -R sugarmagic/targets/web/dist/. .sugarmagic/published-web/dist/"
    );
    expect(yaml).toContain(
      "          cp .sugarmagic/published-web/boot.json .sugarmagic/published-web/dist/boot.json"
    );
    // Netlify deploy off the staged directory.
    expect(yaml).toContain("NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}");
    expect(yaml).toContain(
      "NETLIFY_SITE_ID: abc12345-6789-4def-9012-3456789abcde"
    );
    expect(yaml).toContain(
      'npx -y netlify-cli@17 deploy --site="$NETLIFY_SITE_ID" --dir=.sugarmagic/published-web/dist'
    );
    expect(yaml).toContain("--prod");
    // 053.2 — the pre-baked dist verification step (which used to
    // error out when `.sugarmagic/published-web/dist` was missing)
    // is gone, since the dist now regenerates inside the runner.
    // boot.json verification stays.
    expect(yaml).not.toContain(
      "click Build Frontend in Provision and commit before re-dispatching"
    );
    expect(yaml).toContain("      - name: Verify boot.json exists");
  });

  it("omits backend job when only the Netlify frontend target is configured (story 46.7)", () => {
    const frontendOnly = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          frontendDeploymentTargetId: "netlify",
          targetOverrides: {
            netlify: {
              siteId: "abc12345-6789-4def-9012-3456789abcde"
            }
          }
        }
      })
    );
    const workflow = frontendOnly.managedFiles.find(
      (file) =>
        file.relativePath === ".github/workflows/sugardeploy-deploy.yml"
    );
    expect(workflow).toBeDefined();
    const yaml = workflow?.content ?? "";
    expect(yaml).not.toContain("deploy-backend:");
    expect(yaml).toContain("deploy-frontend:");
    // Story 053.2 — when the backend job is absent there's no
    // `needs:` gate. The frontend job still rebuilds target-web on
    // the runner (sugarmagic checkout + pnpm install + build) and
    // hands the staged dist to netlify-cli.
    expect(yaml).not.toContain(
      "SUGARMAGIC_GATEWAY_URL: ${{ vars.SUGARMAGIC_GATEWAY_URL }}"
    );
    expect(yaml).not.toContain("needs: deploy-backend");
    expect(yaml).toContain("          repository: nikkileaps/sugarmagic");
    expect(yaml).toContain(
      "        run: pnpm --filter @sugarmagic/target-web build"
    );
    expect(yaml).toContain(
      'npx -y netlify-cli@17 deploy --site="$NETLIFY_SITE_ID" --dir=.sugarmagic/published-web/dist'
    );
  });

  it("threads allowed_origins through terraform tfvars + gateway env var when Netlify is configured (story 46.9)", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          frontendDeploymentTargetId: "netlify",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "wordlark-v1-abcd",
              region: "us-central1",
              serviceNamePrefix: "wordlark-v1-abcd",
              githubRepo: "nikki/wordlark"
            },
            netlify: {
              siteId: "abc12345-6789-4def-9012-3456789abcde",
              siteName: "wordlark-prod"
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARDEPLOY_PLUGIN_ID, true, {
            publishSettings: {
              publishTargetId: "web",
              liveDomain: "wordlark.com"
            }
          })
        ]
      })
    );

    const tfvars = plan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/terraform.tfvars"
    );
    expect(tfvars?.content).toContain("allowed_origins       = [");
    expect(tfvars?.content).toContain('"https://*--wordlark-prod.netlify.app"');
    expect(tfvars?.content).toContain('"https://wordlark-prod.netlify.app"');
    expect(tfvars?.content).toContain('"https://wordlark.com"');

    const variablesTf = plan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/variables.tf"
    );
    expect(variablesTf?.content).toContain('variable "allowed_origins"');

    const outputsTf = plan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/outputs.tf"
    );
    expect(outputsTf?.content).toContain('output "allowed_origins"');
    expect(outputsTf?.content).toContain("var.allowed_origins");

    const deployScript = plan.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    // Story 46.10 — deploy.sh resolves ALLOWED_ORIGINS env-first
    // (workflow injects it) and falls back to terraform output when
    // running locally with no env var preset.
    expect(deployScript?.content).toContain(
      "ALLOWED_ORIGINS=\"${SUGARMAGIC_ALLOWED_ORIGINS:-$(echo \"${TF_OUTPUTS}\" | jq -r '.allowed_origins.value | join(\",\")')}\""
    );
    // Story 46.9 — gcloud's default `--set-env-vars` separator is a
    // comma, which clashes with the comma-joined origin list. The
    // `^@^` prefix tells gcloud to use `@` as the kvpair separator
    // instead so the embedded commas survive intact.
    // Story 46.15 — runtime-config keys are appended after origins
    // via ${RUNTIME_CONFIG_VARS:+,${RUNTIME_CONFIG_VARS}} so empty
    // runtime config collapses cleanly to just the origins.
    expect(deployScript?.content).toContain(
      "--set-env-vars=\"^@^SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}${RUNTIME_CONFIG_VARS:+@${RUNTIME_CONFIG_VARS}}\""
    );

    const gateway = plan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs"
    );
    expect(gateway?.content).toContain("SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS");
    expect(gateway?.content).toContain("function resolveAllowedOrigin(origin)");
    expect(gateway?.content).toContain('vary: "origin"');
    expect(gateway?.content).toContain("access-control-allow-credentials");
    expect(gateway?.content).toContain('"access-control-max-age": "86400"');
    expect(gateway?.content).toContain(
      'req.headers["access-control-request-headers"]'
    );
  });

  it("appends deploy-history entries newest-first and de-dupes by runId (story 46.10)", () => {
    const session = createAuthoringSession(makeProject(), []);
    const firstEntry: DeployHistoryEntry = {
      runId: 1001,
      runUrl: "https://github.com/nikkileaps/wordlark/actions/runs/1001",
      ref: "main",
      headSha: "abcd123",
      dispatchedAt: "2026-06-23T20:00:00.000Z",
      status: "queued",
      conclusion: null
    };
    const secondEntry: DeployHistoryEntry = {
      runId: 1002,
      runUrl: "https://github.com/nikkileaps/wordlark/actions/runs/1002",
      ref: "main",
      headSha: "ef01234",
      dispatchedAt: "2026-06-23T20:15:00.000Z",
      status: "queued",
      conclusion: null
    };

    const afterFirst = applyCommand(
      session,
      buildAppendDeployHistoryCommand(session.gameProject, firstEntry)
    );
    expect(
      getDeployHistory(afterFirst.gameProject).map((entry) => entry.runId)
    ).toEqual([1001]);

    const afterSecond = applyCommand(
      afterFirst,
      buildAppendDeployHistoryCommand(afterFirst.gameProject, secondEntry)
    );
    expect(
      getDeployHistory(afterSecond.gameProject).map((entry) => entry.runId)
    ).toEqual([1002, 1001]);

    // Idempotent on runId — re-appending the same runId replaces in
    // place (and floats to the top), it doesn't duplicate.
    const afterRefresh = applyCommand(
      afterSecond,
      buildAppendDeployHistoryCommand(afterSecond.gameProject, {
        ...firstEntry,
        status: "in_progress"
      })
    );
    const refreshed = getDeployHistory(afterRefresh.gameProject);
    expect(refreshed.map((entry) => entry.runId)).toEqual([1001, 1002]);
    expect(refreshed[0].status).toBe("in_progress");
  });

  it("buildUpdateDeployHistoryEntryCommand patches status/conclusion and returns null when runId is unknown (story 46.10)", () => {
    const session = createAuthoringSession(makeProject(), []);
    const entry: DeployHistoryEntry = {
      runId: 2001,
      runUrl: "https://github.com/nikkileaps/wordlark/actions/runs/2001",
      ref: "main",
      headSha: "abcd123",
      dispatchedAt: "2026-06-23T20:00:00.000Z",
      status: "queued",
      conclusion: null
    };
    const seeded = applyCommand(
      session,
      buildAppendDeployHistoryCommand(session.gameProject, entry)
    );

    const patch = buildUpdateDeployHistoryEntryCommand(seeded.gameProject, 2001, {
      status: "completed",
      conclusion: "success",
      netlifyDeployUrl: "https://abcd1234--wordlark-prod.netlify.app",
      cloudRunRevisionUrl:
        "https://wordlark-v1-abcd-sugarmagic-gateway-123.us-central1.run.app"
    });
    expect(patch).not.toBeNull();
    const after = applyCommand(seeded, patch!);
    const [row] = getDeployHistory(after.gameProject);
    expect(row.status).toBe("completed");
    expect(row.conclusion).toBe("success");
    expect(row.netlifyDeployUrl).toBe(
      "https://abcd1234--wordlark-prod.netlify.app"
    );

    // Unknown runId -> null command so callers can short-circuit.
    const missing = buildUpdateDeployHistoryEntryCommand(
      after.gameProject,
      9999,
      {
        status: "completed"
      }
    );
    expect(missing).toBeNull();
  });

  it("emits .sugarmagic/published-web/ files when a frontend target is configured (story 46.10 follow-up)", () => {
    // No frontend target → no published-web artifacts emitted.
    const noFrontend = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local"
        }
      })
    );
    expect(
      noFrontend.managedFiles.some((file) =>
        file.relativePath.startsWith(".sugarmagic/published-web/")
      )
    ).toBe(false);

    // Frontend target = "netlify" → boot.json + README appear.
    const withFrontend = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          frontendDeploymentTargetId: "netlify",
          targetOverrides: {
            netlify: {
              siteId: "abc12345-6789-4def-9012-3456789abcde"
            }
          }
        }
      })
    );

    const boot = withFrontend.managedFiles.find(
      (file) => file.relativePath === ".sugarmagic/published-web/boot.json"
    );
    expect(boot).toBeDefined();
    expect(boot?.contentType).toBe("json");
    const parsed = JSON.parse(boot?.content ?? "{}");
    expect(parsed).toMatchObject({
      note: "GENERATED BY SUGARMAGIC - DO NOT EDIT",
      schemaVersion: 1,
      gameProjectIdentity: expect.objectContaining({ id: "project" }),
      gameProjectMajorVersion: 1
    });
    // The pre-46.10-follow-up runtime payload fields are present even
    // when empty so target-web can boot to a clear "no content" state
    // instead of throwing on missing slots.
    expect(parsed.regions).toEqual([]);
    expect(parsed.installedPluginIds).toEqual([]);

    const readme = withFrontend.managedFiles.find(
      (file) => file.relativePath === ".sugarmagic/published-web/README.md"
    );
    expect(readme?.content).toContain("Published-web bundle root");
    // 053.4 — the README's `dist/` section was rewritten when
    // Build Frontend retired. dist regenerates inside the GHA
    // deploy-frontend job now.
    expect(readme?.content).toContain("Generated at deploy time (gitignored)");
    expect(readme?.content).not.toContain("Generated by the Build Frontend button");
  });

  it("omits allowed_origins entries when no frontend target is configured (story 46.9)", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "wordlark-v1-abcd",
              region: "us-central1"
            }
          }
        }
      })
    );
    const tfvars = plan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/terraform.tfvars"
    );
    expect(tfvars?.content).toContain("allowed_origins       = []");
  });

  it("validateGatewayRuntimeConfigKey refuses envVarNames that pattern-match a secret (story 46.15)", () => {
    // Defense-in-depth: even with the "safe-to-expose-publicly"
    // attestation, env var names ending in _API_KEY / _TOKEN /
    // _SECRET / _PASSWORD / _PRIVATE_KEY get hard-rejected at
    // validation time so a plugin can't accidentally route a
    // real secret into Cloud Run env via this contract.
    const result = validateGatewayRuntimeConfigKey("badplugin", {
      configKey: "myKey",
      envVarName: "SUGARMAGIC_BADPLUGIN_OPENAI_API_KEY",
      description: "Plugin author thinks this is safe; we disagree.",
      nonSecretAttestation: "safe-to-expose-publicly"
    });
    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/_API_KEY/);
  });

  it("validateGatewayRuntimeConfigKey accepts a valid SUGARMAGIC_<PLUGIN>_<KEY> envVarName (story 46.15)", () => {
    const result = validateGatewayRuntimeConfigKey("sugaragent", {
      configKey: "openAiVectorStoreId",
      envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
      description: "OpenAI vector store id — pure config identifier.",
      nonSecretAttestation: "safe-to-expose-publicly"
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("validateGatewayRuntimeConfigKey rejects envVarNames missing the SUGARMAGIC_<PLUGIN>_ prefix (story 46.15)", () => {
    const result = validateGatewayRuntimeConfigKey("sugaragent", {
      configKey: "vectorStoreId",
      envVarName: "OPENAI_VECTOR_STORE_ID",
      description: "Wrong prefix.",
      nonSecretAttestation: "safe-to-expose-publicly"
    });
    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/SUGARMAGIC_SUGARAGENT_/);
  });

  it("threads per-game plugin config values through deploy.sh + workflow YAML as gateway env (story 46.15)", () => {
    // End-to-end: setting openAiVectorStoreId on the SugarAgent
    // config slot for a game project -> planGameDeployment picks
    // it up from the slot, validates SugarAgent's
    // gatewayRuntimeConfigKeys declaration, populates
    // plan.gatewayRuntimeConfigEnv -> deploy.sh's --set-env-vars
    // carries it AND the GHA workflow's deploy-backend env block
    // carries it.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "wordlark-v1-abcd",
              region: "us-central1",
              serviceNamePrefix: "wordlark-v1-abcd",
              githubRepo: "nikki/wordlark"
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true, {
            openAiVectorStoreId: "vs_test_123",
            anthropicModel: "claude-opus-4-7"
          })
        ]
      })
    );

    expect(plan.gatewayRuntimeConfigEnv).toEqual({
      SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID: "vs_test_123",
      SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL: "claude-opus-4-7"
    });

    const deployScript = plan.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript?.content).toContain(
      'RUNTIME_CONFIG_PAIRS+=("SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL='
    );
    expect(deployScript?.content).toContain(
      'RUNTIME_CONFIG_PAIRS+=("SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID='
    );
    const workflow = plan.managedFiles.find(
      (file) =>
        file.relativePath === ".github/workflows/sugardeploy-deploy.yml"
    );
    expect(workflow?.content).toContain(
      'SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID: "vs_test_123"'
    );
    expect(workflow?.content).toContain(
      'SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL: "claude-opus-4-7"'
    );
  });

  it("validateGatewayRuntimeConfigKey rejects entries without the nonSecretAttestation (story 46.15)", () => {
    const result = validateGatewayRuntimeConfigKey("lazyplugin", {
      configKey: "foo",
      envVarName: "SUGARMAGIC_LAZYPLUGIN_FOO",
      description: "Missing attestation."
    } as never);
    expect(result.ok).toBe(false);
    expect(result.reason ?? "").toMatch(/nonSecretAttestation/);
  });

  it("parseWorkflowTemplateVersionStamp returns null for unstamped or hand-edited content (story 46.7)", () => {
    expect(parseWorkflowTemplateVersionStamp(null)).toBeNull();
    expect(parseWorkflowTemplateVersionStamp("")).toBeNull();
    expect(
      parseWorkflowTemplateVersionStamp(
        "# Some random workflow file with no stamp\nname: foo\n"
      )
    ).toBeNull();
    expect(
      parseWorkflowTemplateVersionStamp(
        "# SUGARMAGIC WORKFLOW TEMPLATE VERSION: 1\nname: foo\n"
      )
    ).toBe(1);
    expect(
      parseWorkflowTemplateVersionStamp(
        "# something on line 1\n# SUGARMAGIC WORKFLOW TEMPLATE VERSION: 7\n"
      )
    ).toBe(7);
  });

  it("warns when a Netlify frontend target is selected without a siteId (story 46.6)", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          frontendDeploymentTargetId: "netlify"
        }
      })
    );
    expect(
      plan.warnings.some((warning) => warning.includes("siteId"))
    ).toBe(true);
  });

  it("plans local deployment outputs for enabled plugin requirements when a target is selected", () => {
    const withoutTarget = planGameDeployment(makeProject());
    expect(withoutTarget.managedFiles).toEqual([]);
    expect(withoutTarget.status).toBe("warning");

    const withTarget = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local"
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    expect(withTarget.managedFiles.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "deployment/local/README.md",
        "deployment/local/.env.example",
        "deployment/local/.sugarmagic-empty-lore/.gitkeep",
        "deployment/local/docker-compose.yml",
        "deployment/local/deployment-plan.json",
        "deployment/local/services/sugarmagic-gateway/package.json",
        "deployment/local/services/sugarmagic-gateway/routes.json",
        "deployment/local/services/sugarmagic-gateway/server.mjs",
        "deployment/local/services/sugarmagic-gateway/Dockerfile"
      ])
    );
    expect(withTarget.serviceUnits.length).toBeGreaterThan(0);
    expect(
      withTarget.managedFiles.find(
        (file) => file.relativePath === "deployment/local/services/sugarmagic-gateway/server.mjs"
      )?.content
    ).toContain('handleSugarAgentGenerate');
    expect(
      withTarget.managedFiles.find(
        (file) => file.relativePath === "deployment/local/services/sugarmagic-gateway/server.mjs"
      )?.content
    ).toContain("handleSugarAgentSearch");
    expect(
      withTarget.managedFiles.find(
        (file) => file.relativePath === "deployment/local/services/sugarmagic-gateway/server.mjs"
      )?.content
    ).toContain("handleSugarAgentLoreIngest");
    expect(
      withTarget.managedFiles.find(
        (file) => file.relativePath === "deployment/local/.env.example"
      )?.content
    ).toContain("SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL=claude-sonnet-4-5");
    expect(
      withTarget.managedFiles.find(
        (file) => file.relativePath === "deployment/local/docker-compose.yml"
      )?.content
    ).toContain("SUGARMAGIC_LORE_SOURCE_LOCAL_PATH");
  });

  it("plans google cloud run deployment outputs with normalized target overrides", () => {
    const withTarget = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "demo-project",
              region: "us-west1",
              serviceNamePrefix: "wordlark-api",
              minInstances: 1,
              maxInstances: 3,
              ingress: "internal"
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    expect(withTarget.targetOverrides).toMatchObject({
      workingDirectory: "",
      projectId: "demo-project",
      region: "us-west1",
      serviceNamePrefix: "wordlark-api",
      minInstances: 1,
      maxInstances: 3,
      ingress: "internal"
    });
    expect(withTarget.managedFiles.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "deployment/google-cloud-run/README.md",
        "deployment/google-cloud-run/.env.example",
        "deployment/google-cloud-run/deploy.sh",
        "deployment/google-cloud-run/deployment-plan.json",
        "deployment/google-cloud-run/services/sugarmagic-gateway/package.json",
        "deployment/google-cloud-run/services/sugarmagic-gateway/routes.json",
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs",
        "deployment/google-cloud-run/services/sugarmagic-gateway/Dockerfile",
        "deployment/google-cloud-run/services/sugarmagic-gateway/service.yaml"
      ])
    );
  });

  it("derives version-namespaced Cloud Run defaults from the game's majorVersion", () => {
    // 45.1 exit criterion: wordlark with majorVersion: 1 and no overrides resolves
    // to projectId/serviceNamePrefix `wordlark-v1`, producing service name
    // `wordlark-v1-gateway`. Bumping majorVersion to 2 slots the deployment into
    // `wordlark-v2` automatically without touching any override.
    const wordlarkV1 = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    expect(wordlarkV1.targetOverrides).toMatchObject({
      projectId: "wordlark-v1",
      serviceNamePrefix: "wordlark-v1"
    });
    // The full Cloud Run service name is `${serviceNamePrefix}-${serviceUnitId}`.
    // The gateway service unit is `sugarmagic-gateway` in the default plan, so the
    // final name on Cloud Run is `wordlark-v1-sugarmagic-gateway`. What matters
    // for 45.1 is the `-v1-` namespace baked into the name.
    const v1ServiceYaml = wordlarkV1.managedFiles.find((file) =>
      file.relativePath.endsWith("/service.yaml")
    );
    expect(v1ServiceYaml?.content).toContain("name: wordlark-v1-sugarmagic-gateway");
    const v1DeployScript = wordlarkV1.managedFiles.find((file) =>
      file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(v1DeployScript?.content).toContain("wordlark-v1-sugarmagic-gateway");
    expect(v1DeployScript?.content).toContain("PROJECT_ID=\"${SUGARMAGIC_GCP_PROJECT_ID:-wordlark-v1}\"");

    const wordlarkV2 = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 2,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkV2.targetOverrides).toMatchObject({
      projectId: "wordlark-v2",
      serviceNamePrefix: "wordlark-v2"
    });

    // Override still wins — wordlark-v1's existing GCP project can be reused.
    const wordlarkWithLegacyProject = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": { projectId: "wordlark" }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkWithLegacyProject.targetOverrides).toMatchObject({
      projectId: "wordlark"
    });
  });

  it("includes versionedProjectIdentifiers suffix in Cloud Run id derivation when present", () => {
    // 45.4.7 — per-major-version random suffix that collision-resists GCP's
    // globally-unique project id constraint. When the game project has a
    // recorded suffix for the current major version, it's appended to both
    // projectId and serviceNamePrefix.
    const wordlarkWithSuffix = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkWithSuffix.targetOverrides).toMatchObject({
      projectId: "wordlark-v1-k3m9p",
      serviceNamePrefix: "wordlark-v1-k3m9p"
    });
    // Service name resolution flows through the same prefix, so the gateway
    // service ends up as `wordlark-v1-k3m9p-sugarmagic-gateway` on Cloud Run.
    const v1ServiceYaml = wordlarkWithSuffix.managedFiles.find((file) =>
      file.relativePath.endsWith("/service.yaml")
    );
    expect(v1ServiceYaml?.content).toContain(
      "name: wordlark-v1-k3m9p-sugarmagic-gateway"
    );

    // Historical map keys the lookup by major. A v2 project carries v1's old
    // suffix in the map (preserved forever for worktree round-trip) but
    // resolves to its OWN v2 suffix in the current derivation.
    const wordlarkV2 = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 2,
        versionedProjectIdentifiers: { v1: "k3m9p", v2: "wt7qz" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkV2.targetOverrides).toMatchObject({
      projectId: "wordlark-v2-wt7qz",
      serviceNamePrefix: "wordlark-v2-wt7qz"
    });

    // Empty map / missing entry for the current major falls back to the
    // pre-45.4.7 `${slug}-v${major}` form so older project files keep
    // resolving to the GCP project they always did until they're opened
    // in the SugarDeploy view (which then generates and persists a suffix).
    const wordlarkNoSuffix = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: {},
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkNoSuffix.targetOverrides).toMatchObject({
      projectId: "wordlark-v1",
      serviceNamePrefix: "wordlark-v1"
    });

    // Explicit Project Id override wins over the suffix path entirely.
    const wordlarkOverride = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": { projectId: "wordlark-manual" }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(wordlarkOverride.targetOverrides).toMatchObject({
      projectId: "wordlark-manual"
    });
  });

  it("normalizeGameProject migrates legacy top-level versionedProjectIdentifiers into the SugarDeploy plugin-config slot, filtering corrupt entries", () => {
    // 45.4.7 + 45.7.5 — older project files persisted the field at the
    // top level. The 45.7.5 migration lifts that legacy data into the
    // SugarDeploy plugin's pluginConfigurations[].config slot and drops
    // the top-level field entirely. Older files with no entries at all
    // still load cleanly — getVersionedProjectIdentifiers() returns {}.
    const projectMissingField = normalizeGameProject({
      ...makeProject(),
      versionedProjectIdentifiers: undefined
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(getVersionedProjectIdentifiers(projectMissingField)).toEqual({});

    // Corrupt entries (bad keys, non-string values, wrong-length suffixes)
    // get filtered out silently during migration — load shouldn't fail on
    // bad persisted data, but the bad entries don't make it into the
    // canonical model either.
    const projectWithJunk = normalizeGameProject({
      ...makeProject(),
      versionedProjectIdentifiers: {
        v1: "k3m9p", // valid
        v2: "TOOLONG", // wrong length
        v3: 42, // wrong type
        "not-a-version-key": "abcde", // bad key shape
        v4: "AbCdE", // uppercase not allowed
        v5: "12345" // valid (digits only)
      }
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(getVersionedProjectIdentifiers(projectWithJunk)).toEqual({
      v1: "k3m9p",
      v5: "12345"
    });
  });

  it("Story 46.2 — getPublishSettings lifts legacy publishTargetId from settings into publishSettings slot and round-trips the new shape", () => {
    // Legacy: pre-046 projects had `publishTargetId: "web"` living
    // on `DeploymentSettings`. 45.7.5 lifted that whole settings
    // shape into `pluginConfigurations[sugardeploy].config.settings`.
    // 46.2 splits `publishTargetId` out into the new
    // `config.publishSettings` slot at read time. The VALUE stays
    // "web" (publication medium); future stories add the orthogonal
    // frontend-deployment-target axis (Netlify, Vercel, etc.) on
    // DeploymentSettings, NOT here.
    const legacyProject = normalizeGameProject({
      ...makeProject(),
      // Cast through the legacy shape — `publishTargetId` is no longer
      // declared on `DeploymentSettings`, but old project files carry
      // it in this exact place.
      deployment: {
        publishTargetId: "web",
        backendDeploymentTargetId: "local"
      }
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(getPublishSettings(legacyProject)).toEqual({
      publishTargetId: "web",
      liveDomain: ""
    });

    // Round-trip the new shape: a project with publishSettings already
    // in the plugin slot reads back identically.
    const freshSettings = createDefaultPublishTargetSettings();
    const newShapeProject = normalizeGameProject({
      ...makeProject(),
      pluginConfigurations: [
        createPluginConfigurationRecord(SUGARDEPLOY_PLUGIN_ID, true, {
          publishSettings: { ...freshSettings, liveDomain: "play.example.com" }
        })
      ]
    });
    expect(getPublishSettings(newShapeProject)).toEqual({
      publishTargetId: "web",
      liveDomain: "play.example.com"
    });

    // Empty plugin slot returns the default shape (used by every fresh
    // project that hasn't opened SugarDeploy yet).
    const blankProject = normalizeGameProject(makeProject());
    expect(getPublishSettings(blankProject)).toEqual({
      publishTargetId: "web",
      liveDomain: ""
    });

    // buildUpdatePublishSettingsCommand emits the right kind / target /
    // payload shape for the command bus.
    const command = buildUpdatePublishSettingsCommand(blankProject, {
      ...freshSettings,
      liveDomain: "play.wordlarkhollow.com"
    });
    expect(command.kind).toBe("UpdatePluginConfiguration");
    expect(command.payload.configuration.pluginId).toBe(SUGARDEPLOY_PLUGIN_ID);
    expect(
      (command.payload.configuration.config as Record<string, unknown>)
        .publishSettings
    ).toMatchObject({ liveDomain: "play.wordlarkhollow.com" });
  });

  it("BumpMajorVersion command bumps majorVersion and is idempotent on no-change / invalid input", () => {
    // Story 45.8 — the cut saga dispatches BumpMajorVersion as the
    // in-memory bump step. Pure game-authoring concern: just sets
    // gameProject.majorVersion. Validation is belt-and-suspenders;
    // invalid values silently no-op rather than corrupting state.
    const session = createAuthoringSession(
      normalizeGameProject({
        ...makeProject(),
        majorVersion: 1
      }),
      []
    );
    const bumped = applyCommand(session, {
      kind: "BumpMajorVersion",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "game-project",
        subjectId: session.gameProject.identity.id
      },
      payload: { newMajorVersion: 2 }
    });
    expect(bumped.gameProject.majorVersion).toBe(2);
    expect(bumped.isDirty).toBe(true);
    // Idempotent: a second bump to the same value returns the session
    // unchanged (same reference would be a nicer guarantee but the
    // applier returns a fresh-ish object; the value is what matters).
    const noOpBump = applyCommand(bumped, {
      kind: "BumpMajorVersion",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "game-project",
        subjectId: session.gameProject.identity.id
      },
      payload: { newMajorVersion: 2 }
    });
    expect(noOpBump).toBe(bumped);
    // Invalid inputs leave the session unchanged.
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = applyCommand(bumped, {
        kind: "BumpMajorVersion",
        target: {
          aggregateKind: "game-project",
          aggregateId: session.gameProject.identity.id
        },
        subject: {
          subjectKind: "game-project",
          subjectId: session.gameProject.identity.id
        },
        payload: { newMajorVersion: invalid }
      });
      expect(result.gameProject.majorVersion).toBe(2);
    }
  });

  it("buildSetVersionedProjectIdentifierCommand registers a fresh suffix and is a no-op when the entry exists", () => {
    // Story 45.8 — historical-suffix immutability rule (carried forward
    // from 45.4.7): once a major has a recorded suffix, the builder
    // returns null so the cut saga can skip the dispatch. This is what
    // makes worktrees / `git checkout v1.0.0` resolve back to the
    // original v1 GCP project rather than getting a freshly-rolled
    // suffix on every reopen.
    const project = normalizeGameProject({
      ...makeProject(),
      majorVersion: 1
    });
    const registerV2 = buildSetVersionedProjectIdentifierCommand(
      project,
      2,
      "k3m9p"
    );
    expect(registerV2).not.toBeNull();
    expect(registerV2?.kind).toBe("UpdatePluginConfiguration");
    // Apply the dispatch so the slot now carries v2 = "k3m9p".
    const session = createAuthoringSession(project, []);
    const sessionAfter = applyCommand(session, registerV2!);
    expect(getVersionedProjectIdentifiers(sessionAfter.gameProject)).toEqual({
      v2: "k3m9p"
    });
    // Second register for the SAME major is a no-op (returns null) —
    // the historical suffix is immutable.
    const registerAgain = buildSetVersionedProjectIdentifierCommand(
      sessionAfter.gameProject,
      2,
      "xxxxx"
    );
    expect(registerAgain).toBeNull();
    // Registering a DIFFERENT major still works.
    const registerV3 = buildSetVersionedProjectIdentifierCommand(
      sessionAfter.gameProject,
      3,
      "abcde"
    );
    expect(registerV3).not.toBeNull();
    const sessionWithV3 = applyCommand(sessionAfter, registerV3!);
    expect(getVersionedProjectIdentifiers(sessionWithV3.gameProject)).toEqual({
      v2: "k3m9p",
      v3: "abcde"
    });
  });

  it("Cut New Major Version bump regenerates publish-side managed files with the new major's identity (story 46.11)", () => {
    // The Cut saga's `saveProjectWithManagedFiles` step calls
    // planGameDeployment on the bumped session and writes every
    // managed file in the result. 46.6 / 46.7 / 46.10.5 made the
    // publish-side artifacts (deployment/netlify/*, the GHA workflow
    // YAML, .sugarmagic/published-web/boot.json) regular managed
    // files. This story is the test coverage: the bumped plan's
    // managedFiles list must include those, with the v2 identity
    // baked into the new copies.
    const project = normalizeGameProject({
      ...makeProject(),
      identity: { id: "wordlark", schema: "GameProject", version: 1 },
      displayName: "Wordlark",
      majorVersion: 1,
      versionedProjectIdentifiers: { v1: "k3m9p" },
      deployment: {
        backendDeploymentTargetId: "google-cloud-run",
        frontendDeploymentTargetId: "netlify",
        githubRepo: "nikki/wordlark",
        targetOverrides: {
          netlify: {
            siteId: "abc12345-6789-4def-9012-3456789abcde",
            siteName: "wordlark-prod"
          }
        }
      },
      pluginConfigurations: [
        createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
      ]
    });
    let session = createAuthoringSession(project, []);
    session = applyCommand(session, {
      kind: "BumpMajorVersion",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "game-project",
        subjectId: session.gameProject.identity.id
      },
      payload: { newMajorVersion: 2 }
    });
    const registerV2 = buildSetVersionedProjectIdentifierCommand(
      session.gameProject,
      2,
      "abcde"
    );
    expect(registerV2).not.toBeNull();
    session = applyCommand(session, registerV2!);

    const bumpedPlan = planGameDeployment(session.gameProject);
    const paths = bumpedPlan.managedFiles.map((file) => file.relativePath);

    // Terraform / Cloud Run files (Plan 045 / 046.6+ + 46.9 land).
    expect(paths).toEqual(
      expect.arrayContaining([
        "deployment/google-cloud-run/terraform/main.tf",
        "deployment/google-cloud-run/terraform/variables.tf",
        "deployment/google-cloud-run/terraform/outputs.tf",
        "deployment/google-cloud-run/terraform/terraform.tfvars",
        "deployment/google-cloud-run/deploy.sh"
      ])
    );

    // Netlify managed files (46.6) — frontend target side.
    expect(paths).toEqual(
      expect.arrayContaining([
        "deployment/netlify/netlify.toml",
        "deployment/netlify/build-config.json",
        "deployment/netlify/README.md"
      ])
    );

    // GHA workflow YAML (46.7).
    expect(paths).toContain(".github/workflows/sugardeploy-deploy.yml");

    // Published-web boot.json + README (46.10.5 follow-up).
    expect(paths).toEqual(
      expect.arrayContaining([
        ".sugarmagic/published-web/boot.json",
        ".sugarmagic/published-web/README.md"
      ])
    );

    // V2 identity must thread through the regenerated files.
    const tfvars = bumpedPlan.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/terraform.tfvars"
    );
    expect(tfvars?.content).toContain('gcp_project_id        = "wordlark-v2-abcde"');
    expect(tfvars?.content).toContain('service_name_prefix   = "wordlark-v2-abcde"');

    const buildConfig = bumpedPlan.managedFiles.find(
      (file) =>
        file.relativePath === "deployment/netlify/build-config.json"
    );
    const parsedBuildConfig = JSON.parse(buildConfig?.content ?? "{}");
    expect(parsedBuildConfig).toMatchObject({
      majorVersion: 2,
      backendDeploymentTargetId: "google-cloud-run",
      frontendDeploymentTargetId: "netlify"
    });

    const workflow = bumpedPlan.managedFiles.find(
      (file) =>
        file.relativePath === ".github/workflows/sugardeploy-deploy.yml"
    );
    expect(workflow?.content).toContain("name: SugarDeploy — wordlark v2");
    expect(workflow?.content).toContain(
      "SUGARMAGIC_GCP_PROJECT_ID: wordlark-v2-abcde"
    );
    expect(workflow?.content).toContain(
      "SUGARMAGIC_SERVICE_NAME_PREFIX: wordlark-v2-abcde"
    );
    // After 46.10.5 the frontend job is a thin checkout-and-
    // netlify-deploy off the pre-baked dist — no inline gateway URL
    // resolution in the workflow YAML — so the gateway service name
    // shows up only via the service-name-prefix env above.

    const bootJson = bumpedPlan.managedFiles.find(
      (file) =>
        file.relativePath === ".sugarmagic/published-web/boot.json"
    );
    const parsedBoot = JSON.parse(bootJson?.content ?? "{}");
    expect(parsedBoot).toMatchObject({
      schemaVersion: 1,
      gameProjectMajorVersion: 2,
      gameProjectIdentity: { id: "wordlark" }
    });
  });

  it("Cut New Major Version (in-memory): bumped session resolves new versionedSlug and preserves prior suffix", () => {
    // Story 45.8 — end-to-end in-memory: starting from wordlark at v1,
    // applying BumpMajorVersion + buildSetVersionedProjectIdentifierCommand
    // produces a session whose planGameDeployment resolves to the v2
    // project id while the v1 suffix is preserved (so a future worktree
    // at v1.0.0 still resolves back to wordlark-v1-${origSuffix}).
    const project = normalizeGameProject({
      ...makeProject(),
      identity: { id: "wordlark", schema: "GameProject", version: 1 },
      displayName: "Wordlark",
      majorVersion: 1,
      versionedProjectIdentifiers: { v1: "k3m9p" },
      deployment: {
        backendDeploymentTargetId: "google-cloud-run",
        targetOverrides: {}
      },
      pluginConfigurations: [
        createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
      ]
    });
    let session = createAuthoringSession(project, []);
    session = applyCommand(session, {
      kind: "BumpMajorVersion",
      target: {
        aggregateKind: "game-project",
        aggregateId: session.gameProject.identity.id
      },
      subject: {
        subjectKind: "game-project",
        subjectId: session.gameProject.identity.id
      },
      payload: { newMajorVersion: 2 }
    });
    const registerV2 = buildSetVersionedProjectIdentifierCommand(
      session.gameProject,
      2,
      "abcde"
    );
    expect(registerV2).not.toBeNull();
    session = applyCommand(session, registerV2!);

    expect(session.gameProject.majorVersion).toBe(2);
    expect(getVersionedProjectIdentifiers(session.gameProject)).toEqual({
      v1: "k3m9p",
      v2: "abcde"
    });
    const planV2 = planGameDeployment(session.gameProject);
    expect(planV2.targetOverrides).toMatchObject({
      projectId: "wordlark-v2-abcde",
      serviceNamePrefix: "wordlark-v2-abcde"
    });
  });

  it("emits plugin-owned Cloud Run terraform under deployment/google-cloud-run/terraform/", () => {
    // 45.2 exit: saving wordlark produces a populated terraform directory with
    // the GENERATED header and # SUGARMAGIC TEMPLATE VERSION: 1 stamp.
    const wordlark = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": { githubRepo: "nikki/wordlark" }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    const paths = wordlark.managedFiles.map((f) => f.relativePath);
    expect(paths).toEqual(
      expect.arrayContaining([
        "deployment/google-cloud-run/terraform/main.tf",
        "deployment/google-cloud-run/terraform/variables.tf",
        "deployment/google-cloud-run/terraform/outputs.tf",
        "deployment/google-cloud-run/terraform/terraform.tfvars",
        "deployment/google-cloud-run/terraform/.gitignore"
      ])
    );

    const mainTf = wordlark.managedFiles.find(
      (f) => f.relativePath === "deployment/google-cloud-run/terraform/main.tf"
    );
    expect(mainTf?.content).toContain("# GENERATED BY SUGARMAGIC - DO NOT EDIT");
    // 45.5.7 → v2; 46.9 → v3 (allowed_origins);
    // 46.10 → v4 (WIF → SA token-creator binding).
    expect(mainTf?.content).toContain("# SUGARMAGIC TEMPLATE VERSION: 4");
    // The 45.5.7 resources must be in the generated main.tf.
    // 45.5.7: the org-policy override is the load-bearing terraform piece.
    // The actual allUsers→run.invoker binding happens at the service level
    // via deploy.sh's --allow-unauthenticated flag (project-level allUsers
    // IAM is disallowed by GCP with PROJECT_SET_IAM_DISALLOWED_MEMBER_TYPE).
    expect(mainTf?.content).toContain("google_org_policy_policy");
    expect(mainTf?.content).toContain("iam.allowedPolicyMemberDomains");
    expect(mainTf?.content).toContain('allow_all = "TRUE"');
    // Make sure the broken project-level allUsers binding from the first
    // pass at 45.5.7 doesn't sneak back in.
    expect(mainTf?.content).not.toContain("all_users_run_invoker");
    expect(mainTf?.content).toContain('resource "google_artifact_registry_repository" "gateway"');
    expect(mainTf?.content).toContain('resource "google_service_account" "runtime"');
    expect(mainTf?.content).toContain('resource "google_iam_workload_identity_pool" "github"');
    expect(mainTf?.content).toContain('resource "google_iam_workload_identity_pool_provider" "github"');
    expect(mainTf?.content).toContain('resource "google_project_iam_member" "github_run_admin"');
    expect(mainTf?.content).toContain('resource "google_project_iam_member" "runtime_secret_accessor"');
    expect(mainTf?.content).toContain('resource "google_secret_manager_secret" "containers"');

    const tfvars = wordlark.managedFiles.find(
      (f) => f.relativePath === "deployment/google-cloud-run/terraform/terraform.tfvars"
    );
    expect(tfvars?.content).toContain('gcp_project_id        = "wordlark-v1"');
    expect(tfvars?.content).toContain('region                = "us-central1"');
    expect(tfvars?.content).toContain('service_name_prefix   = "wordlark-v1"');
    expect(tfvars?.content).toContain('runtime_sa_account_id = "wordlark-v1-runtime"');
    expect(tfvars?.content).toContain('github_repo           = "nikki/wordlark"');
    // SugarAgent declares anthropic-api-key + openai-api-key; both resolve through
    // resolveSecretManagerName with the wordlark-v1 prefix.
    expect(tfvars?.content).toContain('"wordlark-v1-anthropic-api-key"');
    expect(tfvars?.content).toContain('"wordlark-v1-openai-api-key"');

    const gitignore = wordlark.managedFiles.find(
      (f) => f.relativePath === "deployment/google-cloud-run/terraform/.gitignore"
    );
    expect(gitignore?.content).toContain(".terraform/");
    expect(gitignore?.content).toContain("terraform.tfstate");
  });

  it("resolveSecretManagerName enforces GCP-safe slugification rules", () => {
    expect(resolveSecretManagerName("wordlark-v1", "anthropic-api-key")).toBe(
      "wordlark-v1-anthropic-api-key"
    );
    // mixed-case + underscores get slugified
    expect(resolveSecretManagerName("wordlark-v1", "OPEN_AI_API_KEY")).toBe(
      "wordlark-v1-open-ai-api-key"
    );
    // digit-leading prefix gets s- prefix
    expect(resolveSecretManagerName("2025-game", "key")).toBe("s-2025-game-key");
    // empty prefix throws
    expect(() => resolveSecretManagerName("", "key")).toThrow(/serviceNamePrefix is empty/);
    // empty key throws
    expect(() => resolveSecretManagerName("wordlark-v1", "")).toThrow(/secretKey is empty/);
    // over 80 chars throws
    expect(() => resolveSecretManagerName("a".repeat(60), "b".repeat(30))).toThrow(/exceeds 80 characters/);
  });

  it("collectSecretEnvBindings dedupes by secretKey and derives env var names from mappingHint or secretKey", () => {
    // 45.5 — the deploy-script generator + Set Value modal both consume
    // this helper, so it's the single source of truth for the
    // env-var-name ↔ secret-manager-name mapping.
    const wordlark = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    const bindings = collectSecretEnvBindings(wordlark, "wordlark-v1-k3m9p");
    // SugarAgent declares anthropic-api-key with mappingHint
    // SUGARMAGIC_ANTHROPIC_API_KEY and openai-api-key with mappingHint
    // SUGARMAGIC_OPENAI_API_KEY. Sorted by secretKey.
    expect(bindings).toEqual([
      {
        secretKey: "anthropic-api-key",
        envVarName: "SUGARMAGIC_ANTHROPIC_API_KEY",
        secretManagerName: "wordlark-v1-k3m9p-anthropic-api-key"
      },
      {
        secretKey: "openai-api-key",
        envVarName: "SUGARMAGIC_OPENAI_API_KEY",
        secretManagerName: "wordlark-v1-k3m9p-openai-api-key"
      }
    ]);
  });

  it("formatCloudRunDeployScript emits 45.5-shape script with terraform-output reads + baked defaults + --set-secrets", () => {
    // 45.5 exit-signal test. Asserts the SHAPE of the generated deploy.sh:
    // terraform-output reads, --service-account flag, baked-in
    // cpu/memory/cpu-throttling/min/max, and `--set-secrets=KEY=NAME:latest`
    // for each declared secret. We assert presence of key fragments rather
    // than line-for-line equality so harmless formatting tweaks don't
    // break the test.
    const wordlark = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    const deployScript = wordlark.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript).toBeDefined();
    const content = deployScript!.content;

    // Terraform-output reads (single source of truth for resolved names).
    expect(content).toContain(`terraform -chdir="${"${TERRAFORM_DIR}"}" output -json`);
    expect(content).toContain("ARTIFACT_REGISTRY_URL=");
    expect(content).toContain(".artifact_registry_url.value");
    expect(content).toContain("RUNTIME_SA_EMAIL=");
    expect(content).toContain(".runtime_sa_email.value");

    // Right-sized Cloud Run defaults baked into gcloud run deploy.
    expect(content).toContain("--cpu=1");
    expect(content).toContain("--memory=512Mi");
    expect(content).toContain("--cpu-throttling");
    expect(content).toContain("--min-instances=1");
    expect(content).toContain("--max-instances=4");
    // The runtime SA flag wires the deployed service to the SA terraform
    // creates (and that holds secretAccessor on every container).
    expect(content).toContain("--service-account");

    // --set-secrets bindings: one per declared SecretRequirement, in the
    // KEY=NAME:latest shape gcloud expects. With SugarAgent enabled,
    // anthropic-api-key + openai-api-key must both bind.
    expect(content).toContain(
      "--set-secrets=SUGARMAGIC_ANTHROPIC_API_KEY=wordlark-v1-k3m9p-anthropic-api-key:latest"
    );
    expect(content).toContain(
      "--set-secrets=SUGARMAGIC_OPENAI_API_KEY=wordlark-v1-k3m9p-openai-api-key:latest"
    );

    // jq guard so the script fails fast if it's missing on the host
    // (better UX than a confusing parsing error).
    expect(content).toContain("command -v jq");

    // GENERATED header so resaves don't leave stale hand-edits.
    expect(content).toContain("GENERATED BY SUGARMAGIC");
  });

  it("formatCloudRunDeployScript omits --set-secrets when no plugin declares secrets", () => {
    // 45.5: when no plugin declares secrets, SECRET_ARGS is empty and the
    // gcloud run deploy invocation expands "${SECRET_ARGS[@]}" to nothing.
    // 45.5.5: there's still one service to deploy (the baseline gateway).
    const helloOnly = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(HELLO_PLUGIN_ID, true)
        ]
      })
    );
    const deployScript = helloOnly.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript).toBeDefined();
    const content = deployScript!.content;
    expect(content).not.toContain("--set-secrets=");
    expect(content).toContain('SECRET_ARGS=(\n\n)');
  });

  it("deploy.sh uses safe array iteration (no `set -u`) and keeps the empty-services guard for safety", () => {
    // bash 3.2 (macOS default) crashes on empty-array expansion under
    // `set -u`. The script intentionally uses `set -eo pipefail` (no -u)
    // with explicit null checks on the values that matter. The
    // empty-services guard stays in the script as defensive
    // programming even though 45.5.5's baseline gateway makes the
    // empty-services case unreachable for valid plans.
    const helloOnly = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(HELLO_PLUGIN_ID, true)
        ]
      })
    );
    const deployScript = helloOnly.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript).toBeDefined();
    const content = deployScript!.content;
    expect(content).toContain("set -eo pipefail");
    expect(content).not.toContain("set -euo pipefail");
    expect(content).toContain("${#services[@]} -eq 0");
    expect(content).toContain("No runtime service units declared");
  });

  it("planner injects a baseline sugarmagic-gateway when no plugin contributes a runtime-service", () => {
    // 45.5.5: every Cloud Run deployment always has a service to deploy,
    // even with zero plugins enabled. The baseline carries /healthz only
    // (the existing server.mjs template already exposes that route);
    // plugins like SugarAgent contribute proxy-routes that merge in via
    // the bucket logic. The baseline is the empty case — no other plugin
    // contributed a shared-allowed request-response runtime-service.
    const baselineOnly = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        // Just Hello (a sample plugin with no runtime-service requirement)
        // → no plugin-contributed gateway unit → baseline kicks in.
        pluginConfigurations: [
          createPluginConfigurationRecord(HELLO_PLUGIN_ID, true)
        ]
      })
    );
    expect(baselineOnly.serviceUnits).toHaveLength(1);
    expect(baselineOnly.serviceUnits[0]).toMatchObject({
      serviceUnitId: "sugarmagic-gateway",
      label: "Sugarmagic Gateway",
      ownerIds: ["sugardeploy"],
      proxyRoutes: [],
      secrets: []
    });

    // The generated deploy.sh has the baseline service in its services
    // array so Deploy can actually push something even with no plugin
    // contributing routes.
    const deployScript = baselineOnly.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript?.content).toContain(
      '"wordlark-v1-k3m9p-sugarmagic-gateway|services/sugarmagic-gateway"'
    );

    // The server.mjs scaffold exists, and the existing template puts
    // /health behind `path === "/" || path === "/health"` —
    // /healthz is reserved by Cloud Run's frontend (returns Google's
    // generic 404 before the request reaches the container), so the
    // gateway uses a path no Google frontend would shadow.
    const serverFile = baselineOnly.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs"
    );
    expect(serverFile).toBeDefined();
    expect(serverFile?.content).toContain('path === "/health"');
    expect(serverFile?.content).not.toContain('"/healthz"');
  });

  it("planner does NOT inject the baseline when a plugin already contributes a gateway service", () => {
    // 45.5.5 guard: the baseline is only the FALLBACK. When SugarAgent (or
    // any other plugin) declares a shared-allowed request-response
    // runtime-service requirement, the bucket logic creates the
    // sugarmagic-gateway unit and the baseline injection is skipped, so
    // we don't end up with two redundant service units.
    const withSugarAgent = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    expect(withSugarAgent.serviceUnits).toHaveLength(1);
    expect(withSugarAgent.serviceUnits[0].serviceUnitId).toBe(
      "sugarmagic-gateway"
    );
    // The unit is plugin-contributed (ownerIds includes the SugarAgent
    // plugin id), not the baseline fallback (ownerIds: ["sugardeploy"]).
    expect(withSugarAgent.serviceUnits[0].ownerIds).toContain(
      SUGARAGENT_PLUGIN_ID
    );
  });

  it("planner injects the gateway-shared-token secret + emits auth middleware when gatewayAuthMode=bearer", () => {
    // 45.5.8 — bearer auth mode adds:
    // (1) a gateway-shared-token SecretRequirement on the gateway service unit
    //     so terraform creates the container and deploy.sh --set-secrets binds it
    // (2) an authorizeBearer() middleware in the generated server.mjs that
    //     401s every non-/health request without a valid Bearer token.
    const wordlarkBearer = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": { gatewayAuthMode: "bearer" }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    // Gateway unit picks up the new secret alongside SugarAgent's secrets.
    const gatewayUnit = wordlarkBearer.serviceUnits.find(
      (unit) => unit.serviceUnitId === "sugarmagic-gateway"
    );
    expect(gatewayUnit).toBeDefined();
    const secretKeys = gatewayUnit!.secrets.map((s) => s.secretKey).sort();
    expect(secretKeys).toContain("gateway-shared-token");

    // The shared-token secret has the correct shape so it flows through
    // the existing terraform tfvars + deploy.sh --set-secrets + Set Value
    // paths the same way SugarAgent's secrets do.
    const sharedToken = gatewayUnit!.secrets.find(
      (s) => s.secretKey === "gateway-shared-token"
    );
    expect(sharedToken).toMatchObject({
      mappingHint: "SUGARMAGIC_GATEWAY_SHARED_TOKEN",
      consumption: "server-only",
      exposure: "private",
      ownerId: "sugardeploy"
    });

    // Generated server.mjs has the authorizeBearer middleware + the 401
    // gate around plugin routes. /health stays public above the gate.
    const serverFile = wordlarkBearer.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs"
    );
    expect(serverFile).toBeDefined();
    const content = serverFile!.content;
    // Story 071.9 — compiled via esbuild; exact import formatting may differ
    // from the old template string. Assert on semantics, not byte format.
    expect(content).toContain("createHmac");
    expect(content).toContain("timingSafeEqual");
    expect(content).toContain('from "node:crypto"');
    expect(content).toContain("function authorizeBearer(req)");
    expect(content).toContain("SUGARMAGIC_GATEWAY_SHARED_TOKEN");
    // Rename-tolerant (esbuild may emit timingSafeEqual2) but still proves
    // the timing-safe compare is what receives the two token buffers.
    expect(content).toMatch(/timingSafeEqual\d*\(expectedBuf, presentedBuf\)/);
    expect(content).toContain("if (!authorizeBearer(req))");
    expect(content).toContain('error: "Unauthorized"');

    // The deploy.sh's --set-secrets list includes the shared token binding.
    const deployScript = wordlarkBearer.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript?.content).toContain(
      "--set-secrets=SUGARMAGIC_GATEWAY_SHARED_TOKEN=wordlark-v1-k3m9p-gateway-shared-token:latest"
    );
  });

  it("47.9 — SugarProfile enabled + gatewayAuthMode=bearer upgrades the gate to Supabase JWT (JWKS) verification", () => {
    // 47.9: with SugarProfile's login enabled, the persisted "bearer"
    // toggle is promoted to the effective mode "supabase-jwt". The
    // gateway emits an async verifySupabaseJwt() function that fetches
    // the project's JWKS (asymmetric ES256 default; HS256 fallback for
    // unmigrated projects) and attaches req.user on success. NO shared
    // secret is injected — the verifier reads the Supabase URL from
    // SugarProfile's existing runtime config env var, then hits the
    // public JWKS endpoint.
    const wordlarkJwt = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": { gatewayAuthMode: "bearer" }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true),
          createPluginConfigurationRecord(SUGARPROFILE_PLUGIN_ID, true, {
            enableLogin: true,
            supabaseUrl: "https://abcde.supabase.co",
            supabaseAnonKey: "anon-key",
            allowAnonymous: true
          })
        ]
      })
    );

    // No shared bearer token, no shared HS256 JWT secret on the gateway
    // unit. JWKS verification only needs the public Supabase URL,
    // already in the container via SugarProfile's runtime config.
    const gatewayUnit = wordlarkJwt.serviceUnits.find(
      (unit) => unit.serviceUnitId === "sugarmagic-gateway"
    );
    expect(gatewayUnit).toBeDefined();
    const secretKeys = gatewayUnit!.secrets.map((s) => s.secretKey).sort();
    expect(secretKeys).not.toContain("gateway-shared-token");
    expect(secretKeys).not.toContain("supabase-jwt-secret");

    // Generated server.mjs has the async JWT verifier + the JWT-mode
    // gate. authorizeBearer is still defined (mode-agnostic), but the
    // bearer-mode gate is NOT emitted.
    const serverFile = wordlarkJwt.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs"
    );
    expect(serverFile).toBeDefined();
    const content = serverFile!.content;
    // Story 071.9 — compiled via esbuild; exact import formatting may differ.
    expect(content).toContain("createHmac");
    expect(content).toContain("timingSafeEqual");
    expect(content).toContain('from "node:crypto"');
    // JWT verifier is always bundled into the compiled source (supabase-jwt.ts).
    expect(content).toContain(`async function ${SUPABASE_JWT_VERIFIER_FUNCTION_NAME}(req)`);
    expect(content).toContain(SUPABASE_URL_ENV_VAR);
    expect(content).toContain("/auth/v1/.well-known/jwks.json");
    // Auth gate snippet uses the JWT mode (injected at /*! __GATEWAY_AUTH_GATE__ */).
    expect(content).toContain(
      `const verifiedUser = await ${SUPABASE_JWT_VERIFIER_FUNCTION_NAME}(req);`
    );
    expect(content).toContain("req.user = verifiedUser;");
    expect(content).toContain('["aud"] !== "authenticated"');
    expect(content).not.toContain("if (!authorizeBearer(req))");

    // No --set-secrets binding for either auth path.
    const deployScript = wordlarkJwt.managedFiles.find(
      (file) => file.relativePath === "deployment/google-cloud-run/deploy.sh"
    );
    expect(deployScript?.content).not.toContain(
      "--set-secrets=SUGARMAGIC_GATEWAY_SHARED_TOKEN="
    );
    expect(deployScript?.content).not.toContain(
      "--set-secrets=SUGARMAGIC_SUPABASE_JWT_SECRET="
    );

    // Terraform tfvars omit both the shared-token and JWT-secret
    // container names. (SugarAgent's own secrets — Anthropic /
    // OpenAI keys — are still listed; the assertion is the absence
    // of the auth-gate secrets specifically.)
    const tfvars = wordlarkJwt.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/terraform/terraform.tfvars"
    );
    expect(tfvars).toBeDefined();
    expect(tfvars!.content).not.toContain(
      `"wordlark-v1-k3m9p-gateway-shared-token"`
    );
    expect(tfvars!.content).not.toContain(
      `"wordlark-v1-k3m9p-supabase-jwt-secret"`
    );
  });

  it("47.9 — JWT verifier (verifySupabaseJwt) verifies ES256 (JWKS) + HS256 (oct JWK) and rejects invalid / expired / wrong-aud / missing-header / kid-mismatch cases", async () => {
    // Story 071.9 — verifySupabaseJwt is now a proper TypeScript function in
    // packages/plugins/src/deployment/gateway/supabase-jwt.ts (bundled into
    // the compiled gateway artifact). Import it directly instead of the old
    // temp-file / dynamic-import approach. Drift between this TS source and
    // the shipped bundle is guarded by core-compiled-freshness.test.ts.
    const {
      generateKeyPairSync,
      createPrivateKey,
      createHmac,
      sign: cryptoSignAsync,
      randomBytes
    } = await import("node:crypto");
    const { createServer } = await import("node:http");

    function base64url(input: Buffer | string): string {
      const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
      return buf
        .toString("base64")
        .replace(/=+$/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    }

    // ES256 keypair for the "current" Supabase signing key.
    const ecKeyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecJwk = ecKeyPair.publicKey.export({ format: "jwk" }) as {
      kty: string;
      crv: string;
      x: string;
      y: string;
    };
    const ecKid = "ec-test-kid-current";
    const ecPrivateJwk = ecKeyPair.privateKey.export({ format: "jwk" });

    // HS256 oct JWK for the "previous" legacy key on the same project.
    const hsSecretBytes = randomBytes(32);
    const hsJwk = {
      kty: "oct" as const,
      k: base64url(hsSecretBytes),
      alg: "HS256" as const,
      kid: "hs-test-kid-legacy"
    };

    const jwks = {
      keys: [
        { ...ecJwk, alg: "ES256" as const, kid: ecKid, use: "sig" },
        hsJwk
      ]
    };

    // Local JWKS server.
    let jwksRequestCount = 0;
    const server = createServer((req, res) => {
      if (req.url === "/auth/v1/.well-known/jwks.json") {
        jwksRequestCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(jwks));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", () => resolveListen())
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test JWKS server failed to bind");
    }
    const supabaseUrl = `http://127.0.0.1:${address.port}`;

    // Convert a DER-encoded ECDSA signature to JWS concat r||s (64
    // bytes for P-256).
    function derToJwsConcat(der: Buffer): Buffer {
      // DER: 0x30 len 0x02 rLen r 0x02 sLen s
      if (der[0] !== 0x30) throw new Error("bad DER header");
      let offset = 2;
      if (der[1] === 0x81) offset = 3; // long form length
      if (der[offset] !== 0x02) throw new Error("expected r INTEGER");
      const rLen = der[offset + 1];
      let r = der.slice(offset + 2, offset + 2 + rLen);
      offset = offset + 2 + rLen;
      if (der[offset] !== 0x02) throw new Error("expected s INTEGER");
      const sLen = der[offset + 1];
      let s = der.slice(offset + 2, offset + 2 + sLen);
      // Strip leading 0x00 padding then left-pad to 32 bytes.
      if (r.length > 32 && r[0] === 0x00) r = r.slice(1);
      if (s.length > 32 && s[0] === 0x00) s = s.slice(1);
      const rPadded = Buffer.concat([Buffer.alloc(32 - r.length), r]);
      const sPadded = Buffer.concat([Buffer.alloc(32 - s.length), s]);
      return Buffer.concat([rPadded, sPadded]);
    }

    function signEs256Jwt(
      payload: Record<string, unknown>,
      kid: string,
      options?: { tamperSignature?: boolean }
    ): string {
      const header = base64url(
        JSON.stringify({ alg: "ES256", typ: "JWT", kid })
      );
      const body = base64url(JSON.stringify(payload));
      const signingInput = Buffer.from(header + "." + body, "utf8");
      const der = cryptoSignAsync(
        "SHA256",
        signingInput,
        createPrivateKey({ key: ecPrivateJwk, format: "jwk" })
      );
      const concat = derToJwsConcat(der);
      const finalSig = options?.tamperSignature
        ? base64url(Buffer.alloc(64, 0xff))
        : base64url(concat);
      return header + "." + body + "." + finalSig;
    }

    function signHs256Jwt(
      payload: Record<string, unknown>,
      kid: string
    ): string {
      const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
      const body = base64url(JSON.stringify(payload));
      const sig = createHmac("sha256", hsSecretBytes)
        .update(header + "." + body)
        .digest();
      return header + "." + body + "." + base64url(sig);
    }

    process.env[SUPABASE_URL_ENV_VAR] = supabaseUrl;
    // verifySupabaseJwt is imported at top of file (relative path into
    // packages/plugins; see the import comment there)
    const verify = (req: { headers: Record<string, string | undefined> }) =>
      verifySupabaseJwt(req as Parameters<typeof verifySupabaseJwt>[0]);
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const validPayload = {
        sub: "user-uuid-1234",
        email: "player@example.com",
        aud: "authenticated",
        exp: nowSeconds + 60 * 60
      };

      // ES256 happy path.
      const ecToken = signEs256Jwt(validPayload, ecKid);
      expect(
        await verify({ headers: { authorization: "Bearer " + ecToken } })
      ).toEqual({
        userId: "user-uuid-1234",
        email: "player@example.com"
      });

      // HS256 happy path (legacy / unmigrated projects).
      const hsToken = signHs256Jwt(validPayload, hsJwk.kid);
      expect(
        await verify({ headers: { authorization: "Bearer " + hsToken } })
      ).toEqual({
        userId: "user-uuid-1234",
        email: "player@example.com"
      });

      // JWKS is cached — multiple verifications should not re-hit the
      // upstream.
      const jwksCallsBefore = jwksRequestCount;
      await verify({ headers: { authorization: "Bearer " + ecToken } });
      await verify({ headers: { authorization: "Bearer " + ecToken } });
      expect(jwksRequestCount).toBe(jwksCallsBefore);

      // Expired ES256.
      const expiredToken = signEs256Jwt(
        { ...validPayload, exp: nowSeconds - 60 },
        ecKid
      );
      expect(
        await verify({ headers: { authorization: "Bearer " + expiredToken } })
      ).toBeNull();

      // Tampered ES256 signature.
      const tamperedToken = signEs256Jwt(validPayload, ecKid, {
        tamperSignature: true
      });
      expect(
        await verify({ headers: { authorization: "Bearer " + tamperedToken } })
      ).toBeNull();

      // kid not present in JWKS.
      const unknownKidToken = signEs256Jwt(validPayload, "totally-unknown-kid");
      expect(
        await verify({
          headers: { authorization: "Bearer " + unknownKidToken }
        })
      ).toBeNull();

      // Wrong audience (Supabase emits "authenticated" for signed-in
      // users; "anon" tokens should not satisfy the gateway gate).
      const anonToken = signEs256Jwt(
        { ...validPayload, aud: "anon" },
        ecKid
      );
      expect(
        await verify({ headers: { authorization: "Bearer " + anonToken } })
      ).toBeNull();

      // Missing Authorization header entirely.
      expect(await verify({ headers: {} })).toBeNull();

      // Bearer with empty token.
      expect(
        await verify({ headers: { authorization: "Bearer " } })
      ).toBeNull();

      // Garbage non-JWT string.
      expect(
        await verify({ headers: { authorization: "Bearer not-a-jwt" } })
      ).toBeNull();

      // Missing sub claim.
      const noSubToken = signEs256Jwt(
        { ...validPayload, sub: undefined },
        ecKid
      );
      expect(
        await verify({ headers: { authorization: "Bearer " + noSubToken } })
      ).toBeNull();

      // Email missing → still valid (Supabase oauth users may not
      // expose an email); userId returned, email becomes null.
      const noEmailToken = signEs256Jwt(
        { ...validPayload, email: undefined },
        ecKid
      );
      expect(
        await verify({ headers: { authorization: "Bearer " + noEmailToken } })
      ).toEqual({
        userId: "user-uuid-1234",
        email: null
      });
    } finally {
      delete process.env[SUPABASE_URL_ENV_VAR];
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose())
      );
    }
  });

  it("planner does NOT inject the bearer secret when gatewayAuthMode=none (the default)", () => {
    // 45.5.8 — defaulting to "none" preserves the 45.5.5 baseline behavior:
    // no auth middleware, no gateway-shared-token secret container created.
    const wordlarkNone = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        versionedProjectIdentifiers: { v1: "k3m9p" },
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          // gatewayAuthMode not set → defaults to "none"
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(HELLO_PLUGIN_ID, true)
        ]
      })
    );
    const gatewayUnit = wordlarkNone.serviceUnits.find(
      (unit) => unit.serviceUnitId === "sugarmagic-gateway"
    );
    expect(gatewayUnit?.secrets).toEqual([]);

    const serverFile = wordlarkNone.managedFiles.find(
      (file) =>
        file.relativePath ===
        "deployment/google-cloud-run/services/sugarmagic-gateway/server.mjs"
    );
    expect(serverFile?.content).not.toContain("if (!authorizeBearer(req))");
    // authorizeBearer function itself is still defined (the import + helper
    // are mode-agnostic and unused in "none" mode), but the gate that calls
    // it isn't emitted. Verifying the gate's absence is the load-bearing
    // assertion.
  });

  it("planner does NOT inject the baseline when no deployment target is selected", () => {
    // 45.5.5 guard: baseline is per-deployment-target. Until the user
    // picks a target, plan.serviceUnits stays empty (nothing to deploy
    // anywhere yet).
    const noTarget = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: null,
          targetOverrides: {}
        },
        pluginConfigurations: []
      })
    );
    expect(noTarget.serviceUnits).toEqual([]);
  });

  it.skipIf(!hasTerraform)(
    "generated Cloud Run terraform passes `terraform init -backend=false` + `terraform validate`",
    () => {
      // 45.2 hard exit: actually run the terraform CLI against the generated
      // files. Skipped when `terraform` is not on PATH. Network is required
      // for `terraform init` to fetch the Google provider.
      const wordlark = planGameDeployment(
        normalizeGameProject({
          ...makeProject(),
          identity: { id: "wordlark", schema: "GameProject", version: 1 },
          displayName: "Wordlark",
          majorVersion: 1,
          deployment: {
            backendDeploymentTargetId: "google-cloud-run",
            targetOverrides: {
              "google-cloud-run": { githubRepo: "nikki/wordlark" }
            }
          },
          pluginConfigurations: [
            createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
          ]
        })
      );

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sugarmagic-tf-"));
      try {
        for (const file of wordlark.managedFiles) {
          if (!file.relativePath.startsWith("deployment/google-cloud-run/terraform/")) continue;
          const abs = path.join(tmpRoot, file.relativePath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content);
        }
        const tfDir = path.join(tmpRoot, "deployment/google-cloud-run/terraform");
        execFileSync("terraform", ["init", "-backend=false", "-upgrade", "-input=false"], {
          cwd: tfDir,
          stdio: "pipe"
        });
        execFileSync("terraform", ["validate"], { cwd: tfDir, stdio: "pipe" });
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
    120_000
  );

  it("stripGithubRepoPrefixes handles every common paste form", () => {
    // 45.3 paste-forgiveness: canonical form passes through, all the common
    // URL/clone forms get reduced to owner/repo.
    expect(stripGithubRepoPrefixes("nikki/wordlark")).toBe("nikki/wordlark");
    expect(stripGithubRepoPrefixes("  nikki/wordlark  ")).toBe("nikki/wordlark");
    expect(stripGithubRepoPrefixes("https://github.com/nikki/wordlark")).toBe(
      "nikki/wordlark"
    );
    expect(stripGithubRepoPrefixes("http://github.com/nikki/wordlark")).toBe(
      "nikki/wordlark"
    );
    expect(stripGithubRepoPrefixes("https://github.com/nikki/wordlark.git")).toBe(
      "nikki/wordlark"
    );
    expect(stripGithubRepoPrefixes("git@github.com:nikki/wordlark.git")).toBe(
      "nikki/wordlark"
    );
    // Non-GitHub URLs are NOT stripped — the regex validation will reject them.
    expect(stripGithubRepoPrefixes("https://gitlab.com/foo/bar")).toBe(
      "https://gitlab.com/foo/bar"
    );
    expect(GITHUB_REPO_REGEX.test("https://gitlab.com/foo/bar")).toBe(false);
    // Empty input stays empty.
    expect(stripGithubRepoPrefixes("")).toBe("");
  });

  it("normalize routes the paste-forgiveness through to the persisted githubRepo", () => {
    // The strip-then-validate path the normalizer uses: any of the common
    // paste forms ends up persisted as the canonical owner/repo.
    const fromHttps = normalizeGoogleCloudRunDeploymentTargetOverrides({
      githubRepo: "https://github.com/nikki/wordlark.git"
    });
    expect(fromHttps.githubRepo).toBe("nikki/wordlark");

    const fromSsh = normalizeGoogleCloudRunDeploymentTargetOverrides({
      githubRepo: "git@github.com:nikki/wordlark.git"
    });
    expect(fromSsh.githubRepo).toBe("nikki/wordlark");

    // Invalid input falls back to empty string (terraform validate still passes;
    // the user sees a UI error in the Studio field and resolves it before deploy).
    const fromGarbage = normalizeGoogleCloudRunDeploymentTargetOverrides({
      githubRepo: "this is not a repo"
    });
    expect(fromGarbage.githubRepo).toBe("");
  });

  it("template-drift comparator detects strictly-older on-disk versions only", async () => {
    // 45.7 — pin the comparison the Studio banner uses. The host endpoint
    // returns onDiskVersion (parser output) + currentVersion
    // (CLOUD_RUN_TEMPLATE_VERSION); the banner renders only when
    // onDiskVersion < currentVersion AND the file exists. Equal, newer,
    // null (no stamp), and missing-file all suppress the banner — false
    // positives would train the user to ignore it.
    const { CLOUD_RUN_TEMPLATE_VERSION } = await import("@sugarmagic/plugins");
    const isDrifted = (
      onDiskVersion: number | null,
      currentVersion: number,
      fileExists: boolean
    ) =>
      fileExists &&
      onDiskVersion !== null &&
      onDiskVersion < currentVersion;

    // Older stamp on disk → drift.
    expect(isDrifted(1, CLOUD_RUN_TEMPLATE_VERSION, true)).toBe(true);
    // Equal → no drift.
    expect(
      isDrifted(CLOUD_RUN_TEMPLATE_VERSION, CLOUD_RUN_TEMPLATE_VERSION, true)
    ).toBe(false);
    // Newer on disk (downgrade scenario) → no drift; this isn't drift to
    // warn about, the user is intentionally on an older plugin build.
    expect(
      isDrifted(CLOUD_RUN_TEMPLATE_VERSION + 1, CLOUD_RUN_TEMPLATE_VERSION, true)
    ).toBe(false);
    // Stamp absent / unparseable → null → suppress (avoid false positive
    // when the file was hand-edited to remove the comment).
    expect(isDrifted(null, CLOUD_RUN_TEMPLATE_VERSION, true)).toBe(false);
    // File doesn't exist (fresh project, terraform never generated) →
    // suppress; banner only nags about drift, not about "you should run
    // Setup Infra," which other UI surfaces handle.
    expect(isDrifted(1, CLOUD_RUN_TEMPLATE_VERSION, false)).toBe(false);
  });

  it("parseTemplateVersionStamp finds the SUGARMAGIC TEMPLATE VERSION line", () => {
    expect(parseTemplateVersionStamp(null)).toBeNull();
    expect(parseTemplateVersionStamp("")).toBeNull();
    expect(parseTemplateVersionStamp("# nothing here\nterraform {}")).toBeNull();
    expect(
      parseTemplateVersionStamp(
        "# GENERATED BY SUGARMAGIC - DO NOT EDIT\n# SUGARMAGIC TEMPLATE VERSION: 1\nterraform {}"
      )
    ).toBe(1);
    expect(
      parseTemplateVersionStamp(
        "# GENERATED BY SUGARMAGIC - DO NOT EDIT\n# SUGARMAGIC TEMPLATE VERSION: 7\nterraform {}"
      )
    ).toBe(7);
    // version 0 is not valid; stamp must be >= 1
    expect(
      parseTemplateVersionStamp(
        "# GENERATED BY SUGARMAGIC - DO NOT EDIT\n# SUGARMAGIC TEMPLATE VERSION: 0\nterraform {}"
      )
    ).toBeNull();
  });

  it("stripBillingAccountPrefix strips the gcloud `billingAccounts/` prefix", () => {
    // 45.4.5: gcloud billing accounts list returns names as
    // `billingAccounts/<id>`, but the --billing-account flag wants the bare id.
    expect(stripBillingAccountPrefix("billingAccounts/0139AB-705A0F-FCBB0F")).toBe(
      "0139AB-705A0F-FCBB0F"
    );
    // Defensive: already-bare ids pass through unchanged.
    expect(stripBillingAccountPrefix("0139AB-705A0F-FCBB0F")).toBe(
      "0139AB-705A0F-FCBB0F"
    );
    // Non-string and empty input collapse to empty string, never throw.
    expect(stripBillingAccountPrefix(null)).toBe("");
    expect(stripBillingAccountPrefix(undefined)).toBe("");
    expect(stripBillingAccountPrefix(42)).toBe("");
    expect(stripBillingAccountPrefix("")).toBe("");
  });

  it("parseBillingAccountList filters to open accounts and projects to the button shape", () => {
    // 45.4.5: real shape from `gcloud billing accounts list --format=json`,
    // mirroring nikki's actual two-account host (one open, one closed).
    const stdout = JSON.stringify([
      {
        currencyCode: "USD",
        displayName: "FoxLeapMoon Biling",
        masterBillingAccount: "",
        name: "billingAccounts/0139AB-705A0F-FCBB0F",
        open: true,
        parent: "organizations/645494120938"
      },
      {
        currencyCode: "USD",
        displayName: "My Billing Account",
        masterBillingAccount: "",
        name: "billingAccounts/01DDF6-1241DF-A48BC4",
        open: false,
        parent: "organizations/645494120938"
      }
    ]);
    const accounts = parseBillingAccountList(stdout);
    expect(accounts).toEqual([
      {
        id: "0139AB-705A0F-FCBB0F",
        displayName: "FoxLeapMoon Biling",
        currencyCode: "USD",
        masterBillingAccountId: null
      }
    ]);
  });

  it("parseBillingAccountList accepts the pre-parsed array and tolerates malformed input", () => {
    // Caller may have already JSON.parsed — accept either shape.
    expect(
      parseBillingAccountList([
        {
          name: "billingAccounts/AAA-BBB-CCC",
          displayName: "Solo",
          open: true,
          masterBillingAccount: "billingAccounts/DDD-EEE-FFF",
          currencyCode: "USD"
        }
      ])
    ).toEqual([
      {
        id: "AAA-BBB-CCC",
        displayName: "Solo",
        currencyCode: "USD",
        masterBillingAccountId: "DDD-EEE-FFF"
      }
    ]);

    // Garbage in → empty array out (the middleware surfaces a "no open accounts" UX, not a crash).
    expect(parseBillingAccountList("not json")).toEqual([]);
    expect(parseBillingAccountList(null)).toEqual([]);
    expect(parseBillingAccountList({})).toEqual([]);
    expect(parseBillingAccountList([])).toEqual([]);
    // Entry missing required name field is silently skipped.
    expect(
      parseBillingAccountList([{ displayName: "Nameless", open: true }])
    ).toEqual([]);
    // displayName falls back to the id when missing.
    expect(
      parseBillingAccountList([
        { name: "billingAccounts/RAW-ID", open: true }
      ])
    ).toEqual([
      {
        id: "RAW-ID",
        displayName: "RAW-ID",
        currencyCode: undefined,
        masterBillingAccountId: null
      }
    ]);
  });

  it("GCP_PROJECT_ID_REGEX enforces GCP's globally-unique project id rule", () => {
    // 45.4.5 pre-flight: the form-level validation rejects invalid ids before
    // we issue `gcloud projects create` so the user sees the rule, not a
    // confusing gcloud failure.
    expect(isValidGcpProjectId("wordlark-v1")).toBe(true);
    expect(isValidGcpProjectId("wordlark-v1-staging")).toBe(true);
    // 30 chars exactly — the upper bound.
    expect(isValidGcpProjectId("abcdef-ghijkl-mnopqr-stuvwx-yz")).toBe(true);

    // 5 chars — below the 6-char minimum.
    expect(isValidGcpProjectId("short")).toBe(false);
    // Must start with a lowercase letter.
    expect(isValidGcpProjectId("1wordlark")).toBe(false);
    expect(isValidGcpProjectId("-wordlark")).toBe(false);
    // No uppercase.
    expect(isValidGcpProjectId("Wordlark")).toBe(false);
    // No underscores.
    expect(isValidGcpProjectId("wordlark_v1")).toBe(false);
    // Must end with letter or digit, not hyphen.
    expect(isValidGcpProjectId("wordlark-")).toBe(false);
    // 31+ chars exceeds GCP's 30-char limit.
    expect(isValidGcpProjectId("a".repeat(31))).toBe(false);
    // Non-string input.
    expect(isValidGcpProjectId(null)).toBe(false);
    expect(isValidGcpProjectId(42)).toBe(false);

    // Regex is also exposed for direct use (e.g., the form field's onChange).
    expect(GCP_PROJECT_ID_REGEX.test("wordlark-v1")).toBe(true);
  });

  it("REQUIRED_GCP_APIS locks down the APIs the create-gcp-project sequence enables", () => {
    // 45.4.5 contract: the create-gcp-project host action shells out to
    // `gcloud services enable <list>` with exactly these. If the terraform
    // generator (or any consumer downstream) ever needs an additional API,
    // it lands in this list AND its motivation gets called out in the diff.
    expect([...REQUIRED_GCP_APIS]).toEqual([
      "run.googleapis.com",
      "artifactregistry.googleapis.com",
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "secretmanager.googleapis.com",
      "sts.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "serviceusage.googleapis.com",
      "cloudbuild.googleapis.com",
      // 45.5.7 — needed for the project-level org-policy override that
      // unblocks allUsers binding on Cloud Run services.
      "orgpolicy.googleapis.com"
    ]);
  });

  it("buildGcpProjectName produces `${displayName} v${majorVersion}`", () => {
    // 45.4.5: human-facing name on `gcloud projects create --name`.
    expect(buildGcpProjectName("Wordlark", 1)).toBe("Wordlark v1");
    expect(buildGcpProjectName("Wordlark Hollow", 2)).toBe("Wordlark Hollow v2");
    // Free-form text passes through; gcloud rejects > 30 chars at the API
    // layer so we let it surface the error instead of silently clamping.
    expect(buildGcpProjectName("A Very Very Long Game Name", 11)).toBe(
      "A Very Very Long Game Name v11"
    );
  });

  it("GCP_SERVICE_ACCOUNT_ID_REGEX enforces the 6–30 char SA account_id rule", () => {
    // 45.4.7 fix add-on — validate the runtime SA name inline in the form
    // so users see GCP's rule before a confusing gcloud failure during
    // Setup Infra. Same shape as project id (lowercase letter start,
    // alphanumeric + hyphens, end with letter/digit, 6–30 chars).
    expect(GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH).toBe(30);
    expect(isValidGcpServiceAccountId("wordlark-v1-k3m9p-runtime")).toBe(true);
    expect(isValidGcpServiceAccountId("runtime")).toBe(true);
    expect(isValidGcpServiceAccountId("gateway-runtime")).toBe(true);
    // Exactly 30 chars — the upper bound.
    expect(isValidGcpServiceAccountId("a".repeat(30))).toBe(true);

    // 31 chars — over the limit. This is the case the form's auto-derived
    // path catches (e.g., a long slug + version + suffix + `-runtime`).
    expect(isValidGcpServiceAccountId("a".repeat(31))).toBe(false);
    // 5 chars — below minimum.
    expect(isValidGcpServiceAccountId("short")).toBe(false);
    // Leading digit / hyphen.
    expect(isValidGcpServiceAccountId("1runtime")).toBe(false);
    expect(isValidGcpServiceAccountId("-runtime")).toBe(false);
    // Uppercase / underscore not allowed.
    expect(isValidGcpServiceAccountId("Runtime")).toBe(false);
    expect(isValidGcpServiceAccountId("my_runtime")).toBe(false);
    // Trailing hyphen.
    expect(isValidGcpServiceAccountId("runtime-")).toBe(false);
    // Non-string input.
    expect(isValidGcpServiceAccountId(null)).toBe(false);
    expect(isValidGcpServiceAccountId(undefined)).toBe(false);

    // Regex exposed for direct use in form-field onChange.
    expect(GCP_SERVICE_ACCOUNT_ID_REGEX.test("wordlark-v1-k3m9p-runtime")).toBe(
      true
    );
  });

  it("classifyProjectListResult maps gcloud ownership-probe output to the button state", () => {
    // 45.4.7 fix — the original probe used `gcloud projects describe`, but
    // GCP intentionally returns PERMISSION_DENIED for BOTH "doesn't exist"
    // and "no access" (security: doesn't leak project existence). The new
    // probe uses `gcloud projects list --filter="projectId:<id>"` which
    // cleanly answers "do I own this?" — empty array = no, non-empty = yes.

    // Owned: list returns a single project record.
    expect(
      classifyProjectListResult(
        0,
        JSON.stringify([
          {
            projectId: "wordlark-v1-k3m9p",
            name: "Wordlark v1",
            lifecycleState: "ACTIVE"
          }
        ])
      )
    ).toBe("owned");

    // Not-owned: empty array. Could be "doesn't exist" or "someone else has
    // the global id" — we can't tell, and that's fine because the create
    // attempt will resolve the ambiguity by trying it.
    expect(classifyProjectListResult(0, "[]")).toBe("not-owned");

    // Non-zero exit from gcloud (network failure, auth invalidated, etc.).
    expect(classifyProjectListResult(1, "")).toBe("unknown");
    expect(classifyProjectListResult(null, "")).toBe("unknown");

    // Exit 0 but malformed stdout — unknown rather than crashing.
    expect(classifyProjectListResult(0, "not json")).toBe("unknown");
    expect(classifyProjectListResult(0, '{"not": "an array"}')).toBe("unknown");
  });

  it("defaults missing majorVersion to 1 on load via normalizeGameProject", () => {
    const projectMissingField = normalizeGameProject({
      ...makeProject(),
      // intentionally drop majorVersion — older project.sgrmagic files lack it
      majorVersion: undefined
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(projectMissingField.majorVersion).toBe(1);
  });

  it("resolves setup-infra and teardown-infra as supported on Cloud Run", () => {
    // 45.4: both action kinds advertise terraform commands rooted in the
    // terraform/ subdirectory of the Working Directory. The middleware's
    // terraform-on-PATH check is what enforces the runtime prereq; the
    // resolver just says the action is supported in principle.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              workingDirectory: "/tmp/wordlark",
              githubRepo: "nikki/wordlark"
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    const setup = resolveDeploymentAction(plan, "setup-infra");
    expect(setup).toMatchObject({
      targetId: "google-cloud-run",
      actionKind: "setup-infra",
      supported: true,
      command: {
        command: "terraform",
        args: ["apply", "-auto-approve", "-input=false"],
        cwd: "/tmp/wordlark/deployment/google-cloud-run/terraform"
      }
    });

    const teardown = resolveDeploymentAction(plan, "teardown-infra");
    expect(teardown).toMatchObject({
      targetId: "google-cloud-run",
      actionKind: "teardown-infra",
      supported: true,
      command: {
        command: "terraform",
        args: ["destroy", "-auto-approve", "-input=false"],
        cwd: "/tmp/wordlark/deployment/google-cloud-run/terraform"
      }
    });
  });

  it("rejects setup-infra / teardown-infra on the Local target with a clear reason", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          targetOverrides: {
            local: { workingDirectory: "/tmp/wordlark" }
          }
        }
      })
    );
    const setup = resolveDeploymentAction(plan, "setup-infra");
    expect(setup.supported).toBe(false);
    expect(setup.reason).toMatch(/Cloud Run-only/);
    const teardown = resolveDeploymentAction(plan, "teardown-infra");
    expect(teardown.supported).toBe(false);
    expect(teardown.reason).toMatch(/Cloud Run-only/);
  });

  it("getCloudRunServiceNamesForPlan returns the gcloud-deletable names", async () => {
    // 45.4 teardown ordering: middleware needs the list of declared service
    // names to gcloud-delete each one before terraform destroy runs.
    const { getCloudRunServiceNamesForPlan } = await import("@sugarmagic/plugins");
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {}
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );
    const names = getCloudRunServiceNamesForPlan(plan);
    // Default unit id `sugarmagic-gateway` + version-namespaced prefix
    // `wordlark-v1` → `wordlark-v1-sugarmagic-gateway`.
    expect(names).toContain("wordlark-v1-sugarmagic-gateway");
  });

  it("resolves Cloud Run health as supported with no command — middleware probes the deployed URL", () => {
    // 45.6: health on Cloud Run is a middleware-orchestrated HTTP probe
    // (gcloud run services describe → fetch <url>/health). The resolver
    // signals supported:true with NO command; the middleware fully owns
    // the probe so the UI keeps a single uniform action shape.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              workingDirectory: "/tmp/wordlark",
              projectId: "wordlark-v1-abcdef"
            }
          }
        }
      })
    );
    const health = resolveDeploymentAction(plan, "health");
    expect(health).toEqual({
      targetId: "google-cloud-run",
      actionKind: "health",
      supported: true
    });
  });

  it("resolves Cloud Run destroy with gcloud run services delete (project + region scoped)", () => {
    // 45.6: destroy deletes the Cloud Run service(s) the plan declared
    // and preserves Artifact Registry, IAM, WIF, Secret Manager state so
    // a subsequent Deploy can bring the service back without Setup Infra.
    // The descriptor surfaces the command shape; the middleware iterates
    // the plan's service names and applies tolerateNotFound:true per call.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        identity: { id: "wordlark", schema: "GameProject", version: 1 },
        displayName: "Wordlark",
        majorVersion: 1,
        deployment: {
          backendDeploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              workingDirectory: "/tmp/wordlark",
              projectId: "wordlark-v1-abcdef",
              region: "us-central1"
            }
          }
        }
      })
    );
    const destroy = resolveDeploymentAction(plan, "destroy");
    expect(destroy).toMatchObject({
      targetId: "google-cloud-run",
      actionKind: "destroy",
      supported: true,
      command: {
        command: "gcloud",
        args: [
          "run",
          "services",
          "delete",
          "--quiet",
          "--project",
          "wordlark-v1-abcdef",
          "--region",
          "us-central1"
        ]
      }
    });
  });

  it("threads gameProject through resolveDeploymentAction so Status/Destroy commands target the versioned slug + suffix", () => {
    // 45.6 regression: before this fix, resolveDeploymentAction dropped
    // the gameProject before re-normalizing overrides, so the projectId
    // fell back to bare `sugarmagic-v1` and gcloud Status fired against
    // a project nikki doesn't own. Pin the contract — when the project
    // has a versionedProjectIdentifiers entry, the resolved command's
    // `--project` arg matches the versioned slug + suffix.
    const project = normalizeGameProject({
      ...makeProject(),
      identity: { id: "wordlark", schema: "GameProject", version: 1 },
      displayName: "Wordlark",
      majorVersion: 1,
      versionedProjectIdentifiers: { v1: "1dqlc" },
      deployment: {
        backendDeploymentTargetId: "google-cloud-run",
        targetOverrides: {
          "google-cloud-run": {
            workingDirectory: "/tmp/wordlark",
            region: "us-central1"
          }
        }
      }
    });
    const plan = planGameDeployment(project);
    const status = resolveDeploymentAction(plan, "status", project);
    expect(status.command?.args).toContain("wordlark-v1-1dqlc");
    expect(status.command?.args).not.toContain("sugarmagic-v1");
    const destroy = resolveDeploymentAction(plan, "destroy", project);
    expect(destroy.command?.args).toContain("wordlark-v1-1dqlc");
  });

  it("rejects Cloud Run health + destroy with a clear reason when working directory is missing", () => {
    // 45.6: both actions short-circuit at the Working Directory check —
    // gcloud commands need the deployment cwd resolved before they can
    // emit a descriptor. projectId always derives from the versioned
    // slug (45.4.7), so the real unblock is the Working Directory
    // override, surfaced with a concrete reason for the UI.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run"
        }
      })
    );
    expect(resolveDeploymentAction(plan, "health")).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/Working Directory/i)
    });
    expect(resolveDeploymentAction(plan, "destroy")).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/Working Directory/i)
    });
  });

  it("resolves Local health + destroy symmetrically with the deploy port", () => {
    // 45.6 symmetry: the Local target keeps its docker-compose-shaped
    // commands while health resolves to a healthUrl probe — same shape
    // the middleware now uses for both Local and Cloud Run. Local
    // destroy uses `docker compose down` to tear containers down;
    // images stay cached, so a subsequent Deploy rebuilds quickly.
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          targetOverrides: {
            local: {
              workingDirectory: "/tmp/wordlark",
              gatewayHostPortBase: 9100
            }
          }
        }
      })
    );
    const health = resolveDeploymentAction(plan, "health");
    expect(health).toEqual({
      targetId: "local",
      actionKind: "health",
      supported: true,
      healthUrl: "http://localhost:9100/health"
    });
    const destroy = resolveDeploymentAction(plan, "destroy");
    expect(destroy).toMatchObject({
      targetId: "local",
      actionKind: "destroy",
      supported: true,
      command: {
        command: "docker",
        args: ["compose", "down"],
        cwd: "/tmp/wordlark/deployment/local"
      },
      healthUrl: "http://localhost:9100/health"
    });
  });

  it("resolves local deployment actions from target overrides", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "local",
          targetOverrides: {
            local: {
              workingDirectory: "/tmp/wordlark",
              gatewayHostPortBase: 9000
            }
          }
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    expect(resolveDeploymentAction(plan, "deploy")).toEqual({
      targetId: "local",
      actionKind: "deploy",
      supported: true,
      command: {
        // PR #77: local deploy bootstraps .env from .env.example on first run,
        // then runs docker compose up --build -d, via a single `sh -c`.
        command: "sh",
        args: [
          "-c",
          `[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example -- fill in API keys before the gateway will respond to LLM calls."); docker compose up --build -d`
        ],
        cwd: "/tmp/wordlark/deployment/local"
      },
      healthUrl: "http://localhost:9000/health"
    });
  });

  it("requires a working directory before deployment actions can run", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          backendDeploymentTargetId: "google-cloud-run"
        },
        pluginConfigurations: [
          createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true)
        ]
      })
    );

    expect(resolveDeploymentAction(plan, "deploy")).toMatchObject({
      targetId: "google-cloud-run",
      actionKind: "deploy",
      supported: false
    });
  });

  it("treats enabled installed plugin runtime code as part of the normal published bundle", () => {
    const boot = createRuntimeBootModel({
      hostKind: "published-web",
      compileProfile: "runtime-preview",
      contentSource: "published-artifact"
    });

    const bundled = listBundledRuntimePluginIds(boot, [HELLO_PLUGIN_ID], [
      createPluginConfigurationRecord(HELLO_PLUGIN_ID, true),
      createPluginConfigurationRecord("not-installed", true)
    ]);

    expect(bundled).toEqual([HELLO_PLUGIN_ID]);
  });

  it("allows a plugin to contribute a runtime banner from canonical plugin config", () => {
    const boot = createRuntimeBootModel({
      hostKind: "published-web",
      compileProfile: "runtime-preview",
      contentSource: "published-artifact"
    });

    const instances = createRuntimePluginInstances(
      boot,
      [
        createPluginConfigurationRecord(HELLO_PLUGIN_ID, true, {
          message: "Hello from plugin"
        })
      ],
      (pluginId) => {
        const plugin = getDiscoveredPluginDefinition(pluginId);
        if (!plugin) return null;
        return {
          displayName: plugin.manifest.displayName,
          runtime: plugin.runtime
        };
      }
    );

    const manager = createRuntimePluginManager({ boot, plugins: instances });
    const banners = manager.getContributions("runtime.banner");

    expect(banners).toHaveLength(1);
    expect(banners[0]?.payload.message).toBe("Hello from plugin");
    expect(
      normalizeHelloPluginConfig({ message: "Hello from plugin" }).message
    ).toBe("Hello from plugin");
  });

  it("normalizes sugaragent plugin config with hosted backend defaults", () => {
    // Story 46.14 — SugarAgentPluginConfig dropped the
    // anthropicApiKey / openAiApiKey / *Model / vectorStoreId fields;
    // those live server-side now (Studio vite middleware in dev,
    // Cloud Run gateway in published-web).
    expect(
      normalizeSugarAgentPluginConfig({
        debugLogging: true,
        maxEvidenceResults: 99
      })
    ).toEqual({
      proxyBaseUrl: "",
      gatewayBearerToken: "",
      loreSourceKind: "local",
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      openAiVectorStoreId: "",
      anthropicModel: "",
      maxEvidenceResults: 8,
      maxEvidenceCharsPerItem: 600,
      debugLogging: true,
      tone: ""
    });
  });

  it("normalizes sugaragent proxy mode from environment (story 46.14)", () => {
    expect(
      normalizeSugarAgentPluginConfig(
        {},
        {
          SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
        }
      )
    ).toEqual({
      proxyBaseUrl: "http://localhost:8787",
      gatewayBearerToken: "",
      loreSourceKind: "local",
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      openAiVectorStoreId: "",
      anthropicModel: "",
      maxEvidenceResults: 4,
      maxEvidenceCharsPerItem: 600,
      debugLogging: false,
      tone: ""
    });
  });

  it("creates the sugaragent runtime contribution in proxy mode without browser vendor keys", () => {
    const boot = createRuntimeBootModel({
      hostKind: "studio",
      compileProfile: "runtime-preview",
      contentSource: "authored-game-root"
    });

    const instances = createRuntimePluginInstances(
      boot,
      [createPluginConfigurationRecord(SUGARAGENT_PLUGIN_ID, true, {})],
      (pluginId) => {
        const plugin = getDiscoveredPluginDefinition(pluginId);
        if (!plugin) return null;
        return {
          displayName: plugin.manifest.displayName,
          runtime: plugin.runtime
        };
      },
      {
        SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
      }
    );

    expect(
      instances[0]?.contributions.some(
        (contribution) => contribution.kind === "conversation.provider"
      )
    ).toBe(true);
  });

  // Story 46.12 (+ minor versions follow-up 2026-07-05) — tag
  // auto-increment + version-history grouping. The
  // `v{major}.{minor}.{patch}` scheme is the source of truth for
  // which commit deploys to which Cloud Run + Netlify slot.
  // Releases always anchor to an existing major (you can't tag a
  // major that hasn't been cut), and gaps never get reused.
  it("parses well-formed version tags and rejects malformed ones", () => {
    expect(parseVersionTag("v1.0.0")).toEqual({ major: 1, minor: 0, patch: 0, tag: "v1.0.0" });
    expect(parseVersionTag("v2.0.7")).toEqual({ major: 2, minor: 0, patch: 7, tag: "v2.0.7" });
    expect(parseVersionTag("  v3.0.1  ")).toEqual({ major: 3, minor: 0, patch: 1, tag: "v3.0.1" });
    // Full semver with a minor component.
    expect(parseVersionTag("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, tag: "v1.2.3" });
    // Missing leading `v`.
    expect(parseVersionTag("1.0.0")).toBeNull();
    // Pre-release suffix not supported.
    expect(parseVersionTag("v1.0.0-rc1")).toBeNull();
    // Zero / negative major rejected.
    expect(parseVersionTag("v0.0.1")).toBeNull();
  });

  it("auto-increments to the next patch tag from the highest existing release", () => {
    expect(computeNextPatchTag(["v1.0.0"], 1)).toEqual({
      ok: true,
      nextTag: "v1.0.1",
      highestExistingTag: "v1.0.0"
    });
    expect(computeNextPatchTag(["v1.0.0", "v1.0.1"], 1)).toEqual({
      ok: true,
      nextTag: "v1.0.2",
      highestExistingTag: "v1.0.1"
    });
    // Patches increment WITHIN the highest minor.
    expect(computeNextPatchTag(["v1.0.0", "v1.0.3", "v1.1.0"], 1)).toEqual({
      ok: true,
      nextTag: "v1.1.1",
      highestExistingTag: "v1.1.0"
    });
  });

  it("auto-increments to the next minor tag, resetting patch", () => {
    expect(computeNextMinorTag(["v1.0.0"], 1)).toEqual({
      ok: true,
      nextTag: "v1.1.0",
      highestExistingTag: "v1.0.0"
    });
    expect(computeNextMinorTag(["v1.0.0", "v1.1.0", "v1.1.4"], 1)).toEqual({
      ok: true,
      nextTag: "v1.2.0",
      highestExistingTag: "v1.1.4"
    });
    // Requires the cut-major base like patches do.
    expect(computeNextMinorTag(["v1.0.0"], 2).ok).toBe(false);
  });

  it("is gap-tolerant: never reuses a freed patch number", () => {
    // Patches v1.0.2 was deleted; next should still be v1.0.4, not v1.0.2.
    // Reusing a freed number would point a tag at a different commit than
    // anyone who saw it previously expects.
    expect(computeNextPatchTag(["v1.0.0", "v1.0.1", "v1.0.3"], 1)).toEqual({
      ok: true,
      nextTag: "v1.0.4",
      highestExistingTag: "v1.0.3"
    });
  });

  it("ignores releases of other majors when computing next tags", () => {
    // v2's releases must not influence v1's next patch.
    expect(computeNextPatchTag(["v1.0.0", "v2.0.0", "v2.0.5"], 1)).toEqual({
      ok: true,
      nextTag: "v1.0.1",
      highestExistingTag: "v1.0.0"
    });
    expect(computeNextPatchTag(["v1.0.0", "v2.0.0", "v2.0.5"], 2)).toEqual({
      ok: true,
      nextTag: "v2.0.6",
      highestExistingTag: "v2.0.5"
    });
    expect(computeNextMinorTag(["v1.0.0", "v2.0.0", "v2.3.1"], 2)).toEqual({
      ok: true,
      nextTag: "v2.4.0",
      highestExistingTag: "v2.3.1"
    });
  });

  it("refuses to patch a major that hasn't been cut", () => {
    const result = computeNextPatchTag(["v1.0.0"], 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No v2\.0\.0 tag found/);
  });

  it("rejects non-positive-integer majors", () => {
    expect(computeNextPatchTag(["v1.0.0"], 0).ok).toBe(false);
    expect(computeNextPatchTag(["v1.0.0"], -1).ok).toBe(false);
    expect(computeNextPatchTag(["v1.0.0"], 1.5).ok).toBe(false);
  });

  it("groups version tags into majors with patches sorted ascending", () => {
    expect(
      groupVersionTags([
        "v1.0.0",
        "v2.0.0",
        "v1.0.2",
        "v1.0.1",
        "v2.0.1",
        "not-a-version",
        "v1.2.3"
      ])
    ).toEqual([
      {
        major: 2,
        baseTag: "v2.0.0",
        patches: [{ major: 2, minor: 0, patch: 1, tag: "v2.0.1" }]
      },
      {
        major: 1,
        baseTag: "v1.0.0",
        patches: [
          { major: 1, minor: 0, patch: 1, tag: "v1.0.1" },
          { major: 1, minor: 0, patch: 2, tag: "v1.0.2" },
          // Minor releases interleave in true (minor, patch) order.
          { major: 1, minor: 2, patch: 3, tag: "v1.2.3" }
        ]
      }
    ]);
  });

  // Story 46.16 — schema-driven plugin settings panels.
  // `pluginSettingsSchema` is the public contract a plugin uses to
  // declare its per-game config UI. Studio auto-mounts a panel that
  // renders one input per schema field; the validator below enforces
  // cross-reference with `gatewayRuntimeConfigKeys` so a deploy-time
  // env var can't exist without a UI surface.
  it("passes a well-formed schema", () => {
    const schema: PluginSettingsSchemaField[] = [
      { configKey: "foo", label: "Foo", type: "text" },
      {
        configKey: "bar",
        label: "Bar",
        type: "select",
        options: [{ value: "a", label: "A" }]
      }
    ];
    expect(validatePluginSettingsSchema("test", schema, undefined)).toEqual({
      ok: true
    });
  });

  it("rejects duplicate schema keys", () => {
    const result = validatePluginSettingsSchema(
      "test",
      [
        { configKey: "foo", label: "Foo", type: "text" },
        { configKey: "foo", label: "Foo Again", type: "text" }
      ],
      undefined
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/duplicate.*configKey "foo"/);
  });

  it("rejects a select field with no options", () => {
    const result = validatePluginSettingsSchema(
      "test",
      [{ configKey: "foo", label: "Foo", type: "select" }],
      undefined
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no options/);
  });

  it("rejects showWhen targeting a nonexistent sibling field", () => {
    const result = validatePluginSettingsSchema(
      "test",
      [
        {
          configKey: "foo",
          label: "Foo",
          type: "text",
          showWhen: { configKey: "missing", equals: "x" }
        }
      ],
      undefined
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/showWhen.*does not match/);
  });

  it("accepts showWhen targeting a sibling field that exists", () => {
    const result = validatePluginSettingsSchema(
      "test",
      [
        {
          configKey: "kind",
          label: "Kind",
          type: "select",
          options: [{ value: "a", label: "A" }]
        },
        {
          configKey: "detail",
          label: "Detail",
          type: "text",
          showWhen: { configKey: "kind", equals: "a" }
        }
      ],
      undefined
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a gatewayRuntimeConfigKey with no matching schema field", () => {
    const result = validatePluginSettingsSchema(
      "sugaragent",
      [{ configKey: "tone", label: "Tone", type: "text" }],
      [
        {
          configKey: "openAiVectorStoreId",
          envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
          description: "...",
          nonSecretAttestation: "safe-to-expose-publicly"
        }
      ]
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/openAiVectorStoreId.*no matching/);
  });

  it("rejects gatewayRuntimeConfigKeys when no schema is declared at all", () => {
    const result = validatePluginSettingsSchema(
      "test",
      undefined,
      [
        {
          configKey: "x",
          envVarName: "SUGARMAGIC_TEST_X",
          description: "...",
          nonSecretAttestation: "safe-to-expose-publicly"
        }
      ]
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no pluginSettingsSchema/);
  });

  it("accepts a matching schema + runtime-config pair", () => {
    const result = validatePluginSettingsSchema(
      "sugaragent",
      [
        {
          configKey: "openAiVectorStoreId",
          label: "OpenAI Vector Store ID",
          type: "text"
        }
      ],
      [
        {
          configKey: "openAiVectorStoreId",
          envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
          description: "...",
          nonSecretAttestation: "safe-to-expose-publicly"
        }
      ]
    );
    expect(result.ok).toBe(true);
  });

  it("SugarAgent's bundled plugin definition passes the validator", () => {
    const definition = getDiscoveredPluginDefinition(SUGARAGENT_PLUGIN_ID);
    expect(definition).not.toBeNull();
    const result = validatePluginSettingsSchema(
      SUGARAGENT_PLUGIN_ID,
      definition?.pluginSettingsSchema,
      definition?.gatewayRuntimeConfigKeys
    );
    expect(result.ok).toBe(true);
  });

  it("Sugarlang's bundled plugin definition passes the validator", () => {
    const definition = getDiscoveredPluginDefinition(SUGARLANG_PLUGIN_ID);
    expect(definition).not.toBeNull();
    const result = validatePluginSettingsSchema(
      SUGARLANG_PLUGIN_ID,
      definition?.pluginSettingsSchema,
      definition?.gatewayRuntimeConfigKeys
    );
    expect(result.ok).toBe(true);
  });

  // Story 47.6 — SugarProfile plugin scaffold. Manifest + settings
  // schema + gateway runtime config + deployment requirements all
  // land; the Studio-side hand-written workspace override is
  // verified separately via the Studio catalog test below.
  it("SugarProfile is registered with the correct capability list", () => {
    const definition = getDiscoveredPluginDefinition(SUGARPROFILE_PLUGIN_ID);
    expect(definition).not.toBeNull();
    expect(definition?.manifest.displayName).toBe("SugarProfile");
    expect(definition?.manifest.capabilityIds).toEqual([
      "identity.provider",
      "save.store",
      "design.workspace"
    ]);
  });

  it("SugarProfile's bundled plugin definition passes the settings schema validator", () => {
    const definition = getDiscoveredPluginDefinition(SUGARPROFILE_PLUGIN_ID);
    expect(definition).not.toBeNull();
    const result = validatePluginSettingsSchema(
      SUGARPROFILE_PLUGIN_ID,
      definition?.pluginSettingsSchema,
      definition?.gatewayRuntimeConfigKeys
    );
    expect(result.ok).toBe(true);
  });

  it("SugarProfile's gatewayRuntimeConfigKeys each pass the env-name + attestation validator", () => {
    const definition = getDiscoveredPluginDefinition(SUGARPROFILE_PLUGIN_ID);
    expect(definition).not.toBeNull();
    const keys = definition?.gatewayRuntimeConfigKeys ?? [];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      const result = validateGatewayRuntimeConfigKey(
        SUGARPROFILE_PLUGIN_ID,
        key
      );
      expect(result.ok).toBe(true);
    }
    const envVarNames = keys.map((key) => key.envVarName);
    expect(envVarNames).toEqual([
      "SUGARMAGIC_SUGARPROFILE_SUPABASE_URL",
      "SUGARMAGIC_SUGARPROFILE_SUPABASE_ANON_KEY"
    ]);
  });

  it("SugarProfile declares the service-role secret as a deployment requirement", () => {
    // Plan 047 §47.6 originally declared TWO secrets: service-role + a
    // shared HS256 JWT secret. §47.9 rewrote the gateway verifier to
    // use JWKS over the public `/auth/v1/.well-known/jwks.json`
    // endpoint instead — no shared secret needed — so the JWT secret
    // requirement was dropped. Service-role remains: the migration
    // runner uses it to bypass RLS during `supabase db push`.
    const definition = getDiscoveredPluginDefinition(SUGARPROFILE_PLUGIN_ID);
    const secrets = (definition?.deploymentRequirements ?? []).filter(
      (requirement) => requirement.kind === "secret"
    );
    const secretKeys = secrets.map((s) => s.secretKey).sort();
    expect(secretKeys).toEqual(["supabase-service-role-key"]);
    for (const secret of secrets) {
      // Server-only + private. The gateway / migration runner are the
      // only consumers; they never enter the browser bundle or any
      // Studio React state.
      expect(secret.consumption).toBe("server-only");
      expect(secret.exposure).toBe("private");
    }
  });

  it("SugarProfile contributes a designWorkspace under its plugin id", () => {
    const definition = getDiscoveredPluginDefinition(SUGARPROFILE_PLUGIN_ID);
    const workspaces = definition?.shell?.designWorkspaces ?? [];
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.workspaceKind).toBe(SUGARPROFILE_PLUGIN_ID);
    expect(workspaces[0]?.label).toBe("SugarProfile");
  });

  it("groupVersionTags skips orphan patches missing a v{N}.0.0 base", () => {
    // If someone hand-tagged v3.0.4 without ever creating v3.0.0,
    // the UI shouldn't render v3 as a major. The cut-major flow is
    // the only sanctioned way to create v3.0.0.
    expect(groupVersionTags(["v1.0.0", "v3.0.4"])).toEqual([
      { major: 1, baseTag: "v1.0.0", patches: [] }
    ]);
  });
});
