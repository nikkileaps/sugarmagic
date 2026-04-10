import { createUuid } from "@sugarmagic/domain";
import type {
  ConversationExecutionContext,
  ConversationProvider,
  ConversationProviderContext,
  ConversationProviderSession,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import {
  AnthropicClient,
  AnthropicLLMProvider,
  OpenAIEmbeddingsClient,
  OpenAIEmbeddingsProvider,
  OpenAIVectorStoreClient,
  OpenAIVectorStoreProvider,
  SugarAgentGatewayEmbeddingsClient,
  SugarAgentGatewayEmbeddingsProvider,
  SugarAgentGatewayLLMClient,
  SugarAgentGatewayLLMProvider,
  SugarAgentGatewayVectorStoreClient,
  SugarAgentGatewayVectorStoreProvider,
  type EmbeddingsProvider,
  type LLMProvider,
  type VectorStoreProvider
} from "./clients";
import { createSugarAgentLogger, type SugarAgentLogger } from "./logger";
import {
  AuditStage,
  GenerateStage,
  InterpretStage,
  PlanStage,
  RepairStage,
  RetrieveStage
} from "./stages";
import { buildTerminalFallbackReply } from "./stages/helpers";
import type {
  SugarAgentPluginConfig,
  SugarAgentProviderState,
  TurnStage,
  TurnStageContext,
  TurnStageDiagnostics
} from "./types";

const SUGARAGENT_PROVIDER_ID = "sugaragent.provider";
const SUGARAGENT_STATE_KEY = "sugaragent.session";

function isAgentSelection(selection: ConversationProviderContext["selection"]): boolean {
  return (
    selection.conversationKind === "free-form" &&
    typeof selection.npcDefinitionId === "string"
  );
}

function ensureProviderState(
  stateContainer: Record<string, unknown>
): SugarAgentProviderState {
  const existing = stateContainer[SUGARAGENT_STATE_KEY];
  if (
    existing &&
    typeof existing === "object" &&
    Array.isArray((existing as SugarAgentProviderState).history)
  ) {
    return existing as SugarAgentProviderState;
  }

  const next: SugarAgentProviderState = {
    sessionId: createUuid(),
    turnCount: 0,
    consecutiveFallbackTurns: 0,
    closeRequested: false,
    history: [],
    topicCoverage: [],
    referents: [],
    lastTurnDiagnostics: {}
  };
  stateContainer[SUGARAGENT_STATE_KEY] = next;
  return next;
}

function normalizeHistoryText(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 800);
}

function pushHistoryEntry(
  state: SugarAgentProviderState,
  role: "user" | "assistant",
  text: string
) {
  const normalized = normalizeHistoryText(text);
  if (!normalized) return;
  state.history.push({ role, text: normalized });
  state.history = state.history.slice(-12);
}

function isStalledTurn(
  diagnostics: Record<string, TurnStageDiagnostics>,
  hasUserInput: boolean
): boolean {
  if (!hasUserInput) {
    return false;
  }
  const degradedStages = Object.values(diagnostics).filter(
    (stage) => stage.status === "degraded"
  );
  const hasRealDegradedFallback = degradedStages.some(
    (stage) => stage.fallbackReason && stage.fallbackReason !== "generic-only-policy"
  );
  if (hasRealDegradedFallback) {
    return true;
  }

  const responseSpecificity = diagnostics.Plan?.payload?.responseSpecificity;
  const responseIntent = diagnostics.Plan?.payload?.responseIntent;
  const turnPath = diagnostics.Plan?.payload?.turnPath;
  if (
    responseSpecificity === "generic-only" &&
    !(turnPath === "social_fast" && responseIntent === "chat")
  ) {
    return true;
  }

  return responseIntent === "clarify";
}

function shouldAutoCloseAfterTurn(
  diagnostics: Record<string, TurnStageDiagnostics>,
  actionProposals: ConversationTurnEnvelope["proposedActions"] | undefined
): boolean {
  const hasCloseProposal = Boolean(
    actionProposals?.some((proposal) => proposal.kind === "request-close")
  );
  if (!hasCloseProposal) {
    return false;
  }

  return diagnostics.Generate?.fallbackReason === "llm-retry-exhausted";
}

async function runStage<TInput, TOutput>(
  stage: TurnStage<TInput, TOutput>,
  input: TInput,
  context: TurnStageContext
): Promise<{
  output: TOutput;
  diagnostics: TurnStageDiagnostics;
}> {
  context.logStageStart(stage.stageId, {
    turnId: context.turnId,
    sessionId: context.sessionId
  });
  const result = await stage.execute(input, context);
  context.logStageEnd(result.diagnostics);
  return {
    output: result.output,
    diagnostics: result.diagnostics
  };
}

