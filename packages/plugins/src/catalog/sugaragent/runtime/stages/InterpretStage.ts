import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import { detectPendingExpectation, interpretPlayerTurn } from "./interpretation";
import type {
  InterpretResult,
  SugarAgentProviderState,
  TurnStage,
  TurnStageResult
} from "../types";

/**
 * Interpret is the entry stage for each SugarAgent turn.
 * It classifies the player's latest input into a routing shape the rest of the
 * lifecycle can reason about without committing to prose generation yet.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface InterpretStageInput {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
}

export class InterpretStage implements TurnStage<InterpretStageInput, InterpretResult> {
  readonly stageId = "Interpret";

  async execute(
    input: InterpretStageInput
  ): Promise<TurnStageResult<InterpretResult>> {
    const startedAt = Date.now();
    const userText =
      input.execution.input?.kind === "free_text"
        ? input.execution.input.text.trim()
        : null;
    const pendingExpectation = detectPendingExpectation(input.state);
    const result: InterpretResult = {
      ...interpretPlayerTurn({
        userText: userText || null,
        npcDefinitionId: input.execution.selection.npcDefinitionId,
        npcDisplayName: input.execution.selection.npcDisplayName,
        pendingExpectation
      }),
      pendingExpectation
    };

    return {
      output: result,
      diagnostics: createDiagnostics(this.stageId, startedAt, "ok", {
        queryType: result.queryType,
        intent: result.interpretation.intent,
        lane: result.interpretation.lane,
        facet: result.interpretation.facet,
        socialMove: result.interpretation.socialMove,
        turnPath: result.turnRouting.path,
        pendingExpectation: result.pendingExpectation.kind,
        hasUserText: Boolean(result.userText)
      }),
      status: "ok"
    };
  }
}
