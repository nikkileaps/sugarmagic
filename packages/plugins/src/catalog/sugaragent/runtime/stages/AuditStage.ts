import { collectContributions } from "../contributions";
import { createDiagnostics } from "./diagnostics";
import {
  findGenericOnlyViolations,
  findMetaLeakViolations,
  findSpatialGroundingViolations,
  findStageDirectionViolations
} from "./helpers";
import { buildLexiconPattern, nfdStrip } from "./interpretation";
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
    const { preserveActionTags, interpretLexicon } = collectContributions(input.execution.annotations);
    const farewellLexPattern = buildLexiconPattern(interpretLexicon.farewell ?? []);
    const violations: string[] = [
      ...findMetaLeakViolations(input.generate.text),
      ...findStageDirectionViolations(input.generate.text, preserveActionTags),
      ...findSpatialGroundingViolations(input.generate.text, input.execution)
    ];
    // The generic-only length/sentence caps exist for the DETERMINISTIC canned
    // path (short by construction). An LLM-generated persona reply's length is
    // driven by the character's voice + the maxTokens cap, so don't reject an
    // in-character reply here (Plan 072: a persona'd NPC answers social turns
    // in character, and a chatty persona like a cheese-shop owner runs long).
    if (
      input.plan.responseSpecificity === "generic-only" &&
      !input.generate.usedLlm
    ) {
      violations.push(...findGenericOnlyViolations(input.generate.text));
    }
    if (input.generate.text.trim().length === 0) {
      violations.push("empty-output");
    }
    if (
      input.plan.responseIntent === "goodbye" &&
      !/(bye|again|later|farewell|speak)/i.test(input.generate.text) &&
      !(farewellLexPattern && farewellLexPattern.test(nfdStrip(input.generate.text)))
    ) {
      violations.push("missing-goodbye-cue");
    }
    if (
      input.plan.responseIntent === "clarify" &&
      !/\?/.test(input.generate.text)
    ) {
      violations.push("missing-clarifying-question");
    }
    // TWO REFUSALS, TWO VOCABULARIES (#184).
    //
    // "I need more context" and "I have never heard of it" are both abstains,
    // and they share no words. This check was written for the first and had the
    // second's wording nowhere in it, so a perfectly good "never heard of it"
    // was flagged `missing-abstention-cue`, treated by RegenerateStage as a
    // structural violation, and replaced with the canned fallback line.
    //
    // Observed live 2026-08-16: three runs, three in-character refusals from the
    // model, three thrown away, and the player read the same canned sentence
    // every time.
    const abstainCue =
      (input.plan.unknownNamedEntities?.length ?? 0) > 0
        ? /(never heard|not heard|no idea|don'?t know (of|it|that)|do not know (of|it|that)|not familiar|doesn'?t ring|new to me|nunca)/i
        : /(don't know enough|do not know enough|need more context|not enough)/i;
    if (
      input.plan.responseIntent === "abstain" &&
      !Object.keys(interpretLexicon).length &&
      !abstainCue.test(input.generate.text)
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