function createTurnContext(
  selection: ConversationProviderContext["selection"],
  config: SugarAgentPluginConfig,
  state: SugarAgentProviderState,
  logger: SugarAgentLogger
): TurnStageContext {
  const turnId = createUuid();
  return {
    turnId,
    sessionId: state.sessionId,
    pluginId: "sugaragent",
    selection,
    config,
    logStageStart(stageId, payload) {
      logger.logStageStart(stageId, {
        ...payload,
        pluginId: "sugaragent",
        providerId: SUGARAGENT_PROVIDER_ID,
        npcDefinitionId: selection.npcDefinitionId ?? null,
        interactionMode: selection.interactionMode ?? null
      });
    },
    logStageEnd(diagnostics) {
      logger.logStageEnd({
        ...diagnostics,
        pluginId: "sugaragent",
        providerId: SUGARAGENT_PROVIDER_ID,
        npcDefinitionId: selection.npcDefinitionId ?? null
      });
    }
  };
}

function resolveProviders(
  config: SugarAgentPluginConfig,
  logger: SugarAgentLogger
): {
  llmProvider: LLMProvider | null;
  embeddingsProvider: EmbeddingsProvider | null;
  vectorStoreProvider: VectorStoreProvider | null;
} {
  if (config.proxyBaseUrl.trim()) {
    return {
      llmProvider: new SugarAgentGatewayLLMProvider(
        new SugarAgentGatewayLLMClient(config.proxyBaseUrl.trim())
      ),
      embeddingsProvider: new SugarAgentGatewayEmbeddingsProvider(
        new SugarAgentGatewayEmbeddingsClient(config.proxyBaseUrl.trim())
      ),
      vectorStoreProvider: new SugarAgentGatewayVectorStoreProvider(
        new SugarAgentGatewayVectorStoreClient(config.proxyBaseUrl.trim())
      )
    };
  }

  const llmProvider =
    config.anthropicApiKey.trim() && config.anthropicModel.trim()
      ? new AnthropicLLMProvider(new AnthropicClient(config.anthropicApiKey.trim()))
      : null;
  if (!llmProvider) {
    logger.logFallback("generation-provider", {
      reason: "anthropic-not-configured"
    });
  }

  const embeddingsProvider =
    config.openAiApiKey.trim() && config.openAiEmbeddingModel.trim()
      ? new OpenAIEmbeddingsProvider(
          new OpenAIEmbeddingsClient(config.openAiApiKey.trim())
        )
      : null;
  if (!embeddingsProvider) {
    logger.logFallback("embeddings-provider", {
      reason: "openai-embeddings-not-configured"
    });
  }

  const vectorStoreProvider =
    config.openAiApiKey.trim() && config.openAiVectorStoreId.trim()
      ? new OpenAIVectorStoreProvider(
          new OpenAIVectorStoreClient(config.openAiApiKey.trim())
        )
      : null;
  if (!vectorStoreProvider) {
    logger.logFallback("vector-store-provider", {
      reason: "vector-store-not-configured"
    });
  }

  return {
    llmProvider,
    embeddingsProvider,
    vectorStoreProvider
  };
}

