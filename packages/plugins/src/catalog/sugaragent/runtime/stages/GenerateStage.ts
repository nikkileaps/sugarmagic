import type {
  ConversationExecutionContext,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
/**
 * Opaque constraint shape read from execution annotations. SugarAgent does
 * not interpret the pedagogical fields — it reads `generatorPromptOverlay`
 * and `minimalGreetingMode` as pre-formatted values from the sugarlang plugin.
 */
interface LanguageLearningConstraint {
  generatorPromptOverlay: string;
  minimalGreetingMode: boolean;
  prePlacementOpeningLine?: { text: string; lang: string; lineId: string };
  glossingStrategy: string;
  supportPosture: string;
  targetLanguageRatio: number;
  interactionStyle: string;
  sentenceComplexityCap: string;
  targetLanguage: string;
  learnerCefr: string;
  targetVocab: {
    introduce: Array<{ lemmaId: string }>;
    reinforce: Array<{ lemmaId: string }>;
    avoid: Array<{ lemmaId: string }>;
  };
  questEssentialLemmas?: Array<{ lemmaRef: { lemmaId: string } }>;
  comprehensionCheckInFlight?: {
    targetLemmas: Array<{ lemmaId: string }>;
  };
}
// TODO: Move placement questionnaire loading to sugarlang plugin — it should
// provide the questionnaire envelope via an annotation, not require SugarAgent
// to import from sugarlang directly.
import { loadPlacementQuestionnaire } from "../../../sugarlang/runtime/placement/placement-questionnaire-loader";
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

/**
 * Returns the prompt overlay from the language-learning constraint.
 * SugarAgent does not build or interpret this — the sugarlang plugin
 * provides it pre-formatted via `generatorPromptOverlay`.
 */
function getConstraintPromptOverlay(
  constraint: LanguageLearningConstraint
): string[] {
  return constraint.generatorPromptOverlay
    ? [constraint.generatorPromptOverlay]
    : [];
}

function buildPrePlacementEnvelope(
  input: GenerateStageInput,
  context: TurnStageContext,
  constraint: LanguageLearningConstraint
): ConversationTurnEnvelope {
  return {
    turnId: context.turnId,
    providerId: "sugaragent.provider",
    conversationKind: input.execution.selection.conversationKind,
    speakerId: input.execution.selection.npcDefinitionId,
    speakerLabel: input.execution.selection.npcDisplayName,
    displayName: input.execution.selection.npcDisplayName,
    text: constraint.prePlacementOpeningLine?.text ?? "",
    choices: [],
    inputMode: "advance",
    proposedActions: [],
    metadata: {
      "sugarlang.prePlacementOpeningLine.lineId":
        constraint.prePlacementOpeningLine?.lineId ?? ""
    },
    annotations: input.execution.annotations,
    diagnostics: {
      prePlacementBypass: true,
      llmCallsMade: 0
    }
  };
}

function isMinimalGreetingMode(
  constraint: LanguageLearningConstraint | undefined
): boolean {
  return constraint?.minimalGreetingMode ?? false;
}

function buildPlacementQuestionnaireEnvelope(
  input: GenerateStageInput,
  context: TurnStageContext,
  placementFlow: { minAnswersForValid?: unknown } | undefined
): ConversationTurnEnvelope | null {
  const targetLanguage = input.execution.selection.targetLanguage?.trim().toLowerCase();
  if (!targetLanguage) {
    return null;
  }

  const questionnaire = loadPlacementQuestionnaire(targetLanguage);
  const effectiveQuestionnaire =
    typeof placementFlow?.minAnswersForValid === "number"
      ? {
          ...questionnaire,
          minAnswersForValid: placementFlow.minAnswersForValid
        }
      : questionnaire;
  return {
    turnId: context.turnId,
    providerId: "sugaragent.provider",
    conversationKind: input.execution.selection.conversationKind,
    speakerId: input.execution.selection.npcDefinitionId,
    speakerLabel: input.execution.selection.npcDisplayName,
    displayName: input.execution.selection.npcDisplayName,
    text: effectiveQuestionnaire.formIntro,
    choices: [],
    inputMode: "placement_questionnaire",
    proposedActions: [],
    metadata: {
      "sugarlang.placementQuestionnaire": effectiveQuestionnaire,
      "sugarlang.placementQuestionnaireVersion": `${effectiveQuestionnaire.lang}-placement-v${effectiveQuestionnaire.schemaVersion}`
    },
    annotations: input.execution.annotations,
    diagnostics: {
      placementQuestionnaire: true,
      llmCallsMade: 0
    }
  };
}

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
    const constraint = input.execution.annotations[
      "sugarlang.constraint"
    ] as LanguageLearningConstraint | undefined;
    const placementFlow = input.execution.annotations["sugarlang.placementFlow"] as
      | { phase?: string; minAnswersForValid?: unknown }
      | undefined;
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
      input.execution.runtimeContext?.here?.area?.displayName ??
      input.execution.runtimeContext?.here?.sceneDisplayName ??
      input.execution.runtimeContext?.here?.regionDisplayName ??
      null;
    const currentParentAreaDisplayName =
      input.execution.runtimeContext?.here?.parentArea?.displayName ?? null;
    const npcPlayerRelation =
      input.execution.runtimeContext?.npcPlayerRelation ?? null;
    const npcBehavior = input.execution.runtimeContext?.npcBehavior ?? null;
    const npcMovement = npcBehavior?.movement ?? null;
    const npcCurrentTask = npcBehavior?.task ?? null;
    const npcCurrentActivity = npcBehavior?.activity ?? null;
    const npcCurrentGoal = npcBehavior?.goal ?? null;

    let text: string;
    let llmBackend: GenerateResult["llmBackend"] = "deterministic";
    let status: TurnStageResult<GenerateResult>["status"] = "ok";
    let fallbackReason: string | null = null;
    let systemPromptPreview = "";
    let systemPrompt = "";
    let userPrompt = "";
    let retryCount = 0;
    const canUseProxyDefaults = context.config.proxyBaseUrl.trim().length > 0;
    const evidenceSummary = summarizeEvidence(input.retrieve.evidencePack);
    const minimalSugarlangGreetingMode = isMinimalGreetingMode(
      constraint
    );

    if (constraint?.prePlacementOpeningLine) {
      const output: GenerateResult = {
        text: constraint.prePlacementOpeningLine.text,
        usedLlm: false,
        llmBackend: "deterministic",
        actionProposals: [],
        envelopeOverride: buildPrePlacementEnvelope(input, context, constraint)
      };

      return {
        output,
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "ok",
          {
            prePlacementBypass: true,
            lineId: constraint.prePlacementOpeningLine.lineId,
            usedLlm: false
          }
        ),
        status: "ok"
      };
    }

    if (placementFlow?.phase === "questionnaire") {
      const envelopeOverride = buildPlacementQuestionnaireEnvelope(
        input,
        context,
        placementFlow
      );
      if (envelopeOverride) {
        return {
          output: {
            text: envelopeOverride.text,
            usedLlm: false,
            llmBackend: "deterministic",
            actionProposals: [],
            envelopeOverride
          },
          diagnostics: createDiagnostics(
            this.stageId,
            startedAt,
            "ok",
            {
              placementQuestionnaire: true,
              usedLlm: false
            }
          ),
          status: "ok"
        };
      }
    }

    if (
      !constraint &&
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
            proximityBand: npcPlayerRelation?.proximityBand ?? null,
            movementStatus: npcMovement?.status ?? null,
            currentTaskDisplayName: npcCurrentTask?.displayName ?? null,
            currentTaskDescription: npcCurrentTask?.description ?? null,
            currentActivity: npcCurrentActivity?.activity ?? null,
            currentGoal: npcCurrentGoal?.goal ?? null,
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
      systemPrompt = [
        `Speak as ${npcDisplayName}.`,
        `Return only the NPC's spoken words.`,
        `Do not include stage directions, action narration, scene description, asterisks, bracketed cues, or quoted dialogue wrappers.`,
        `Use only the provided evidence, quest context, NPC profile, and recent history as grounded context for this turn.`,
        `Do not introduce institutions, locations, factions, setting names, or world facts that are not supported by that grounded context.`,
        `If grounded context is insufficient, ask a clarifying question or say you do not know enough yet.`,
        `Do not use deictic spatial claims like "here", "inside", "outside", "at my shop", or "in this room" unless grounded runtime location supports them.`,
        `If the NPC is associated with another place but is not currently there, describe that place as elsewhere or nearby rather than as the current location.`,
        `Interaction mode: ${input.execution.selection.interactionMode ?? "agent"}.`,
        !minimalSugarlangGreetingMode && activeQuestDisplayName
          ? `Active quest: ${activeQuestDisplayName} / ${activeQuestStageDisplayName ?? "current stage"}`
          : null,
        currentLocationDisplayName
          ? `Current location: ${currentLocationDisplayName}.`
          : null,
        !minimalSugarlangGreetingMode && currentParentAreaDisplayName
          ? `Containing area: ${currentParentAreaDisplayName}.`
          : null,
        npcPlayerRelation
          ? `Player proximity: ${npcPlayerRelation.proximityBand}. Same area: ${npcPlayerRelation.sameArea ? "yes" : "no"}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentTask?.displayName
          ? `Current task: ${npcCurrentTask.displayName}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentTask?.description
          ? `Task context: ${npcCurrentTask.description}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentActivity?.activity
          ? `Current activity: ${npcCurrentActivity.activity}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentGoal?.goal
          ? `Current goal: ${npcCurrentGoal.goal}.`
          : null,
        !minimalSugarlangGreetingMode && npcMovement?.status
          ? `Movement status: ${npcMovement.status}${npcMovement.targetAreaDisplayName ? ` toward ${npcMovement.targetAreaDisplayName}` : ""}.`
          : null,
        minimalSugarlangGreetingMode
          ? "This is a first-meeting beginner greeting turn. Keep it tiny, warm, and low-specificity. Do not volunteer task details, quest details, location trivia, or backstory unless the player asks."
          : null,
        ...(constraint ? getConstraintPromptOverlay(constraint) : [])
      ]
        .filter(Boolean)
        .join("\n");
      systemPromptPreview = systemPrompt.slice(0, 220);

      userPrompt = [
        minimalSugarlangGreetingMode
          ? `Reply in exactly 1 short sentence. Use at most 2 very short sentences only if absolutely necessary.`
          : `Respond to the player naturally, matching the tone and length to the conversation.`,
        `Intent: ${input.plan.responseIntent}.`,
        `Turn path: ${input.plan.turnPath}.`,
        `Interpret intent: ${input.interpret.interpretation.intent}.`,
        `Goal: ${input.plan.responseGoal}`,
        input.interpret.userText
          ? `Player said: ${input.interpret.userText}`
          : `This is the opening turn. Start the conversation naturally.`,
        minimalSugarlangGreetingMode
          ? `This is a first-meeting greeting for a beginner learner. Keep it brief, warm, and generic. Do not volunteer what the NPC is doing unless asked.`
          : null,
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
        !minimalSugarlangGreetingMode && currentParentAreaDisplayName
          ? `Current containing area: ${currentParentAreaDisplayName}.`
          : null,
        npcPlayerRelation
          ? `Player/NPC proximity band: ${npcPlayerRelation.proximityBand}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentTask?.displayName
          ? `NPC current task: ${npcCurrentTask.displayName}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentTask?.description
          ? `NPC task context: ${npcCurrentTask.description}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentActivity?.activity
          ? `NPC current activity: ${npcCurrentActivity.activity}.`
          : null,
        !minimalSugarlangGreetingMode && npcCurrentGoal?.goal
          ? `NPC current goal: ${npcCurrentGoal.goal}.`
          : null,
        !minimalSugarlangGreetingMode && npcMovement?.status
          ? `NPC movement status: ${npcMovement.status}${npcMovement.targetAreaDisplayName ? ` toward ${npcMovement.targetAreaDisplayName}` : ""}.`
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
          currentAreaDisplayName: currentLocationDisplayName,
          proximityBand: npcPlayerRelation?.proximityBand ?? null,
          movementStatus: npcMovement?.status ?? null,
          currentTaskDisplayName: npcCurrentTask?.displayName ?? null,
          currentTaskDescription: npcCurrentTask?.description ?? null,
          currentActivity: npcCurrentActivity?.activity ?? null,
          currentGoal: npcCurrentGoal?.goal ?? null,
          retryCount,
          systemPromptPreview,
          systemPrompt,
          userPrompt,
          minimalSugarlangGreetingMode,
          sugarlangConstraintSummary: constraint
            ? {
                supportPosture: constraint.supportPosture,
                targetLanguageRatio: constraint.targetLanguageRatio,
                interactionStyle: constraint.interactionStyle,
                glossingStrategy: constraint.glossingStrategy,
                sentenceComplexityCap: constraint.sentenceComplexityCap,
                targetLanguage: constraint.targetLanguage,
                learnerCefr: constraint.learnerCefr,
                introduce: constraint.targetVocab.introduce.map((lemma) => lemma.lemmaId),
                reinforce: constraint.targetVocab.reinforce.map((lemma) => lemma.lemmaId),
                avoid: constraint.targetVocab.avoid.map((lemma) => lemma.lemmaId),
                questEssentialLemmas:
                  constraint.questEssentialLemmas?.map(
                    (entry) => entry.lemmaRef.lemmaId
                  ) ?? [],
                comprehensionCheckTargetLemmas:
                  constraint.comprehensionCheckInFlight?.targetLemmas.map(
                    (lemma) => lemma.lemmaId
                  ) ?? []
              }
            : null,
          textPreview: text.slice(0, 180),
          proposedActions: output.actionProposals.map((proposal) => proposal.kind)
        },
        fallbackReason
      ),
      status
    };
  }
}
