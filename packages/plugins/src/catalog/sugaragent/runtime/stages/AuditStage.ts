import { createDiagnostics } from "./diagnostics";
import {
  findGenericOnlyViolations,
  findMetaLeakViolations,
  findSpatialGroundingViolations,
  findStageDirectionViolations
} from "./helpers";
import type {
  AuditResult,
  GenerateResult,
  PlanResult,
  TurnStage,
  TurnStageResult
} from "../types";

/**
 * Audit verifies that the generated output still matches the planned intent.
 * It is the guardrail stage that detects obvious violations before the turn is
 * returned to the conversation host.
 *
 * Stage instances may only hold immutable service dependencies.
 * All runtime/session/turn data must remain in:
 * - provider state
 * - execution context
 * - stage input/output
 */
export interface AuditStageInput {
  execution: import("@sugarmagic/runtime-core").ConversationExecutionContext;
  generate: GenerateResult;
  plan: PlanResult;
}

export class AuditStage implements TurnStage<AuditStageInput, AuditResult> {
  readonly stageId = "Audit";

  async execute(
    input: AuditStageInput
  ): Promise<TurnStageResult<AuditResult>> {
    const startedAt = Date.now();
    const violations: string[] = [
      ...findMetaLeakViolations(input.generate.text),
      ...findStageDirectionViolations(input.generate.text),
      ...findSpatialGroundingViolations(input.generate.text, input.execution)
    ];
    if (input.plan.responseSpecificity === "generic-only") {
      violations.push(...findGenericOnlyViolations(input.generate.text));
    }
    if (input.generate.text.trim().length === 0) {
      violations.push("empty-output");
    }
    if (
      input.plan.responseIntent === "goodbye" &&
      !/(bye|again|later|farewell|speak)/i.test(input.generate.text)
    ) {
      violations.push("missing-goodbye-cue");
    }
    if (
      input.plan.responseIntent === "clarify" &&
      !/\?/.test(input.generate.text)
    ) {
      violations.push("missing-clarifying-question");
    }
    if (
      input.plan.responseIntent === "abstain" &&
      !/(don't know enough|do not know enough|need more context|not enough)/i.test(
        input.generate.text
      )
    ) {
      violations.push("missing-abstention-cue");
    }

    const output: AuditResult = {
      passed: violations.length === 0,
      violations
    };

    return {
      output,
      diagnostics: createDiagnostics(
        this.stageId,
        startedAt,
        output.passed ? "ok" : "degraded",
        {
          passed: output.passed,
          responseSpecificity: input.plan.responseSpecificity,
          violations,
          currentAreaDisplayName:
            input.execution.runtimeContext?.here?.area?.displayName ??
            input.execution.runtimeContext?.here?.regionDisplayName ??
            null,
          currentAreaKind: input.execution.runtimeContext?.here?.area?.kind ?? null,
          proximityBand:
            input.execution.runtimeContext?.npcPlayerRelation?.proximityBand ?? null
        },
        output.passed ? null : "audit-violations"
      ),
      status: output.passed ? "ok" : "degraded"
    };
  }
}