async function executePipeline(args: {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
  config: SugarAgentPluginConfig;
  logger: SugarAgentLogger;
  stages: {
    interpret: InterpretStage;
    retrieve: RetrieveStage;
    plan: PlanStage;
    generate: GenerateStage;
    audit: AuditStage;
    repair: RepairStage;
  };
}): Promise<ConversationTurnEnvelope> {
  const { execution, state, config, logger, stages } =
    args;
  const context = createTurnContext(execution.selection, config, state, logger);
  const activeQuestDisplayName =
    execution.runtimeContext?.trackedQuest?.displayName ??
    execution.selection.activeQuest?.displayName ??
    null;

  const { output: interpret, diagnostics: interpretDiagnostics } = await runStage(
    stages.interpret,
    { execution, state },
    context
  );
  if (interpret.userText) {
    pushHistoryEntry(state, "user", interpret.userText);
  }

  const { output: retrieve, diagnostics: retrieveDiagnostics } = await runStage(
    stages.retrieve,
    { execution, interpret },
    context
  );
  const { output: plan, diagnostics: planDiagnostics } = await runStage(
    stages.plan,
    { execution, state, interpret, retrieve },
    context
  );

  const { output: generate, diagnostics: generateDiagnostics } = await runStage(
    stages.generate,
    { execution, state, interpret, retrieve, plan },
    context
  );
  if (generate.envelopeOverride) {
    state.turnCount += 1;
    state.lastTurnDiagnostics = {
      Interpret: interpretDiagnostics,
      Retrieve: retrieveDiagnostics,
      Plan: planDiagnostics,
      Generate: generateDiagnostics
    };
    state.consecutiveFallbackTurns = 0;
    state.closeRequested = Boolean(
      generate.envelopeOverride.proposedActions?.some(
        (proposal) =>
          proposal.kind === "request-close" ||
          proposal.kind === "start-scripted-followup"
      )
    );
    pushHistoryEntry(state, "assistant", generate.envelopeOverride.text);

    return {
      ...generate.envelopeOverride,
      diagnostics: {
        ...(generate.envelopeOverride.diagnostics ?? {}),
        stages: state.lastTurnDiagnostics,
        turnCount: state.turnCount,
        historyLength: state.history.length,
        llmBackend: generate.llmBackend,
        consecutiveFallbackTurns: state.consecutiveFallbackTurns
      }
    };
  }
  const { output: audit, diagnostics: auditDiagnostics } = await runStage(
    stages.audit,
    { execution, generate, plan },
    context
  );
  const { output: repair, diagnostics: repairDiagnostics } = await runStage(
    stages.repair,
    { execution, interpret, retrieve, plan, generate, audit },
    context
  );

  state.turnCount += 1;
  state.lastTurnDiagnostics = {
    Interpret: interpretDiagnostics,
    Retrieve: retrieveDiagnostics,
    Plan: planDiagnostics,
    Generate: generateDiagnostics,
    Audit: auditDiagnostics,
    Repair: repairDiagnostics
  };
  state.consecutiveFallbackTurns = isStalledTurn(
    state.lastTurnDiagnostics,
    Boolean(interpret.userText)
  )
    ? state.consecutiveFallbackTurns + 1
    : 0;

  let finalText = repair.text;
  let finalActionProposals = repair.actionProposals;
  let finalLlmBackend = repair.llmBackend;
  let autoCloseAfterMs: number | null = null;

  if (state.consecutiveFallbackTurns >= 3) {
    finalText = buildTerminalFallbackReply({
      interpret,
      activeQuestDisplayName
    });
    finalActionProposals = [
      ...repair.actionProposals.filter((proposal) => proposal.kind !== "request-close"),
      { kind: "request-close" }
    ];
    finalLlmBackend = "deterministic";
    autoCloseAfterMs = 2200;
  }

  if (
    autoCloseAfterMs === null &&
    shouldAutoCloseAfterTurn(state.lastTurnDiagnostics, finalActionProposals)
  ) {
    autoCloseAfterMs = 2200;
  }

  state.closeRequested =
    interpret.shouldCloseAfterReply ||
    finalActionProposals.some(
      (proposal) =>
        proposal.kind === "request-close" ||
        proposal.kind === "start-scripted-followup"
    );
  pushHistoryEntry(state, "assistant", finalText);

  return {
    turnId: context.turnId,
    providerId: SUGARAGENT_PROVIDER_ID,
    conversationKind: execution.selection.conversationKind,
    speakerId: execution.selection.npcDefinitionId,
    speakerLabel: execution.selection.npcDisplayName,
    displayName: execution.selection.npcDisplayName,
    text: finalText,
    choices: [],
    inputMode: state.closeRequested ? "advance" : plan.replyInputMode,
    inputPlaceholder: state.closeRequested ? "" : plan.replyPlaceholder,
    proposedActions: finalActionProposals,
    metadata:
      autoCloseAfterMs !== null
        ? { autoCloseAfterMs }
        : undefined,
    diagnostics: {
      stages: state.lastTurnDiagnostics,
      turnCount: state.turnCount,
      historyLength: state.history.length,
      llmBackend: finalLlmBackend,
      consecutiveFallbackTurns: state.consecutiveFallbackTurns
    }
  };
}

export function createSugarAgentConversationProvider(
  config: SugarAgentPluginConfig
): ConversationProvider {
  const logger = createSugarAgentLogger(
    config.debugLogging || config.proxyBaseUrl.trim().length > 0
  );
  const { llmProvider, embeddingsProvider, vectorStoreProvider } = resolveProviders(
    config,
    logger
  );
  const stages = {
    interpret: new InterpretStage(),
    retrieve: new RetrieveStage(embeddingsProvider, vectorStoreProvider),
    plan: new PlanStage(),
    generate: new GenerateStage(llmProvider),
    audit: new AuditStage(),
    repair: new RepairStage()
  };

  logger.logPluginEvent("provider-registered", {
    providerId: SUGARAGENT_PROVIDER_ID,
    llmBackend: llmProvider ? "anthropic" : "deterministic",
    embeddingsBackend: embeddingsProvider ? "openai" : "none",
    vectorStoreBackend: vectorStoreProvider ? "openai-hosted" : "none"
  });

  return {
    providerId: SUGARAGENT_PROVIDER_ID,
    displayName: "SugarAgent",
    priority: 30,
    canHandle(selection) {
      return isAgentSelection(selection);
    },
    async startSession(context) {
      if (!isAgentSelection(context.selection)) {
        return null;
      }

      logger.logPluginEvent("mounted", {
        npcDefinitionId: context.selection.npcDefinitionId,
        interactionMode: context.selection.interactionMode ?? null
      });

      const state = ensureProviderState(context.execution.state);
      const session: ConversationProviderSession = {
        advance: async (input, execution) => {
          const providerState = ensureProviderState(execution.state);
          if (providerState.closeRequested) {
            providerState.closeRequested = false;
            return null;
          }
          return executePipeline({
            execution: {
              ...execution,
              input
            },
            state: providerState,
            config,
            logger,
            stages
          });
        },
        dispose: () => {
          logger.logPluginEvent("unmounted", {
            npcDefinitionId: context.selection.npcDefinitionId,
            sessionId: state.sessionId
          });
        }
      };

      const initialTurn = await executePipeline({
        execution: context.execution,
        state,
        config,
        logger,
        stages
      });
      return {
        session,
        initialTurn
      };
    }
  };
}
