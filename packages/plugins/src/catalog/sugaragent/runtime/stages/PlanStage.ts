import type {
  ConversationActionProposal,
  ConversationExecutionContext
} from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import { summarizeEvidence } from "./helpers";
import { resolvePlanDecision, findUnrecognisedNames } from "./planning";
import {
  MEMORY_ANNOTATION_KEY,
  MEMORY_STATE_KEY,
  type MemoizedNpcMemory,
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
      input.execution.selection.conversationKind === "free-form" &&
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
    const hasEvidence = input.retrieve.loreContext.length > 0;
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
    const questAnnotation = input.execution.annotations[
      QUEST_CONTEXT_ANNOTATION_KEY
    ] as QuestContextAnnotation | undefined;
    const hasQuestWorldContext = Boolean(questAnnotation?.hasContext);

    // #184 -- `loaded` alone is not enough: a page can resolve with every
    // section stripped (an all-`## Secrets` page) and ground nothing.
    const hasPersonaPage = Boolean(
      input.state.persona?.loaded &&
        (input.state.persona.personaCard.length > 0 ||
          input.state.persona.coreKnowledge.length > 0)
    );

    // #184 -- everything reality said this turn. The wiki, the quest and the
    // scene are the source of truth: a name none of them recognises is a name
    // for something that does not exist, and the NPC should say so rather than
    // invent it. His own page is included because his life is real too.
    const realityCorpus = [
      ...(input.state.persona?.personaCard ?? []).map((section) => section.content),
      ...(input.state.persona?.coreKnowledge ?? []).map((section) => section.content),
      ...input.retrieve.loreContext.map((item) => item.text),
      questAnnotation?.worldContext ?? "",
      input.execution.selection.npcDisplayName ?? "",
      // What this NPC actually remembers about this player, persisted across
      // sessions. Not conversation -- it survived a previous one and was
      // written down, which is what separates it from anything just typed.
      (input.execution.state[MEMORY_STATE_KEY] as MemoizedNpcMemory | undefined)
        ?.digest ?? "",
      // What the player has told us they are called. Authority over their own
      // identity, and none over the world -- only self-introductions reach here.
      ...(input.state.playerDeclaredNames ?? [])
    ].join("\n");
    // THE CONVERSATION IS NOT REALITY, and must never be in this corpus.
    //
    // `provider.ts` pushes the player's message into history BEFORE Plan runs,
    // so including history let the player's own sentence vouch for itself: the
    // check could never fire on the one thing it exists to check. The NPC's
    // reply leaks the same way -- "never heard of Brindlebear's Book Emporium"
    // would make that name real for the rest of the session.
    //
    // Reality is the wiki, the quest and the scene. A player can type anything.

    const unknownNamedEntities = findUnrecognisedNames(
      input.interpret.userText,
      realityCorpus
    );

    const decision = resolvePlanDecision({
      interpret: input.interpret,
      hasEvidence,
      hasMemory,
      hasPersonaPage,
      unknownNamedEntities,
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
      ...(decision.unknownNamedEntities
        ? { unknownNamedEntities: decision.unknownNamedEntities }
        : {}),
      responseIntent,
      responseGoal: decision.responseGoal,
      responseSpecificity: decision.responseSpecificity,
      turnPath: input.interpret.turnRouting.path,
      initiativeAction: decision.initiativeAction,
      noveltyState: decision.noveltyState,
      // Diagnostic "claims" field, not the model prompt — keep the legacy
      // compact budget (the model-facing budget lives in GenerateStage, 072.6).
      claims: summarizeEvidence(input.retrieve.loreContext, {
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
