/**
 * Plan 075.2 -- RegenerateStage (replaces RepairStage)
 *
 * Decision tree (in priority order):
 *   1. audit.passed && judge.passed -> passthrough (no repair)
 *   2. !audit.passed               -> structural violation; deterministic fallback
 *   3. audit.passed && !judge.passed:
 *      a. judge.errorOccurred      -> passthrough (fail-open, already logged)
 *      b. judge.skipped            -> passthrough (no LLM text; shouldn't reach here)
 *      c. 3-strike governor active  -> deterministic fallback
 *      d. else                     -> attempt one LLM regen with repair hint;
 *                                     re-lint (no second judge); pass or fallback.
 *
 * Cost cap: at most 2 generate invocations + 1 judge per turn (the 3-strike
 * governor cuts regen after 3 consecutive judge-fail turns).
 *
 * Status: active
 */

import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { createDiagnostics } from "./diagnostics";
import {
  buildFallbackReply,
  findMetaLeakViolations,
  findStageDirectionViolations,
  normalizeNpcSpeech
} from "./helpers";
import type {
  AuditResult,
  GenerateResult,
  InterpretResult,
  JudgeResult,
  PlanResult,
  RepairResult,
  RetrieveResult,
  SugarAgentProviderState,
  TurnStage,
  TurnStageContext,
  TurnStageResult
} from "../types";
import type { LLMProvider } from "../clients";

/** 3-strike governor threshold (plan 075.2) */
const JUDGE_FAILURE_STRIKE_LIMIT = 3;

export interface RegenerateStageInput {
  execution: ConversationExecutionContext;
  state: SugarAgentProviderState;
  interpret: InterpretResult;
  retrieve: RetrieveResult;
  plan: PlanResult;
  generate: GenerateResult;
  judge: JudgeResult;
  audit: AuditResult;
}

export class RegenerateStage implements TurnStage<RegenerateStageInput, RepairResult> {
  readonly stageId = "Regenerate";

  constructor(private readonly llmProvider: LLMProvider | null) {}

  async execute(
    input: RegenerateStageInput,
    _context: TurnStageContext
  ): Promise<TurnStageResult<RepairResult>> {
    const startedAt = Date.now();
    const activeQuestDisplayName =
      input.execution.runtimeContext?.trackedQuest?.displayName ??
      input.execution.selection.activeQuest?.displayName ??
      null;

    // 1. Both passed -- passthrough.
    if (input.audit.passed && input.judge.passed) {
      return {
        output: {
          text: input.generate.text,
          actionProposals: input.generate.actionProposals,
          llmBackend: input.generate.llmBackend,
          repaired: false
        },
        diagnostics: createDiagnostics(this.stageId, startedAt, "ok", { repaired: false }),
        status: "ok"
      };
    }

    // 2. Structural audit violation -- deterministic fallback immediately.
    if (!input.audit.passed) {
      const fallbackText = normalizeNpcSpeech(buildFallbackReply({
        interpret: input.interpret,
        responseIntent: input.plan.responseIntent,
        activeQuestDisplayName
      }));
      return {
        output: {
          text: fallbackText,
          actionProposals: input.generate.actionProposals,
          llmBackend: "deterministic",
          repaired: true
        },
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "degraded",
          {
            repaired: true,
            trigger: "audit-violations",
            violations: input.audit.violations,
            fallbackTextPreview: fallbackText.slice(0, 180)
          },
          "repair-fallback"
        ),
        status: "degraded"
      };
    }

    // 3. Judge failed (audit passed).

