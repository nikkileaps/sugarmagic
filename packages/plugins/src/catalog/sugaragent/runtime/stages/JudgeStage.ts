/**
 * Plan 075.1 -- JudgeStage
 *
 * Semantic rubric evaluation of the generated NPC reply, running between
 * Generate and (new) Regenerate. Skip conditions:
 *   - generate.usedLlm === false (deterministic fallback, envelope override, etc.)
 *   - no judge provider (proxy URL not set)
 *
 * Internal regex lint short-circuits the LLM call when meta-leak patterns
 * are already present (same cost as AuditStage's check; saves a vendor call
 * on text that is structurally bad anyway).
 *
 * Judge ERROR behavior: fail-open. The generated text passes through with
 * passed: true, errorOccurred: true, and a "judge-error" fallbackReason.
 * isStalledTurn() in provider.ts excludes "judge-error" so a judge outage
 * never 3-strike-closes conversations.
 *
 * Status: active
 */

import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { QUEST_CONTEXT_ANNOTATION_KEY } from "../quest/quest-context-middleware";
import type { QuestContextAnnotation } from "../quest/quest-context-middleware";
import { createDiagnostics } from "./diagnostics";
import { findMetaLeakViolations } from "./helpers";
import type {
  GenerateResult,
  JudgeResult,
  PlanResult,
  RetrieveResult,
  SugarAgentProviderState,
  TurnStage,
  TurnStageContext,
  TurnStageResult
} from "../types";
import type { JudgeProvider } from "../clients";

export interface JudgeStageInput {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
  plan: PlanResult;
  retrieve: RetrieveResult;
  generate: GenerateResult;
}

function skipResult(
  startedAt: number,
  skipReason: string
): TurnStageResult<JudgeResult> {
  return {
    output: {
      passed: true,
      violations: [],
      repairHint: null,
      skipped: true,
      errorOccurred: false
    },
    diagnostics: createDiagnostics(
      "Judge",
      startedAt,
      "ok",
      { skipped: true, skipReason }
    ),
    status: "ok"
  };
}

export class JudgeStage implements TurnStage<JudgeStageInput, JudgeResult> {
  readonly stageId = "Judge";

  constructor(private readonly judgeProvider: JudgeProvider | null) {}

  async execute(
    input: JudgeStageInput,
    _context: TurnStageContext
  ): Promise<TurnStageResult<JudgeResult>> {
    const startedAt = Date.now();

    if (!input.generate.usedLlm) {
      return skipResult(startedAt, "no-llm-text");
    }
    if (!this.judgeProvider) {
      return skipResult(startedAt, "no-provider");
    }

    // Fast regex lint -- if the text has structural violations the LLM call
    // is wasted: return a failed verdict without spending tokens.
    const lintViolations = findMetaLeakViolations(input.generate.text);
    if (lintViolations.length > 0) {
      const output: JudgeResult = {
        passed: false,
        violations: lintViolations,
        repairHint: "Remove meta references and stay fully in character.",
        skipped: false,
        errorOccurred: false
      };
      return {
        output,
        diagnostics: createDiagnostics(
          "Judge",
          startedAt,
          "degraded",
          { passed: false, violations: lintViolations, shortCircuit: "regex-lint" },
          "judge-lint-fail"
        ),
        status: "degraded"
      };
    }

    // Build judge inputs from execution context.
    const personaDigest = input.state.persona?.digest ?? "";
    const loreContextSummary = input.retrieve.loreContext.map((item) =>
      item.text.slice(0, 300)
    );
    const questAnnotation =
      input.execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as
        | QuestContextAnnotation
        | undefined;
    const worldContext = questAnnotation?.worldContext ?? null;

    try {
      const verdict = await this.judgeProvider.judgeReply({
        replyText: input.generate.text,
        personaDigest,
        responseIntent: input.plan.responseIntent,
        worldContext,
        loreContextSummary
      });

      const output: JudgeResult = {
        ...verdict,
        skipped: false,
        errorOccurred: false
      };

      return {
        output,
        diagnostics: createDiagnostics(
          "Judge",
          startedAt,
          output.passed ? "ok" : "degraded",
          {
            passed: output.passed,
            violations: output.violations,
            repairHint: output.repairHint
          },
          output.passed ? null : "judge-fail"
        ),
        status: output.passed ? "ok" : "degraded"
      };
    } catch (error) {
      // Fail-open: judge error is not a stall event (see isStalledTurn).
      // Error is recorded in diagnostics payload; the gateway route logs it
      // server-side via its own logError before rethrowing.
      return {
        output: {
          passed: true,
          violations: [],
          repairHint: null,
          skipped: false,
          errorOccurred: true
        },
        diagnostics: createDiagnostics(
          "Judge",
          startedAt,
          "degraded",
          {
            errorOccurred: true,
            error: error instanceof Error ? error.message : String(error)
          },
          "judge-error"
        ),
        status: "degraded"
      };
    }
  }
}
