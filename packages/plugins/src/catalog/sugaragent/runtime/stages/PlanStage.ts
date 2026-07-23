import type {
  ConversationActionProposal,
  ConversationExecutionContext
} from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import { summarizeEvidence } from "./helpers";
import { resolvePlanDecision } from "./planning";
import {
  MEMORY_ANNOTATION_KEY,
  type NpcMemoryAnnotation
} from "../memory/digest";
import {
  QUEST_CONTEXT_ANNOTATION_KEY,
  type QuestContextAnnotation
} from "../quest/quest-context-middleware";
import type {
  InterpretResult,
  PlanResult,
  RetrieveResult,
  SugarAgentProviderState,
  TurnStage,
  TurnStageResult
} from "../types";

/**
 * Plan converts interpreted intent and retrieved evidence into a semantic turn plan.
 * It decides response intent, claims, and typed action proposals before any
 * surface text is generated.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface PlanStageInput {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
  interpret: InterpretResult;
  retrieve: RetrieveResult;
}

export class PlanStage implements TurnStage<PlanStageInput, PlanResult> {
  readonly stageId = "Plan";

  async execute(
    input: PlanStageInput
  ): Promise<TurnStageResult<PlanResult>> {
    const startedAt = Date.now();
    const scriptedFollowupDialogueDefinitionId =
      input.execution.selection.scriptedFollowupDialogueDefinitionId;

    const actionProposals: ConversationActionProposal[] = [];
    if (
      input.execution.selection.interactionMode === "agent" &&
      input.interpret.interpretation.intent === "quest_guidance" &&
      typeof scriptedFollowupDialogueDefinitionId === "string" &&
      scriptedFollowupDialogueDefinitionId.length > 0
    ) {
      actionProposals.push({
        kind: "start-scripted-followup",
        dialogueDefinitionId: scriptedFollowupDialogueDefinitionId
      });
    }

    if (input.interpret.shouldCloseAfterReply) {
      actionProposals.push({ kind: "request-close" });
    }

    let responseIntent: PlanResult["responseIntent"] = "answer";
    const hasEvidence = input.retrieve.evidencePack.length > 0;
    const hasActiveQuest = Boolean(
      input.execution.runtimeContext?.trackedQuest?.displayName ??
        input.execution.selection.activeQuest?.displayName
    );
    const hasScriptedFollowup = Boolean(
      typeof scriptedFollowupDialogueDefinitionId === "string" &&
        scriptedFollowupDialogueDefinitionId.length > 0
    );
    // Plan 073.3 — memory IS evidence for recall/greeting: the memory
    // middleware (context stage) publishes this annotation before Plan runs.
    const hasMemory = Boolean(
      (
        input.execution.annotations[MEMORY_ANNOTATION_KEY] as
          | NpcMemoryAnnotation
          | undefined
      )?.hasMemory
    );

    // Plan 077.2 -- quest-context middleware publishes this annotation when
    // world-framed lore was resolved for the active objective (D3). When
    // absent (no active quest, or middleware degraded), defaults to false.
    const hasQuestWorldContext = Boolean(
      (
        input.execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as
          | QuestContextAnnotation
          | undefined
      )?.hasContext
    );

    const decision = resolvePlanDecision({
      interpret: input.interpret,
      hasEvidence,
      hasMemory,
      hasActiveQuest,
      hasQuestWorldContext,
      hasScriptedFollowup,
      npcDisplayName: input.execution.selection.npcDisplayName,
      history: input.state.history
    });
    responseIntent = decision.responseIntent;

    // Plan 077.3 (D4): coarse proxy for "NPC was prompted to voice the quest
    // objective". Emit only when quest world context was resolved AND we didn't
    // redirect to a scripted path (that's a different signal). The handler in
    // gameplay-session.ts calls bumpGoalSurfacedCount -- sugaragent never
    // touches the blackboard directly (write firewall: assertWriteAllowed would
    // throw if it tried). Counts PROMPTING, not saying (D4 honest wrinkle).
    if (hasQuestWorldContext && hasActiveQuest && responseIntent !== "redirect") {
      const questId =
        input.execution.runtimeContext?.trackedQuest?.questId ?? "";
      const stageId =
        input.execution.runtimeContext?.activeQuestStage?.stageId ?? "";
      if (questId) {
        actionProposals.push({ kind: "bump-goal-surfaced", questId, stageId });
      }
    }

    const output: PlanResult = {
      responseIntent,
      responseGoal: decision.responseGoal,
      responseSpecificity: decision.responseSpecificity,
      turnPath: input.interpret.turnRouting.path,
      initiativeAction: decision.initiativeAction,
      noveltyState: decision.noveltyState,
      // Diagnostic "claims" field, not the model prompt — keep the legacy
      // compact budget (the model-facing budget lives in GenerateStage, 072.6).
      claims: summarizeEvidence(input.retrieve.evidencePack, {
        maxItems: 3,
        perItemChars: 180
      }),
      actionProposals,
      replyInputMode: decision.replyInputMode,
      replyPlaceholder: decision.replyPlaceholder
    };

    return {
      output,
      diagnostics: createDiagnostics(this.stageId, startedAt, "ok", {
        responseIntent: output.responseIntent,
        responseSpecificity: output.responseSpecificity,
        turnPath: output.turnPath,
        queryType: input.interpret.queryType,
        interpretationIntent: input.interpret.interpretation.intent,
        socialMove: input.interpret.interpretation.socialMove,
        pendingExpectation: input.interpret.pendingExpectation.kind,
        initiativeAction: output.initiativeAction,
        noveltyState: output.noveltyState,
        hasEvidence,
        hasMemory,
        hasActiveQuest,
        hasScriptedFollowup,
        actionKinds: output.actionProposals.map((proposal) => proposal.kind),
        claims: output.claims
      }),
      status: "ok"
    };
  }
}
