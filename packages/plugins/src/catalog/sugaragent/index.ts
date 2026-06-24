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
    // Story 46.14 — only the proxy URL crosses the plugin/runtime
    // boundary. Anthropic / OpenAI API keys + model identifiers +
    // vector store ids all live server-side now (Studio's vite
    // middleware in dev; the deployed Cloud Run gateway in
    // published-web). They never enter SugarAgentPluginConfig.
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
    maxEvidenceResults:
      typeof config?.maxEvidenceResults === "number" &&
      Number.isFinite(config.maxEvidenceResults)
        ? Math.max(1, Math.min(8, Math.floor(config.maxEvidenceResults)))
        : 4,
    debugLogging: config?.debugLogging === true,
    tone: typeof config?.tone === "string" ? config.tone.trim() : ""
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
    debugLogging: false,
    tone: ""
  },
  runtime: {
    createRuntimePlugin: ({ configuration, environment }) => {
      const config = normalizeSugarAgentPluginConfig(
        configuration.config,
        environment
      );

      // Story 46.14 — SugarAgent always routes through a proxy. In
      // Studio dev the proxy is vite's middleware; in published-web
      // it's the deployed Cloud Run gateway. The runtime environment
      // is responsible for providing SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL
      // (auto-defaults to SUGARMAGIC_GATEWAY_URL when not overridden).
      if (!config.proxyBaseUrl.trim()) {
        throw new Error(
          `[sugaragent] SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL is not set. ` +
          `SugarAgent always routes through a proxy (Studio's vite ` +
          `middleware in dev; the deployed Cloud Run gateway in published- ` +
          `web). In Studio: confirm the repo-root .env carries ` +
          `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL or ` +
          `VITE_SUGARMAGIC_GATEWAY_URL. In published-web: confirm the ` +
          `Build Frontend host action injected the gateway URL at build ` +
          `time. See the plugin SDK docs for the proxy-URL contract.`
        );
      }

      return {
        pluginId: configuration.pluginId,
        displayName: "SugarAgent",
        init() {
          console.debug("[sugaragent] plugin:init", {
            pluginId: configuration.pluginId,
            transport: "proxy",
            proxyBaseUrl: config.proxyBaseUrl,
            stageLoggingEnabled: config.debugLogging
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
    npcInteractionOptions: [
      {
        pluginId: SUGARAGENT_PLUGIN_ID,
        interactionMode: "agent",
        label: "Agent",
        summary: "Free-form grounded conversation through SugarAgent."
      }
    ],
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
