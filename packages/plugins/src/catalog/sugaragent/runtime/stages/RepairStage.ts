import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import {
  buildFallbackReply,
  normalizeNpcSpeech,
  summarizeEvidence
} from "./helpers";
import type {
  AuditResult,
  GenerateResult,
  InterpretResult,
  PlanResult,
  RepairResult,
  RetrieveResult,
  TurnStage,
  TurnStageResult
} from "../types";

/**
 * Repair is the last stage in the SugarAgent turn lifecycle.
 * It converts audit failures into a safe repaired response or deterministic
 * fallback so the host never receives a fabricated unchecked turn.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface RepairStageInput {
  execution: ConversationExecutionContext;
  interpret: InterpretResult;
  retrieve: RetrieveResult;
  plan: PlanResult;
  generate: GenerateResult;
  audit: AuditResult;
}

export class RepairStage implements TurnStage<RepairStageInput, RepairResult> {
  readonly stageId = "Repair";

  async execute(
    input: RepairStageInput
  ): Promise<TurnStageResult<RepairResult>> {
    const startedAt = Date.now();
    const activeQuestDisplayName =
      input.execution.runtimeContext?.trackedQuest?.displayName ??
      input.execution.selection.activeQuest?.displayName ??
      null;
    if (input.audit.passed) {
      return {
        output: {
          text: input.generate.text,
          actionProposals: input.generate.actionProposals,
          llmBackend: input.generate.llmBackend,
          repaired: false
        },
        diagnostics: createDiagnostics(this.stageId, startedAt, "ok", {
          repaired: false
        }),
        status: "ok"
      };
    }

    const output: RepairResult = {
      text: normalizeNpcSpeech(buildFallbackReply({
        interpret: input.interpret,
        responseIntent: input.plan.responseIntent,
        evidenceSummary: summarizeEvidence(input.retrieve.evidencePack),
        activeQuestDisplayName
      })),
      actionProposals: input.generate.actionProposals,
      llmBackend: "deterministic",
      repaired: true
    };

    return {
      output,
      diagnostics: createDiagnostics(
        this.stageId,
        startedAt,
        "degraded",
        {
          repaired: true,
          violations: input.audit.violations,
          fallbackTextPreview: output.text.slice(0, 180)
        },
        "repair-fallback"
      ),
      status: "degraded"
    };
  }
}
