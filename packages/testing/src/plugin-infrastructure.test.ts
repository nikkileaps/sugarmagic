import { describe, expect, it } from "vitest";
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
  HELLO_PLUGIN_ID,
  resolveDeploymentAction,
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
  return {
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
  };
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
      HELLO_PLUGIN_ID,
      SUGARAGENT_PLUGIN_ID,
      SUGARDEPLOY_PLUGIN_ID,
      SUGARLANG_PLUGIN_ID
    ]);
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
      healthUrl: "http://localhost:9000/healthz"
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
