import {
  createDeploymentRequirementId,
  type DeploymentRequirement
} from "@sugarmagic/domain";
import type { DiscoveredPluginDefinition } from "../../sdk";
import {
  createSugarAgentConversationProvider,
  createSugarAgentVectorStoreProvider
} from "./runtime/provider";
import { createSugarAgentLogger } from "./runtime/logger";
import {
  createNpcMemoryMiddleware,
  NPC_MEMORY_MIDDLEWARE_ID
} from "./runtime/memory/memory-middleware";
import { installNpcMemoryDebugHandle } from "./runtime/memory/memory-debug";
import {
  createQuestContextMiddleware,
  QUEST_CONTEXT_MIDDLEWARE_ID
} from "./runtime/quest/quest-context-middleware";
import { installQuestContextDebugHandle } from "./runtime/quest/quest-context-debug";
import {
  createModerationMiddleware,
  MODERATION_MIDDLEWARE_ID
} from "./runtime/moderation/moderation-middleware";
import {
  SugarAgentGatewayModerationClient,
  SugarAgentGatewayModerationProvider
} from "./runtime/clients";
import type { SugarAgentPluginConfig } from "./runtime/types";
import type { RuntimePluginEnvironment } from "../../runtime";

export const SUGARAGENT_PLUGIN_ID = "sugaragent";

// Story 47.9.5 — gateway client classes are surfaced from the plugin
// root so behavioral tests (per-request token wiring) can construct
// them directly. The classes are runtime-only; nothing in Studio
// imports them.
export {
  SugarAgentGatewayLLMClient,
  SugarAgentGatewayVectorStoreClient,
  type BearerTokenGetter
} from "./runtime/clients";

