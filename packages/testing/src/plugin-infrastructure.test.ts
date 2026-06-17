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
  HELLO_PLUGIN_ID,
  parseTemplateVersionStamp,
  resolveDeploymentAction,
  resolveSecretManagerName,
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
    expect(mainTf?.content).toContain("# SUGARMAGIC TEMPLATE VERSION: 1");
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

  it("defaults missing majorVersion to 1 on load via normalizeGameProject", () => {
    const projectMissingField = normalizeGameProject({
      ...makeProject(),
      // intentionally drop majorVersion — older project.sgrmagic files lack it
      majorVersion: undefined
    } as unknown as Parameters<typeof normalizeGameProject>[0]);
    expect(projectMissingField.majorVersion).toBe(1);
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
