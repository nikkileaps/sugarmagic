import {
  createDeploymentRequirementId,
  type DeploymentRequirement
} from "@sugarmagic/domain";
import type { DiscoveredPluginDefinition } from "../../sdk";
import { createSugarAgentConversationProvider } from "./runtime/provider";
import type { SugarAgentPluginConfig } from "./runtime/types";
import type { RuntimePluginEnvironment } from "../../runtime";

export const SUGARAGENT_PLUGIN_ID = "sugaragent";

const deploymentRequirements: DeploymentRequirement[] = [
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "secret",
      key: "anthropic-api-key"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "secret",
    required: true,
    secretKey: "anthropic-api-key",
    consumption: "server-only",
    exposure: "private",
    mappingHint: "SUGARMAGIC_ANTHROPIC_API_KEY",
    description: "Server-side secret used for Anthropic generation requests.",
    tags: ["generation", "llm", "server"]
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "secret",
      key: "openai-api-key"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "secret",
    required: true,
    secretKey: "openai-api-key",
    consumption: "server-only",
    exposure: "private",
    mappingHint: "SUGARMAGIC_OPENAI_API_KEY",
    description: "Server-side secret used for OpenAI embeddings and vector retrieval.",
    tags: ["embeddings", "retrieval", "server"]
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "runtime-service",
      key: "game-api"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "runtime-service",
    required: true,
    serviceId: "game-api",
    executionModel: "request-response",
    isolation: "shared-allowed",
    resourceProfile: {
      tier: "medium",
      memoryInMb: 512,
      cpuUnits: 256
    },
    description: "Server-side request-response boundary for agent generation and retrieval."
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "proxy-route",
      key: "sugaragent-generate"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "proxy-route",
    required: true,
    routeId: "sugaragent-generate",
    protocol: "http-json",
    consumer: "browser-runtime",
    pathHint: "/api/sugaragent/generate",
    description: "Browser-to-backend generation route for SugarAgent turns."
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "proxy-route",
      key: "sugaragent-retrieve"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "proxy-route",
    required: true,
    routeId: "sugaragent-retrieve",
    protocol: "http-json",
    consumer: "browser-runtime",
    pathHint: "/api/sugaragent/retrieve",
    description: "Browser-to-backend retrieval route for SugarAgent evidence lookup."
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARAGENT_PLUGIN_ID,
      kind: "proxy-route",
      key: "sugaragent-lore"
    }),
    ownerId: SUGARAGENT_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "proxy-route",
    required: true,
    routeId: "sugaragent-lore",
    protocol: "http-json",
    consumer: "browser-runtime",
    pathHint: "/api/sugaragent/lore",
    description:
      "Browser-to-backend lore management route for page discovery and vector-store ingest."
  }
];

function readEnvValue(
  environment: RuntimePluginEnvironment | undefined,
  key: string
): string {
  return typeof environment?.[key] === "string" ? environment[key] ?? "" : "";
}