// Plan 073 §073.1 — the plugin-owned NPC memory store. Surfaced from
// the plugin root so integration tests can drive it against the
// runtime identity registries directly; later stories wire it into
// the conversation lifecycle.
export {
  NpcMemoryStore,
  InMemoryNpcMemoryBackend,
  IndexedDBNpcMemoryBackend,
  migrateNpcMemoryRecord,
  NPC_MEMORY_SCHEMA_VERSION,
  type NpcMemoryRecord,
  type NpcMemoryBackend,
  type NpcMemoryStoreOptions,
  type DeterministicMemoryDelta,
  type SummaryMemoryDelta
} from "./runtime/memory/npc-memory-store";
export {
  resolveNpcMemoryStore,
  clearNpcMemoryStoreCacheForTests
} from "./runtime/memory/store-registry";
export {
  buildMemoryDigest,
  MEMORY_STATE_KEY,
  MEMORY_ANNOTATION_KEY,
  type MemoizedNpcMemory,
  type NpcMemoryAnnotation
} from "./runtime/memory/digest";

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
    description: "Server-side secret used for OpenAI vector store retrieval.",
    tags: ["retrieval", "server"]
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
    // vector store ids all live server-side now (the local SugarDeploy
    // gateway in dev; the deployed Cloud Run gateway in published-web).
    // They never enter SugarAgentPluginConfig.
    proxyBaseUrl:
      readEnvValue(environment, "SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL") ||
      (typeof config?.proxyBaseUrl === "string" ? config.proxyBaseUrl.trim() : ""),
    // Story 46.14 — bearer token plumbed through to the gateway
    // clients so they can attach `Authorization: Bearer <token>` on
    // every request when the gateway runs in `bearer` auth mode.
    // The env carries an empty string when the gateway is `none`.
    gatewayBearerToken: readEnvValue(
      environment,
      "SUGARMAGIC_GATEWAY_BEARER_TOKEN"
    ),
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
    // Story 46.15 — non-secret per-game gateway runtime config.
    // Empty string is OK; the gateway falls back to its own
    // defaults (or the bundled plugin defaults).
    openAiVectorStoreId:
      typeof config?.openAiVectorStoreId === "string"
        ? config.openAiVectorStoreId.trim()
        : "",
    anthropicModel:
      typeof config?.anthropicModel === "string"
        ? config.anthropicModel.trim()
        : "",
    anthropicSummaryModel:
      typeof config?.anthropicSummaryModel === "string"
        ? config.anthropicSummaryModel.trim()
        : "",
    maxEvidenceCharsPerItem:
      typeof config?.maxEvidenceCharsPerItem === "number" &&
      Number.isFinite(config.maxEvidenceCharsPerItem)
        ? Math.max(120, Math.min(4000, Math.floor(config.maxEvidenceCharsPerItem)))
        : 600,
    maxEvidenceResults:
      typeof config?.maxEvidenceResults === "number" &&
      Number.isFinite(config.maxEvidenceResults)
        ? Math.max(1, Math.min(8, Math.floor(config.maxEvidenceResults)))
        : 4,
    memoryEnabled: config?.memoryEnabled !== false,
    memoryDigestMaxChars:
      typeof config?.memoryDigestMaxChars === "number" &&
      Number.isFinite(config.memoryDigestMaxChars)
        ? Math.max(200, Math.min(2000, Math.floor(config.memoryDigestMaxChars)))
        : 800,
    questAwareNpcsEnabled: config?.questAwareNpcsEnabled !== false,
    debugLogging: config?.debugLogging === true,
    tone: typeof config?.tone === "string" ? config.tone.trim() : "",
    moderationEnabled: config?.moderationEnabled === true,
    blocklist: typeof config?.blocklist === "string" ? config.blocklist.trim() : ""
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
  // Story 46.16 — declarative schema Studio's auto-renderer turns
  // into the SugarAgent settings panel. Cross-references
  // gatewayRuntimeConfigKeys below; every runtime-config key has a
  // matching field here. The validator enforces this so a future
  // edit can't silently drop a UI surface for a gateway env var.
  pluginSettingsSchema: [
    {
      configKey: "loreSourceKind",
      label: "Source Kind",
      type: "select",
      group: "Lore Source",
      options: [
        { value: "local", label: "Local Checked-Out Repo" },
        { value: "github", label: "GitHub Repo (Planned)" }
      ],
      default: "local"
    },
    {
      configKey: "loreLocalPath",
      label: "Local Lore Repo Path",
      type: "text",
      group: "Lore Source",
      description:
        "Absolute path to the checked-out lore wiki repo. Save, then redeploy SugarDeploy so the local gateway mounts this path.",
      placeholder: "/Users/nikki/projects/world-lore",
      showWhen: { configKey: "loreSourceKind", equals: "local" }
    },
    {
      configKey: "loreRepositoryUrl",
      label: "Repository URL",
      type: "text",
      group: "Lore Source",
      placeholder: "https://github.com/you/world-lore",
      showWhen: { configKey: "loreSourceKind", equals: "github" }
    },
    {
      configKey: "loreRepositoryRef",
      label: "Repository Ref",
      type: "text",
      group: "Lore Source",
      placeholder: "main",
      showWhen: { configKey: "loreSourceKind", equals: "github" }
    },
    {
      configKey: "openAiVectorStoreId",
      label: "OpenAI Vector Store ID",
      type: "text",
      group: "Gateway Runtime Config",
      description:
        "Which OpenAI vector store the gateway queries for evidence retrieval. Pure identifier; not a credential.",
      placeholder: "vs_abcd1234..."
    },
    {
      configKey: "anthropicModel",
      label: "Anthropic Dialogue Model",
      type: "text",
      group: "Gateway Runtime Config",
      description:
        "Model the gateway uses for NPC dialogue turns. Applied at deploy (redeploy to change; nothing to hand-edit). Empty = claude-haiku-4-5.",
      placeholder: "claude-sonnet-4-5"
    },
    {
      configKey: "anthropicSummaryModel",
      label: "Anthropic Summary Model",
      type: "text",
      group: "Gateway Runtime Config",
      description:
        "Model for the end-of-conversation NPC memory summary — a cheap background task, keep it smaller/faster than the dialogue model. Applied at deploy. Empty = claude-haiku-4-5.",
      placeholder: "claude-haiku-4-5"
    },
    {
      configKey: "maxEvidenceResults",
      label: "Max Evidence Results",
      type: "number",
      group: "Runtime Behavior",
      default: 4,
      min: 1,
      max: 8
    },
    {
      configKey: "maxEvidenceCharsPerItem",
      label: "Max Evidence Chars / Item",
      type: "number",
      group: "Runtime Behavior",
      default: 600,
      min: 120,
      max: 4000
    },
    {
      configKey: "memoryEnabled",
      label: "NPC Memory",
      type: "boolean",
      group: "Runtime Behavior",
      default: true,
      description:
        "When on, NPCs remember players across conversations and greet them as acquaintances on repeat visits. Off = every conversation starts fresh."
    },
    {
      configKey: "memoryDigestMaxChars",
      label: "Memory Digest Size Cap",
      type: "number",
      group: "Runtime Behavior",
      default: 800,
      min: 200,
      max: 2000
    },
    {
      configKey: "questAwareNpcsEnabled",
      label: "Quest-Aware NPCs",
      type: "boolean",
      group: "Runtime Behavior",
      default: true,
      description:
        "When on, NPCs receive world-framed quest context and participate in the goal-surfaced blackboard. Off = pre-077 behavior."
    },
    {
      configKey: "debugLogging",
      label: "Structured Debug Logging",
      type: "boolean",
      group: "Runtime Behavior",
      default: false
    },
    {
      configKey: "tone",
      label: "Tone",
      type: "text",
      group: "Runtime Behavior",
      description:
        "Overall tone for NPC dialogue (e.g. cozy, gritty, whimsical). Leave empty for no tone directive."
    },
    {
      configKey: "moderationEnabled",
      label: "Content Moderation",
      type: "boolean",
      group: "Safety",
      default: false,
      description:
        "When on, player input and NPC output are checked against the OpenAI moderation API before reaching the player. Fail-open: a moderation outage never silences NPCs."
    },
    {
      configKey: "blocklist",
      label: "Topic Blocklist",
      type: "text",
      group: "Safety",
      description:
        "Comma-separated terms the gateway refuses at the input layer (pre-moderation) and as defense-in-depth inside the /generate handler. Hotfix via the sugardeploy update-blocklist action -- no rebuild needed.",
      placeholder: "jailbreak,ignore instructions,forget everything"
    }
  ],
  // Story 46.15 — per-game non-secret gateway runtime env vars.
  // Values come from the matching keys in the plugin's per-game
  // config slot (`pluginConfigurations[sugaragent].config.*`);
  // SugarDeploy plumbs them through deploy.sh + the GHA workflow
  // to Cloud Run at deploy time.
  gatewayRuntimeConfigKeys: [
    {
      configKey: "openAiVectorStoreId",
      envVarName: "SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID",
      description:
        "OpenAI vector store id the SugarAgent gateway queries when the browser doesn't send one explicitly.",
      nonSecretAttestation: "safe-to-expose-publicly"
    },
    {
      configKey: "anthropicModel",
      envVarName: "SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL",
      description:
        "Anthropic model the gateway uses for NPC dialogue turns (e.g., `claude-sonnet-4-5`).",
      nonSecretAttestation: "safe-to-expose-publicly"
    },
    {
      configKey: "anthropicSummaryModel",
      envVarName: "SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL",
      description:
        "Anthropic model the gateway uses for the cheap end-of-conversation NPC memory summary (Plan 073.2). Resolved server-side from purpose:\"summary\" requests.",
      nonSecretAttestation: "safe-to-expose-publicly"
    },
    {
      configKey: "blocklist",
      envVarName: "SUGARMAGIC_SUGARAGENT_BLOCKLIST",
      description:
        "Comma-separated terms the gateway refuses at the /moderate and /generate layers. Hotfixable via the sugardeploy update-blocklist action (no image rebuild needed).",
      nonSecretAttestation: "safe-to-expose-publicly"
    }
  ],
  defaultConfig: {
    loreSourceKind: "local",
    loreLocalPath: "",
    loreRepositoryUrl: "",
    loreRepositoryRef: "main",
    openAiVectorStoreId: "",
    anthropicModel: "",
    anthropicSummaryModel: "",
    maxEvidenceResults: 4,
    maxEvidenceCharsPerItem: 600,
    memoryEnabled: true,
    memoryDigestMaxChars: 800,
    questAwareNpcsEnabled: true,
    debugLogging: false,
    tone: "",
    moderationEnabled: false,
    blocklist: ""
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
          `SugarAgent always routes through a proxy (the local SugarDeploy ` +
          `gateway in dev; the deployed Cloud Run gateway in published- ` +
          `web). In Studio: confirm the repo-root .env carries ` +
          `VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL or ` +
          `VITE_SUGARMAGIC_GATEWAY_URL. In published-web: confirm the GHA ` +
          `deploy-frontend job's "Resolve Cloud Run gateway URL" step ` +
          `succeeded and that the resulting VITE_SUGARMAGIC_GATEWAY_URL ` +
          `was set on the engine build step. See the plugin SDK docs for ` +
          `the proxy-URL contract.`
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
          // Plan 073.5 — dev-only memory inspection handle (window.__sugaragentMemory).
          installNpcMemoryDebugHandle();
          // Plan 077.5 — dev-only quest-context inspection handle (window.__sugaragentQuestContext).
          if (config.questAwareNpcsEnabled) installQuestContextDebugHandle();
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
          },
          // Plan 073.3 — context-stage middleware that loads NPC memory once
          // per conversation, memoizes record + digest in execution.state, and
          // annotates metCount/first-meeting for the provider, the stages, and
          // (073.4) sugarlang's minimal-greeting policy.
          {
            pluginId: configuration.pluginId,
            contributionId: "sugaragent.memory-middleware",
            kind: "conversation.middleware",
            displayName: "SugarAgent NPC Memory",
            priority: 10,
            payload: {
              middlewareId: NPC_MEMORY_MIDDLEWARE_ID,
              summary:
                "Loads NPC memory once per conversation; memoizes the digest for the prompt and annotates first-meeting.",
              stage: "context" as const,
              status: "ready" as const,
              middleware: createNpcMemoryMiddleware({
                logger: createSugarAgentLogger(config.debugLogging),
                enabled: config.memoryEnabled,
                digestMaxChars: config.memoryDigestMaxChars
              })
            }
          },
          // Plan 075.3 -- policy-stage middleware: moderates player input
          // (prepare) and NPC output (finalize) via the /moderate gateway
          // route. Fail-open: a moderation outage never silences NPCs.
          // Gated by moderationEnabled (off by default to avoid surprise
          // latency for games that don't need it).
          ...(config.moderationEnabled
            ? [
                {
                  pluginId: configuration.pluginId,
                  contributionId: "sugaragent.moderation-middleware",
                  kind: "conversation.middleware" as const,
                  displayName: "SugarAgent Content Moderation",
                  priority: 20,
                  payload: {
                    middlewareId: MODERATION_MIDDLEWARE_ID,
                    summary:
                      "Checks player input and NPC output against the OpenAI moderation API; replaces flagged text with an in-character deflection.",
                    stage: "policy" as const,
                    status: "ready" as const,
                    middleware: createModerationMiddleware({
                      moderationProvider: new SugarAgentGatewayModerationProvider(
                        new SugarAgentGatewayModerationClient(
                          config.proxyBaseUrl,
                          async () => config.gatewayBearerToken || null
                        )
                      ),
                      enabled: true
                    })
                  }
                }
              ]
            : []),
          // Plan 077.2 -- context-stage middleware that resolves quest-relevant
          // world lore once per quest-state (D3), memoizes it, and annotates
          // questWorldContext for the prompt builder (D2 prompt invariant: the
          // objective displayName/description seeds retrieval only, never in the
          // prompt). Gated by questAwareNpcsEnabled (077.5); when off, NPCs
          // behave as pre-077 (no world-framed context, no ease-off blackboard).
          ...(config.questAwareNpcsEnabled
            ? [
                {
                  pluginId: configuration.pluginId,
                  contributionId: "sugaragent.quest-context-middleware",
                  kind: "conversation.middleware" as const,
                  displayName: "SugarAgent Quest Context",
                  priority: 15,
                  payload: {
                    middlewareId: QUEST_CONTEXT_MIDDLEWARE_ID,
                    summary:
                      "Resolves quest-relevant world lore once per quest-state; supplies world-framed context to NPC dialogue without leaking the player's private objective.",
                    stage: "context" as const,
                    status: "ready" as const,
                    middleware: createQuestContextMiddleware({
                      vectorStoreProvider: createSugarAgentVectorStoreProvider(config),
                      logger: createSugarAgentLogger(config.debugLogging)
                    })
                  }
                }
              ]
            : [])
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
