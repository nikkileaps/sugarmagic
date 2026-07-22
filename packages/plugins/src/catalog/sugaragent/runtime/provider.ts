import { createUuid } from "@sugarmagic/domain";
import {
  getActiveAccessToken,
  type ConversationExecutionContext,
  type ConversationProvider,
  type ConversationProviderContext,
  type ConversationProviderSession,
  type ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import {
  // Story 46.14 — only the gateway-routed providers remain; direct-API
  // client classes were deleted because the browser-side SugarAgent
  // never reads raw Anthropic / OpenAI keys (they live server-side, in
  // the local SugarDeploy gateway (dev) or the deployed Cloud Run gateway).
  SugarAgentGatewayLLMClient,
  SugarAgentGatewayLLMProvider,
  SugarAgentGatewayLoreClient,
  SugarAgentGatewayPersonaProvider,
  SugarAgentGatewayVectorStoreClient,
  SugarAgentGatewayVectorStoreProvider,
  type BearerTokenGetter,
  type LLMProvider,
  type PersonaLoader,
  type VectorStoreProvider
} from "./clients";
import { createSugarAgentLogger, type SugarAgentLogger } from "./logger";
import { summarizeConversationAtDispose } from "./memory/conversation-summarizer";
import { resolveNpcMemoryStore } from "./memory/store-registry";
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
    transcript: [],
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
  // Plan 073.2 — accumulate a fuller transcript for end-of-conversation
  // memory summarization. `history` is capped at 12 for the prompt's
  // recent-turns window; the summarizer wants earlier exchanges too
  // (e.g. the player's introduction). Session-scoped, bounded, never
  // enters the prompt.
  if (!state.transcript) state.transcript = [];
  state.transcript.push({ role, text: normalized });
  state.transcript = state.transcript.slice(-60);
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

/**
 * Story 46.14 — always returns the gateway-routed providers. The
 * direct-API fork (Anthropic / OpenAI clients constructed from raw
 * API keys) is gone — browser-side SugarAgent must always proxy
 * through the local SugarDeploy gateway (dev) or the deployed Cloud Run
 * gateway (published-web). Missing proxy URL is caught earlier in
 * `createRuntimePlugin`'s init guard.
 */
function resolveProviders(
  config: SugarAgentPluginConfig,
  _logger: SugarAgentLogger
): {
  llmProvider: LLMProvider | null;
  vectorStoreProvider: VectorStoreProvider | null;
  personaLoader: PersonaLoader;
} {
  const baseUrl = config.proxyBaseUrl.trim();
  // Story 47.9.5 — token source depends on gateway auth mode:
  //   - bearer mode (45.5.8): the shared token was baked into the
  //     bundle at build time as VITE_SUGARMAGIC_GATEWAY_BEARER_TOKEN
  //     and normalized into `config.gatewayBearerToken`. Static value
  //     for the life of the bundle; wrap in an async closure so the
  //     client's getter contract is satisfied.
  //   - supabase-jwt mode (47.9): build-time bake is skipped, so
  //     `gatewayBearerToken` is empty. Fall back to the runtime-core
  //     access-token registry, which the runtime host populates with
  //     the active UserIdentityProvider after onProvidersResolved.
  //     The getter pulls the LIVE access token per request so
  //     supabase-js's auto-refresh lands on the wire transparently.
  //   - none mode: both branches return null → no Authorization
  //     header sent → public gateway accepts.
  const staticToken = config.gatewayBearerToken.trim();
  const getBearerToken: BearerTokenGetter = staticToken
    ? async () => staticToken
    : getActiveAccessToken;
  return {
    llmProvider: new SugarAgentGatewayLLMProvider(
      new SugarAgentGatewayLLMClient(baseUrl, getBearerToken)
    ),
    vectorStoreProvider: new SugarAgentGatewayVectorStoreProvider(
      new SugarAgentGatewayVectorStoreClient(baseUrl, getBearerToken)
    ),
    personaLoader: new SugarAgentGatewayPersonaProvider(
      new SugarAgentGatewayLoreClient(baseUrl, getBearerToken)
    )
  };
}

/**
 * Plan 072.3 -- load the NPC's persona + core knowledge ONCE at session start,
 * before the initial turn. Never throws (D3): any failure degrades to a
 * name-and-tone conversation with a `persona-unavailable` fallback reason.
 */
async function loadPersonaOnce(args: {
  personaLoader: PersonaLoader;
  lorePageId: string | null;
  state: SugarAgentProviderState;
  logger: SugarAgentLogger;
}): Promise<void> {
  const { personaLoader, lorePageId, state, logger } = args;
  if (state.persona) return;
  try {
    state.persona = await personaLoader.loadPersona(lorePageId);
  } catch (error) {
    state.persona = {
      pageId: lorePageId,
      loaded: false,
      fallbackReason: "persona-unavailable",
      personaCard: [],
      coreKnowledge: [],
      digest: ""
    };
    logger.logPluginEvent("persona-load-failed", {
      pageId: lorePageId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  logger.logPluginEvent("persona-loaded", {
    pageId: state.persona.pageId,
    loaded: state.persona.loaded,
    fallbackReason: state.persona.fallbackReason,
    personaSectionCount: state.persona.personaCard.length,
    coreSectionCount: state.persona.coreKnowledge.length
  });
}

/** Compact persona summary for turn diagnostics (D3 observability). */
function summarizePersona(
  persona: SugarAgentProviderState["persona"]
): Record<string, unknown> | undefined {
  if (!persona) return undefined;
  return {
    pageId: persona.pageId,
    loaded: persona.loaded,
    fallbackReason: persona.fallbackReason,
    personaSectionCount: persona.personaCard.length,
    coreSectionCount: persona.coreKnowledge.length
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
    { execution, interpret, personaLoaded: state.persona?.loaded === true },
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
        consecutiveFallbackTurns: state.consecutiveFallbackTurns,
        persona: summarizePersona(state.persona)
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
      consecutiveFallbackTurns: state.consecutiveFallbackTurns,
      persona: summarizePersona(state.persona)
    }
  };
}

export function createSugarAgentConversationProvider(
  config: SugarAgentPluginConfig
): ConversationProvider {
  // Plan 072.4 (absorbed 071.8): honor debugLogging. It was ORed with the
  // (mandatory) proxyBaseUrl, which pinned logging always-on and made the
  // setting a no-op. Now stage logging + the prompt dump follow the flag.
  const logger = createSugarAgentLogger(config.debugLogging);
  const { llmProvider, vectorStoreProvider, personaLoader } = resolveProviders(
    config,
    logger
  );
  const stages = {
    interpret: new InterpretStage(),
    retrieve: new RetrieveStage(vectorStoreProvider),
    plan: new PlanStage(),
    generate: new GenerateStage(llmProvider),
    audit: new AuditStage(),
    repair: new RepairStage()
  };

  logger.logPluginEvent("provider-registered", {
    providerId: SUGARAGENT_PROVIDER_ID,
    llmBackend: llmProvider ? "anthropic" : "deterministic",
    vectorStoreBackend: vectorStoreProvider ? "gateway" : "none"
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

      // Plan 072.3 -- load persona/core once, before the initial turn.
      await loadPersonaOnce({
        personaLoader,
        lorePageId: context.selection.lorePageId ?? null,
        state,
        logger
      });

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
        dispose: async () => {
          logger.logPluginEvent("unmounted", {
            npcDefinitionId: context.selection.npcDefinitionId,
            sessionId: state.sessionId
          });
          // Plan 073.2 — write what this NPC remembers about the player.
          // Phase 1 (deterministic merge) is AWAITED so an immediate
          // re-talk sees "we met"; phase 2 (the LLM summary) is fire-
          // and-forget so dispose never blocks on the gateway.
          const npcDefinitionId = context.selection.npcDefinitionId;
          if (!npcDefinitionId) return;
          const store = resolveNpcMemoryStore();
          if (!store) return; // identity not ready — memory unavailable
          const transcript = state.transcript ?? state.history;
          try {
            const { summaryComplete } = await summarizeConversationAtDispose(
              {
                store,
                llmProvider,
                logger,
                // Empty config => summarizer's built-in small-model
                // default (claude-haiku-4-5). Never empty on the wire:
                // an empty model would make the gateway fall back to the
                // DIALOGUE env model, not a cheap one.
                model: config.anthropicSummaryModel || undefined
              },
              {
                npcDefinitionId,
                npcDisplayName: context.selection.npcDisplayName,
                transcript
              }
            );
            void summaryComplete.catch(() => {});
          } catch (error) {
            logger.logPluginEvent("memory-dispose-failed", {
              npcDefinitionId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
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
