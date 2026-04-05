import type {
  ConversationActionProposal,
  ConversationExecutionContext
} from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import { summarizeEvidence } from "./helpers";
import { resolvePlanDecision } from "./planning";
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
      input.execution.selection.interactionMode === "guided" &&
      input.interpret.interpretation.intent === "quest_guidance" &&
      typeof scriptedFollowupDialogueDefinitionId === "string" &&
      scriptedFollowupDialogueDefinitionId.length > 0
    ) {
      actionProposals.push({
        kind: "start-scripted-followup",
        dialogueDefinitionId: scriptedFollowupDialogueDefinitionId
      });
    }

    if (input.retrieve.evidencePack[0]) {
      actionProposals.push({
        kind: "surface-beat-evidence",
        beatId:
          typeof input.execution.selection.dialogueDefinitionId === "string"
            ? input.execution.selection.dialogueDefinitionId
            : input.execution.selection.npcDefinitionId ?? "free-chat",
        evidence: input.retrieve.evidencePack[0].text.slice(0, 280)
      });
    }

    if (input.interpret.shouldCloseAfterReply) {
      actionProposals.push({ kind: "request-close" });
    }

    let responseIntent: PlanResult["responseIntent"] = "answer";
    const hasEvidence = input.retrieve.evidencePack.length > 0;
    const hasActiveQuest = Boolean(input.execution.selection.activeQuest?.displayName);
    const hasScriptedFollowup = Boolean(
      typeof scriptedFollowupDialogueDefinitionId === "string" &&
        scriptedFollowupDialogueDefinitionId.length > 0
    );

    const decision = resolvePlanDecision({
      interpret: input.interpret,
      hasEvidence,
      hasActiveQuest,
      hasScriptedFollowup,
      npcDisplayName: input.execution.selection.npcDisplayName,
      history: input.state.history
    });
    responseIntent = decision.responseIntent;

    const output: PlanResult = {
      responseIntent,
      responseGoal: decision.responseGoal,
      responseSpecificity: decision.responseSpecificity,
      turnPath: input.interpret.turnRouting.path,
      initiativeAction: decision.initiativeAction,
      noveltyState: decision.noveltyState,
      claims: summarizeEvidence(input.retrieve.evidencePack),
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
        hasActiveQuest,
        hasScriptedFollowup,
        actionKinds: output.actionProposals.map((proposal) => proposal.kind),
        claims: output.claims
      }),
      status: "ok"
    };
  }
}