export function normalizeSugarAgentPluginConfig(
  config: Record<string, unknown> | null | undefined,
  environment?: RuntimePluginEnvironment
): SugarAgentPluginConfig {
  return {
    proxyBaseUrl:
      readEnvValue(environment, "SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL") ||
      (typeof config?.proxyBaseUrl === "string" ? config.proxyBaseUrl.trim() : ""),
    loreSourceKind:
      config?.loreSourceKind === "github"
        ? "github"
        : "local",
    loreLocalPath:
      typeof config?.loreLocalPath === "string" ? config.loreLocalPath.trim() : "",
    loreRepositoryUrl:
      typeof config?.loreRepositoryUrl === "string"
        ? config.loreRepositoryUrl.trim()
        : "",
    loreRepositoryRef:
      typeof config?.loreRepositoryRef === "string" && config.loreRepositoryRef.trim()
        ? config.loreRepositoryRef.trim()
        : "main",
    anthropicApiKey:
      readEnvValue(environment, "SUGARMAGIC_ANTHROPIC_API_KEY") ||
      (typeof config?.anthropicApiKey === "string" ? config.anthropicApiKey : ""),
    anthropicModel:
      readEnvValue(environment, "SUGARMAGIC_ANTHROPIC_MODEL") ||
      (typeof config?.anthropicModel === "string" && config.anthropicModel.trim()
        ? config.anthropicModel
        : "claude-sonnet-4-5"),
    openAiApiKey:
      readEnvValue(environment, "SUGARMAGIC_OPENAI_API_KEY") ||
      (typeof config?.openAiApiKey === "string" ? config.openAiApiKey : ""),
    openAiEmbeddingModel:
      readEnvValue(environment, "SUGARMAGIC_OPENAI_EMBEDDING_MODEL") ||
      (typeof config?.openAiEmbeddingModel === "string" &&
      config.openAiEmbeddingModel.trim()
        ? config.openAiEmbeddingModel
        : "text-embedding-3-small"),
    openAiVectorStoreId:
      readEnvValue(environment, "SUGARMAGIC_OPENAI_VECTOR_STORE_ID") ||
      (typeof config?.openAiVectorStoreId === "string"
        ? config.openAiVectorStoreId
        : ""),
    maxEvidenceResults:
      typeof config?.maxEvidenceResults === "number" &&
      Number.isFinite(config.maxEvidenceResults)
        ? Math.max(1, Math.min(8, Math.floor(config.maxEvidenceResults)))
        : 4,
    debugLogging: config?.debugLogging === true
  };
}

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARAGENT_PLUGIN_ID,
    displayName: "SugarAgent",
    summary: "Agentified NPC conversation provider with explicit turn stages.",
    capabilityIds: ["conversation.provider", "design.workspace"]
  },
  deploymentRequirements,
  defaultConfig: {
    loreSourceKind: "local",
    loreLocalPath: "",
    loreRepositoryUrl: "",
    loreRepositoryRef: "main",
    maxEvidenceResults: 4,
    debugLogging: false
  },
  runtime: {
    createRuntimePlugin: ({ configuration, environment }) => {
      const config = normalizeSugarAgentPluginConfig(
        configuration.config,
        environment
      );

      const missing: string[] = [];
      const usingProxy = config.proxyBaseUrl.trim().length > 0;
      if (!usingProxy && !config.anthropicApiKey.trim()) {
        missing.push("VITE_SUGARMAGIC_ANTHROPIC_API_KEY");
      }
      if (!usingProxy && !config.openAiApiKey.trim()) {
        missing.push("VITE_SUGARMAGIC_OPENAI_API_KEY");
      }
      if (!usingProxy && !config.openAiVectorStoreId.trim()) {
        missing.push("VITE_SUGARMAGIC_OPENAI_VECTOR_STORE_ID");
      }
      if (missing.length > 0) {
        throw new Error(
          `[sugaragent] SugarAgent plugin is enabled but required environment variables are missing: ${missing.join(", ")}. ` +
          `Add them to your .env file and restart the dev server.`
        );
      }

      return {
        pluginId: configuration.pluginId,
        displayName: "SugarAgent",
        init() {
          console.debug("[sugaragent] plugin:init", {
            pluginId: configuration.pluginId,
            transport: usingProxy ? "gateway" : "direct",
            gatewayBaseUrl: usingProxy ? config.proxyBaseUrl : null,
            stageLoggingEnabled:
              config.debugLogging || config.proxyBaseUrl.trim().length > 0,
            llmBackend: usingProxy
              ? "sugardeploy-gateway"
              : config.anthropicApiKey.trim()
                ? "anthropic"
                : "deterministic",
            embeddingsBackend: usingProxy
              ? "sugardeploy-gateway"
              : config.openAiApiKey.trim()
                ? "openai"
                : "none",
            vectorStoreBackend: usingProxy
              ? "sugardeploy-gateway"
              : config.openAiVectorStoreId.trim()
                ? "openai-hosted"
                : "none"
          });
        },
        contributions: [
          {
            pluginId: configuration.pluginId,
            contributionId: "sugaragent.conversation-provider",
            kind: "conversation.provider",
            displayName: "SugarAgent Conversation Provider",
            priority: 30,
            payload: {
              providerId: "sugaragent.provider",
              summary:
                "Agentified NPC provider with Interpret/Retrieve/Plan/Generate/Audit/Repair stages.",
              status: "ready",
              provider: createSugarAgentConversationProvider(config)
            }
          }
        ],
        serializeState: () => ({
          enabled: configuration.enabled,
          diagnostics: config.debugLogging
        }),
        dispose() {
          console.debug("[sugaragent] plugin:dispose", {
            pluginId: configuration.pluginId
          });
        }
      };
    }
  },
  shell: {
    designWorkspaces: [
      {
        pluginId: SUGARAGENT_PLUGIN_ID,
        workspaceKind: SUGARAGENT_PLUGIN_ID,
        label: "SugarAgent",
        icon: "🧠",
        summary: "Configure runtime backends and diagnostics for agentified NPC conversations."
      }
    ]
  }
};
