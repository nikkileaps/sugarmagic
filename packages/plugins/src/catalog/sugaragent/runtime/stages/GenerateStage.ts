import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import type { LLMProvider } from "../clients";
import { createDiagnostics } from "./diagnostics";
import {
  buildFallbackReply,
  buildGenericOnlyReply,
  buildTransientUpstreamExitReply,
  normalizeNpcSpeech,
  summarizeEvidence
} from "./helpers";
import type {
  GenerateResult,
  InterpretResult,
  PlanResult,
  RetrieveResult,
  SugarAgentProviderState,
  TurnStage,
  TurnStageContext,
  TurnStageResult
} from "../types";

const GENERATE_RETRY_BACKOFF_MS = [700, 1400] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableGenerationError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) {
    return false;
  }

  return (
    /\b(?:429|500|502|503|504|529)\b/.test(message) ||
    /overloaded/i.test(message) ||
    /timeout/i.test(message) ||
    /temporar/i.test(message) ||
    /rate limit/i.test(message)
  );
}

/**
 * Generate realizes the planned turn into player-facing NPC prose.
 * It may use the configured LLM backend, but it is still constrained by the
 * plan and evidence selected earlier in the lifecycle.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface GenerateStageInput {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
  interpret: InterpretResult;
  retrieve: RetrieveResult;
  plan: PlanResult;
}

export class GenerateStage implements TurnStage<GenerateStageInput, GenerateResult> {
  readonly stageId = "Generate";

  constructor(private readonly llmProvider: LLMProvider | null) {}

  async execute(
    input: GenerateStageInput,
    context: TurnStageContext
  ): Promise<TurnStageResult<GenerateResult>> {
    const startedAt = Date.now();
    const npcDisplayName = input.execution.selection.npcDisplayName ?? "NPC";
    const activeQuestDisplayName =
      input.execution.runtimeContext?.trackedQuest?.displayName ??
      input.execution.selection.activeQuest?.displayName ??
      null;
    const activeQuestStageDisplayName =
      input.execution.runtimeContext?.activeQuestStage?.stageDisplayName ??
      input.execution.selection.activeQuest?.stageDisplayName ??
      null;
    const currentLocationDisplayName =
      input.execution.runtimeContext?.here?.sceneDisplayName ??
      input.execution.runtimeContext?.here?.regionDisplayName ??
      null;

    let text: string;
    let llmBackend: GenerateResult["llmBackend"] = "deterministic";
    let status: TurnStageResult<GenerateResult>["status"] = "ok";
    let fallbackReason: string | null = null;
    let systemPromptPreview = "";
    let retryCount = 0;
    const canUseProxyDefaults = context.config.proxyBaseUrl.trim().length > 0;
    const evidenceSummary = summarizeEvidence(input.retrieve.evidencePack);

    if (
      input.plan.responseSpecificity === "generic-only" &&
      (
        input.plan.responseIntent === "greet" ||
        input.plan.responseIntent === "chat" ||
        input.plan.responseIntent === "answer"
      )
    ) {
      text = buildGenericOnlyReply({
        responseIntent: input.plan.responseIntent,
        interpret: input.interpret
      });
      llmBackend = "deterministic";
      fallbackReason = "generic-only-policy";

      const output: GenerateResult = {
        text,
        usedLlm: false,
        llmBackend,
        actionProposals: input.plan.actionProposals
      };

      return {
        output,
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "ok",
          {
            llmBackend,
            usedLlm: false,
            responseIntent: input.plan.responseIntent,
            responseGoal: input.plan.responseGoal,
            responseSpecificity: input.plan.responseSpecificity,
            turnPath: input.plan.turnPath,
            evidenceCount: input.retrieve.evidencePack.length,
            textPreview: text.slice(0, 180),
            proposedActions: output.actionProposals.map((proposal) => proposal.kind)
          },
          fallbackReason
        ),
        status: "ok"
      };
    }

    if (
      this.llmProvider &&
      (context.config.anthropicModel.trim() || canUseProxyDefaults)
    ) {
      const systemPrompt = [
        `Speak as ${npcDisplayName}.`,
        `Return only the NPC's spoken words.`,
        `Do not include stage directions, action narration, scene description, asterisks, bracketed cues, or quoted dialogue wrappers.`,
        `Use only the provided evidence, quest context, NPC profile, and recent history as grounded context for this turn.`,
        `Do not introduce institutions, locations, factions, setting names, or world facts that are not supported by that grounded context.`,
        `If grounded context is insufficient, ask a clarifying question or say you do not know enough yet.`,
        `Interaction mode: ${input.execution.selection.interactionMode ?? "agent"}.`,
        activeQuestDisplayName
          ? `Active quest: ${activeQuestDisplayName} / ${activeQuestStageDisplayName ?? "current stage"}`
          : null,
        currentLocationDisplayName
          ? `Current location: ${currentLocationDisplayName}.`
          : null
      ]
        .filter(Boolean)
        .join("\n");
      systemPromptPreview = systemPrompt.slice(0, 220);

      const userPrompt = [
        `Respond to the player in 1-3 short paragraphs.`,
        `Intent: ${input.plan.responseIntent}.`,
        `Turn path: ${input.plan.turnPath}.`,
        `Interpret intent: ${input.interpret.interpretation.intent}.`,
        `Goal: ${input.plan.responseGoal}`,
        input.interpret.userText
          ? `Player said: ${input.interpret.userText}`
          : `This is the opening turn. Start the conversation naturally.`,
        input.plan.responseIntent === "clarify"
          ? "Ask one concise clarifying question. Do not answer beyond what is grounded."
          : null,
        input.plan.responseIntent === "abstain"
          ? "State clearly that you do not know enough grounded information to answer yet. Invite the player to provide more context. Do not fabricate."
          : null,
        input.plan.responseIntent === "chat"
          ? "Respond as natural in-character social speech. Warmth is allowed. Do not turn a social reply into a factual worldbuilding answer."
          : null,
        input.plan.responseSpecificity === "grounded"
          ? "Use grounded evidence when present, but do not add unsupported specifics."
          : "Keep the reply generic, in-character, and low-specificity.",
        currentLocationDisplayName
          ? `Current runtime location: ${currentLocationDisplayName}.`
          : null,
        evidenceSummary.length > 0
          ? `Evidence:\n- ${evidenceSummary.join("\n- ")}`
          : "Evidence: none retrieved.",
        input.state.history.length > 0
          ? `Recent history:\n${input.state.history
              .slice(-4)
              .map((entry) => `${entry.role}: ${entry.text}`)
              .join("\n")}`
          : "Recent history: none."
        ].join("\n\n");

      try {
        let generatedText = "";
        for (let attempt = 0; attempt <= GENERATE_RETRY_BACKOFF_MS.length; attempt += 1) {
          try {
            generatedText = await this.llmProvider.generateStructuredTurn({
              model: context.config.anthropicModel,
              systemPrompt,
              userPrompt,
              maxTokens: 300
            });
            retryCount = attempt;
            break;
          } catch (error) {
            if (
              attempt < GENERATE_RETRY_BACKOFF_MS.length &&
              isRetryableGenerationError(error)
            ) {
              retryCount = attempt + 1;
              await sleep(GENERATE_RETRY_BACKOFF_MS[attempt]!);
              continue;
            }
            throw error;
          }
        }

        text = normalizeNpcSpeech(generatedText);
        llmBackend = "anthropic";
        if (!text) {
          throw new Error("empty-normalized-generation");
        }
      } catch (error) {
        status = "degraded";
        if (isRetryableGenerationError(error)) {
          fallbackReason = "llm-retry-exhausted";
          text = buildTransientUpstreamExitReply();
        } else {
          fallbackReason = "llm-unavailable";
          text = normalizeNpcSpeech(buildFallbackReply({
            interpret: input.interpret,
            responseIntent: input.plan.responseIntent,
            evidenceSummary,
            activeQuestDisplayName
          }));
        }
      }
    } else {
      status = "degraded";
      fallbackReason = "llm-not-configured";
      text = normalizeNpcSpeech(buildFallbackReply({
        interpret: input.interpret,
        responseIntent: input.plan.responseIntent,
        evidenceSummary: summarizeEvidence(input.retrieve.evidencePack),
        activeQuestDisplayName
      }));
    }

    const output: GenerateResult = {
      text,
      usedLlm: llmBackend === "anthropic",
      llmBackend,
      actionProposals:
        fallbackReason === "llm-retry-exhausted"
          ? [
              ...input.plan.actionProposals.filter(
                (proposal) => proposal.kind !== "request-close"
              ),
              { kind: "request-close" as const }
            ]
          : input.plan.actionProposals
    };

    return {
      output,
      diagnostics: createDiagnostics(
        this.stageId,
        startedAt,
        status,
        {
          llmBackend,
          usedLlm: output.usedLlm,
          responseIntent: input.plan.responseIntent,
          responseGoal: input.plan.responseGoal,
          responseSpecificity: input.plan.responseSpecificity,
          turnPath: input.plan.turnPath,
          interpretIntent: input.interpret.interpretation.intent,
          socialMove: input.interpret.interpretation.socialMove,
          evidenceCount: input.retrieve.evidencePack.length,
          retryCount,
          systemPromptPreview,
          textPreview: text.slice(0, 180),
          proposedActions: output.actionProposals.map((proposal) => proposal.kind)
        },
        fallbackReason
      ),
      status
    };
  }
}