    // 3a. Judge errored -- fail-open, passthrough.
    if (input.judge.errorOccurred) {
      return {
        output: {
          text: input.generate.text,
          actionProposals: input.generate.actionProposals,
          llmBackend: input.generate.llmBackend,
          repaired: false
        },
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "ok",
          { repaired: false, passthrough: "judge-error-fail-open" }
        ),
        status: "ok"
      };
    }

    // 3b. Judge skipped (shouldn't reach here, but passthrough if so).
    if (input.judge.skipped) {
      return {
        output: {
          text: input.generate.text,
          actionProposals: input.generate.actionProposals,
          llmBackend: input.generate.llmBackend,
          repaired: false
        },
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "ok",
          { repaired: false, passthrough: "judge-skipped" }
        ),
        status: "ok"
      };
    }

    // 3c. 3-strike governor -- skip regen, deterministic fallback.
    if ((input.state.consecutiveJudgeFailures ?? 0) >= JUDGE_FAILURE_STRIKE_LIMIT) {
      const fallbackText = normalizeNpcSpeech(buildFallbackReply({
        interpret: input.interpret,
        responseIntent: input.plan.responseIntent,
        activeQuestDisplayName
      }));
      return {
        output: {
          text: fallbackText,
          actionProposals: input.generate.actionProposals,
          llmBackend: "deterministic",
          repaired: true
        },
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "degraded",
          {
            repaired: true,
            trigger: "judge-3-strike",
            consecutiveJudgeFailures: input.state.consecutiveJudgeFailures,
            judgeViolations: input.judge.violations
          },
          "repair-fallback"
        ),
        status: "degraded"
      };
    }

    // 3d. Attempt one LLM regen with the repair hint appended.
    if (!this.llmProvider) {
      // No LLM available -- deterministic fallback.
      const fallbackText = normalizeNpcSpeech(buildFallbackReply({
        interpret: input.interpret,
        responseIntent: input.plan.responseIntent,
        activeQuestDisplayName
      }));
      return {
        output: {
          text: fallbackText,
          actionProposals: input.generate.actionProposals,
          llmBackend: "deterministic",
          repaired: true
        },
        diagnostics: createDiagnostics(
          this.stageId,
          startedAt,
          "degraded",
          {
            repaired: true,
            trigger: "judge-fail-no-provider",
            judgeViolations: input.judge.violations
          },
          "repair-fallback"
        ),
        status: "degraded"
      };
    }

    const npcDisplayName = input.execution.selection.npcDisplayName ?? "the NPC";
    const personaDigest = input.state.persona?.digest ?? "";
    const regenSystemPrompt =
      `Speak as ${npcDisplayName}. ` +
      (personaDigest ? personaDigest + "\n\n" : "") +
      "You are rewriting a previous reply that failed a quality check. " +
      "Stay completely in character. Use only facts you plausibly know. " +
      "Do not reference the real world, game mechanics, or the developer.";

    const violationList = input.judge.violations.join("; ");
    const repairHint = input.judge.repairHint ? ` Hint: ${input.judge.repairHint}` : "";
    const regenUserPrompt =
      `The previous reply failed quality review.\n` +
      `Issues: ${violationList}.${repairHint}\n\n` +
      `Previous reply: "${input.generate.text}"\n\n` +
      `Write a corrected reply that fixes the issues above. ` +
      `Reply in character only:`;

    let regenText = "";
    try {
      const result = await this.llmProvider.generateStructuredTurn({
        model: "",
        systemPrompt: regenSystemPrompt,
        userPrompt: regenUserPrompt,
        maxTokens: 200
      });
      regenText = normalizeNpcSpeech(result.text);
    } catch {
      // Regen failed -- deterministic fallback.
    }

    if (regenText) {
      // Re-lint (no second judge call -- cost/latency cap per D2).
      const relintViolations = [
        ...findMetaLeakViolations(regenText),
        ...findStageDirectionViolations(regenText)
      ];
      if (relintViolations.length === 0) {
        return {
          output: {
            text: regenText,
            actionProposals: input.generate.actionProposals,
            llmBackend: "anthropic",
            repaired: true
          },
          diagnostics: createDiagnostics(
            this.stageId,
            startedAt,
            "ok",
            {
              repaired: true,
              trigger: "judge-fail-regen",
              judgeViolations: input.judge.violations,
              regenPassed: true
            }
          ),
          status: "ok"
        };
      }
    }

    // Regen failed or failed re-lint -- deterministic fallback.
    const fallbackText = normalizeNpcSpeech(buildFallbackReply({
      interpret: input.interpret,
      responseIntent: input.plan.responseIntent,
      activeQuestDisplayName
    }));
    return {
      output: {
        text: fallbackText,
        actionProposals: input.generate.actionProposals,
        llmBackend: "deterministic",
        repaired: true
      },
      diagnostics: createDiagnostics(
        this.stageId,
        startedAt,
        "degraded",
        {
          repaired: true,
          trigger: "judge-fail-regen-fallback",
          judgeViolations: input.judge.violations,
          regenProduced: Boolean(regenText)
        },
        "repair-fallback"
      ),
      status: "degraded"
    };
  }
}
