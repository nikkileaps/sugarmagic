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
  collectSecretEnvBindings,
  isValidGcpProjectId,
  isValidGcpServiceAccountId,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  parseBillingAccountList,
  parseTemplateVersionStamp,
  resolveDeploymentAction,
  resolveSecretManagerName,
  stripBillingAccountPrefix,
  stripGithubRepoPrefixes,
  SUGARAGENT_PLUGIN_ID,
  SUGARDEPLOY_PLUGIN_ID,
  SUGARLANG_PLUGIN_ID,
  getDiscoveredPluginDefinition,
  listDiscoveredPluginDefinitions,
  listDeploymentTargets,
  normalizeHelloPluginConfig,
  normalizeSugarAgentPluginConfig,
  listBundledRuntimePluginIds,
  planGameDeployment
} from "@sugarmagic/plugins";
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

  it("lists only actually installed plugins in the app registry", () => {
    expect(listDiscoveredPluginDefinitions().map((plugin) => plugin.manifest.pluginId)).toEqual([
      FIREFLIES_PLUGIN_ID,
      HELLO_PLUGIN_ID,
      SUGARAGENT_PLUGIN_ID,
      SUGARDEPLOY_PLUGIN_ID,
      SUGARLANG_PLUGIN_ID
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
    // SugarDeploy contributes five middleware plugins:
    // - action dispatcher (/__sugardeploy/action)
    // - billing list (/__sugardeploy/list-billing-accounts)
    // - GCP project lifecycle (/__sugardeploy/probe-gcp-project + /create-gcp-project)
    // - set-secret-value (/__sugardeploy/set-secret-value, story 45.5)
    // - secret-status (/__sugardeploy/secret-status, story 45.5)
    expect(contributedPlugins.map((plugin) => plugin.name).sort()).toEqual([
      "sugardeploy-gcp-billing-list",
      "sugardeploy-gcp-project-lifecycle",
      "sugardeploy-host-actions",
      "sugardeploy-secret-status",
      "sugardeploy-set-secret-value"
    ]);
  });

  it("only SugarDeploy contributes host middleware in the current registry", () => {
    // 45.4.6 exit signal: SugarLang, SugarAgent, Fireflies, Hello don't
    // shell out to host binaries and shouldn't grow a hostMiddleware
    // contribution accidentally. Future plugins that need one update this
    // test along with their definition.
    const idsWithHostMiddleware = listDiscoveredPluginDefinitions()
      .filter((definition) => definition.hostMiddleware != null)
      .map((definition) => definition.manifest.pluginId);
    expect(idsWithHostMiddleware).toEqual([SUGARDEPLOY_PLUGIN_ID]);
  });

  it("lists SugarDeploy deployment targets with local as the implemented baseline", () => {
    expect(listDeploymentTargets()).toEqual([
      {
        targetId: "aws-fargate",
        displayName: "AWS Fargate",
        summary: "Hosted deployment target for ECS/Fargate style service topology.",
        implemented: false
      },
      {
        targetId: "google-cloud-run",
        displayName: "Google Cloud Run",
        summary: "Hosted deployment target for Cloud Run services and managed proxy topology.",
        implemented: true
      },
      {
        targetId: "local",
        displayName: "Local",
        summary:
          "Local same-origin deployment target with generated proxy and service scaffolding.",
        implemented: true
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

  it("plans local deployment outputs for enabled plugin requirements when a target is selected", () => {
    const withoutTarget = planGameDeployment(makeProject());
    expect(withoutTarget.managedFiles).toEqual([]);
    expect(withoutTarget.status).toBe("warning");

    const withTarget = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          publishTargetId: "web",
          deploymentTargetId: "local"
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
    ).toContain("SUGARMAGIC_ANTHROPIC_MODEL=claude-sonnet-4-5");
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
          targetOverrides: {
            "google-cloud-run": {
              projectId: "demo-project",
              region: "us-west1",
              serviceNamePrefix: "wordlark-api",
              minInstances: 1,
              maxInstances: 3,
              ingress: "internal",
              allowUnauthenticated: false
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
      ingress: "internal",
      allowUnauthenticated: false
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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

  it("normalizeGameProject defaults missing versionedProjectIdentifiers to {} and filters corrupt entries", () => {
    // 45.4.7 — older project files load with the field missing (back-compat).
    const projectMissingField = normalizeGameProject({
      ...makeProject(),
      versionedProjectIdentifiers: undefined
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(projectMissingField.versionedProjectIdentifiers).toEqual({});

    // Corrupt entries (bad keys, non-string values, wrong-length suffixes)
    // get filtered out silently — load shouldn't fail on bad persisted data,
    // but the bad entries don't make it into the canonical model either.
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
    expect(projectWithJunk.versionedProjectIdentifiers).toEqual({
      v1: "k3m9p",
      v5: "12345"
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
    // 45.5.7 bumped to v2 for the org policy + project IAM additions.
    expect(mainTf?.content).toContain("# SUGARMAGIC TEMPLATE VERSION: 2");
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: null,
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
            publishTargetId: "web",
            deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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
          publishTargetId: "web",
          deploymentTargetId: "local",
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run",
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

  it("resolves local deployment actions from target overrides", () => {
    const plan = planGameDeployment(
      normalizeGameProject({
        ...makeProject(),
        deployment: {
          publishTargetId: "web",
          deploymentTargetId: "local",
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
        command: "docker",
        args: ["compose", "up", "--build", "-d"],
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
          publishTargetId: "web",
          deploymentTargetId: "google-cloud-run"
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
    expect(
      normalizeSugarAgentPluginConfig({
        debugLogging: true,
        maxEvidenceResults: 99
      })
    ).toEqual({
      proxyBaseUrl: "",
      loreSourceKind: "local",
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      anthropicApiKey: "",
      anthropicModel: "claude-sonnet-4-5",
      openAiApiKey: "",
      openAiEmbeddingModel: "text-embedding-3-small",
      openAiVectorStoreId: "",
      maxEvidenceResults: 8,
      debugLogging: true,
      tone: ""
    });
  });

  it("normalizes sugaragent proxy mode from environment and does not require direct vendor keys", () => {
    expect(
      normalizeSugarAgentPluginConfig(
        {},
        {
          SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL: "http://localhost:8787"
        }
      )
    ).toEqual({
      proxyBaseUrl: "http://localhost:8787",
      loreSourceKind: "local",
      loreLocalPath: "",
      loreRepositoryUrl: "",
      loreRepositoryRef: "main",
      anthropicApiKey: "",
      anthropicModel: "claude-sonnet-4-5",
      openAiApiKey: "",
      openAiEmbeddingModel: "text-embedding-3-small",
      openAiVectorStoreId: "",
      maxEvidenceResults: 4,
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
});
