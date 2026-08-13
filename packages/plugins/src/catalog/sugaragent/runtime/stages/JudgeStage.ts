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

import { noteTurnFact } from "@sugarmagic/runtime-core";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import { QUEST_CONTEXT_ANNOTATION_KEY } from "../quest/quest-context-middleware";
import type { QuestContextAnnotation } from "../quest/quest-context-middleware";
import { collectContributions } from "../contributions";
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

/**
 * Name the lore page the world context was quoted from before the judge reads
 * it. The judge scores the reply against this block, so an unattributed page
 * written about a different character reads as the NPC's own ground truth and
 * an in-character reply comes back as an IN-CHARACTER failure (#171).
 */
function attributeWorldContext(
  annotation: QuestContextAnnotation | undefined
): string | null {
  const text = annotation?.worldContext ?? null;
  if (!text) return null;
  const title = annotation?.worldContextTitle ?? null;
  const source = title ? `the lore page "${title}"` : "a lore page";
  if (annotation?.worldContextIsOwnPage) {
    return `From ${source}, this NPC's own:\n${text}`;
  }
  return `From ${source} -- background about the world, not a description of this NPC:\n${text}`;
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
    context: TurnStageContext
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
    // Fallback: if no lore-page persona, use the NPC definition description
    // as the identity anchor -- the same fallback buildStableSystemLines uses.
    const personaDigest =
      input.state.persona?.digest ||
      (input.execution.selection.npcDescription
        ? `NPC description: ${input.execution.selection.npcDescription}`
        : "");
    if (!personaDigest) {
      return skipResult(startedAt, "no-persona");
    }
    const loreContextSummary = input.retrieve.loreContext.map((item) =>
      item.text.slice(0, 300)
    );
    const questAnnotation =
      input.execution.annotations[QUEST_CONTEXT_ANNOTATION_KEY] as
        | QuestContextAnnotation
        | undefined;
    const worldContext = attributeWorldContext(questAnnotation);

    const { judgeDirectives } = collectContributions(input.execution.annotations);

    try {
      const verdict = await this.judgeProvider.judgeReply({
        replyText: input.generate.text,
        personaDigest,
        responseIntent: input.plan.responseIntent,
        worldContext,
        loreContextSummary,
        worldPremise: context.config.worldPremise ?? "",
        ...(judgeDirectives.length > 0 ? { externalDirectives: judgeDirectives } : {})
      });

      // PHASE 2: A LANGUAGE FAILURE NOW STOPS THE LINE.
      //
      // Phase 1 reported and did nothing. This routes a language failure down
      // the path a character or safety failure already takes -- Regenerate --
      // rather than building a second repair mechanism. The gateway keeps
      // `passed` meaning "the rubric passed" and reports language separately,
      // so the decision to gate lives here, in the plugin, and flipping it
      // needs no gateway deploy.
      //
      // ONLY WITH A REASON. A false verdict carrying no note gives Regenerate
      // nothing to act on, and a blind retry is what the story warns against:
      // it would spend 5-8s to roll the dice again. No note, no gate.
      //
      // REVISIT TRIGGER: this was switched on against a 0-of-3 flag rate,
      // which is barely any data. If `judgeLanguageFit=FALSE` turns out common
      // in real play, this recreates the every-turn repair the latency epic
      // just deleted, with a smarter judge doing it. Watch the Regenerate line
      // on the turn timeline; if it is firing often, take this branch back out
      // and fix the generator and Teacher prompts instead (sugarmagic-latency-tsg).
      const languageNote = verdict.languageNote?.trim();
      const languageFailure = verdict.languageFit === false && !!languageNote;

      const output: JudgeResult = {
        ...verdict,
        passed: verdict.passed && !languageFailure,
        violations: languageFailure
          ? [...verdict.violations, `LANGUAGE_FIT: ${languageNote}`]
          : verdict.violations,
        // Keep a rubric hint if there is one -- it is about a real violation.
        // Otherwise the language note IS the instruction.
        repairHint: verdict.repairHint ?? (languageFailure ? (languageNote ?? null) : null),
        // Language alone failed this: the rubric itself passed.
        languageOnlyFailure: languageFailure && verdict.passed,
        skipped: false,
        errorOccurred: false
      };

      // ON THE TIMELINE, NOT ONLY IN DIAGNOSTICS. The verdict has always been
      // in the diagnostics payload, but the console collapses that object, so
      // a turn that failed the judge and paid seconds of Regenerate showed
      // only status:degraded with no readable reason. A flag rate cannot be
      // measured from something nobody can read (sugarmagic-latency-tsg).
      noteTurnFact(
        "judge",
        output.passed ? "pass" : `FAIL:${output.violations.join(",") || "unspecified"}`
      );
      // ALWAYS RECORDED, INCLUDING WHEN IT PASSES. Printing only failures made
      // absence mean two different things -- "the judge saw no language
      // problem" and "this gateway predates the language dimension and never
      // returned one" -- which are indistinguishable in a log and would have
      // been read as a 0% flag rate either way. That is the measurement tsg
      // phase 1 exists to take, so it must not be able to lie. Absent now
      // means only one thing: an old gateway.
      if (output.languageFit !== undefined) {
        noteTurnFact(
          "judgeLanguageFit",
          output.languageFit ? "true" : `FALSE:${output.languageNote ?? "unspecified"}`
        );
      }
      // Distinct from a plain FALSE: this says the flag actually cost a
      // regeneration. It is the number that decides whether phase 2 stays.
      if (languageFailure) {
        noteTurnFact("judgeLanguageGated", true);
      }

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
          // A DISTINCT REASON, BECAUSE THE LADDER MUST DIVERGE HERE.
          //
          // `judge-fail` feeds two escalators: consecutiveJudgeFailures, which
          // at 3 replaces the NPC's line with a canned template, and
          // isStalledTurn, which at 3 force-closes the conversation. Both are
          // right for a reply that is unsafe or out of character. Neither is
          // right for one that is merely too advanced -- the template is not
          // better Spanish, so swapping it in trades good dialogue that taught
          // poorly for worse dialogue that also taught poorly, and hanging up
          // ends a session the player did nothing to break.
          //
          // The recourse for a language failure is: regenerate once, then ship
          // the line and record the flag. Same principle psm settled -- out of
          // envelope but grammatical beats in-envelope nonsense.
          output.passed ? null : output.languageOnlyFailure ? "judge-language-fail" : "judge-fail"
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
