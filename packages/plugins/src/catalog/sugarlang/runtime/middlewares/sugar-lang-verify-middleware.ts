/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-verify-middleware.ts
 *
 * Purpose: Implements the analysis-stage middleware that verifies generated turns against the comprehension envelope.
 *
 * Exports:
 *   - createSugarLangVerifyMiddleware
 *
 * Relationships:
 *   - Depends on the Sugarlang runtime service graph and ConversationMiddleware interface.
 *   - Reads the final constraint and enforces the envelope with one repair retry plus deterministic simplification fallback.
 *
 * Implements: Proposal 001 §End-to-End Turn Flow
 *
 * Status: active
 */

import type { ConversationMiddleware } from "@sugarmagic/runtime-core";
import { autoSimplify } from "../classifier/auto-simplify";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import type { SugarlangLLMClient } from "../llm/types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import type { SugarlangConstraint } from "../types";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  buildLearnerSnapshot,
  createNoOpSugarlangLogger,
  findQuestEssentialUses,
  getSugarlangConversationId,
  getSugarlangTelemetryTurnId,
  getSugarAgentSessionId,
  getSceneId,
  normalizeTurn,
  textMentionsLemma,
  type SugarlangLoggerLike
} from "./shared";

export interface SugarLangVerifyMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

async function attemptRepair(
  originalText: string,
  instructions: string[],
  llmClient: SugarlangLLMClient | null,
  constraint: SugarlangConstraint
): Promise<string | null> {
  if (!llmClient) {
    return null;
  }

  const result = await llmClient.generate({
    model: "claude-sonnet-4-6",
    systemPrompt:
      "Rewrite the NPC turn so it keeps the same meaning but uses simpler vocabulary and obeys the supplied language-learning constraints. Return only the rewritten NPC line.",
    userPrompt: [
      `Original: ${originalText}`,
      `Required fixes: ${instructions.join(" | ")}`,
      `Forbidden lemmas: ${constraint.targetVocab.avoid.map((lemma) => lemma.lemmaId).join(", ") || "(none)"}`,
      `Introduce once: ${constraint.targetVocab.introduce.map((lemma) => lemma.lemmaId).join(", ") || "(none)"}`,
      `Reinforce naturally: ${constraint.targetVocab.reinforce.map((lemma) => lemma.lemmaId).join(", ") || "(none)"}`
    ].join("\n"),
    maxTokens: 220
  });
  return result.text.trim() || null;
}

export function createSugarLangVerifyMiddleware(
  deps: SugarLangVerifyMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? createNoOpTelemetrySink();

  return {
    middlewareId: "sugarlang.verify",
    displayName: "Sugarlang Verify Middleware",
    priority: 20,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!normalizedTurn) {
        return turn;
      }

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      if (!constraint) {
        return normalizedTurn;
      }

      const placementFlow = execution.annotations[
        SUGARLANG_PLACEMENT_FLOW_ANNOTATION
      ] as { phase?: string } | undefined;
      const conversationId = getSugarlangConversationId(execution);
      const sessionId = getSugarAgentSessionId(execution);
      const traceTurnId = getSugarlangTelemetryTurnId(execution, "finalize");
      if (constraint.prePlacementOpeningLine || placementFlow?.phase === "opening-dialog") {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("verify.pre-placement-bypass", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId: getSceneId(execution)
          }),
          logger
        );
        return normalizedTurn;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return normalizedTurn;
      }
      const originalTurnText = normalizedTurn.text;

      const learner = await services.learnerStore.getCurrentProfile();
      const sceneId = getSceneId(execution);
      if (!sceneId) {
        return normalizedTurn;
      }
      const scene = await services.sceneLexiconStore.ensure(sceneId);
      const questEssentialLemmaIds = execution.annotations[
        "sugarlang.questEssentialLemmaIds"
      ] as Set<string> | undefined;
      const verdict = services.classifier.check(normalizedTurn.text, learner, {
        prescription: constraint.rawPrescription,
        knownEntities: new Set(scene.properNouns),
        questEssentialLemmas: questEssentialLemmaIds ?? new Set<string>(),
        lang: constraint.targetLanguage,
        sceneLexicon: scene,
        conversationId,
        sessionId,
        turnId: traceTurnId
      });
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("classifier.verdict", {
          conversationId,
          sessionId,
          turnId: traceTurnId,
          timestamp: Date.now(),
          sceneId,
          learnerSnapshot: buildLearnerSnapshot(learner),
          prescription: constraint.rawPrescription,
          verdict,
          inputText: normalizedTurn.text,
          constraint
        }),
        logger
      );
      for (const lemmaId of verdict.profile.questEssentialLemmasMatched) {
        const questEssential = constraint.questEssentialLemmas?.find(
          (entry) => entry.lemmaRef.lemmaId === lemmaId
        );
        if (!questEssential) {
          continue;
        }
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("quest-essential.classifier-exempted-lemma", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            lemmaRef: questEssential.lemmaRef,
            cefrBand:
              scene.questEssentialLemmas.find((entry) => entry.lemmaId === lemmaId)?.cefrBand ??
              "unknown",
            learnerBand: learner.estimatedCefrBand,
            sourceObjectiveDisplayName: questEssential.sourceObjectiveDisplayName
          }),
          logger
        );
      }

      const questUses = findQuestEssentialUses(normalizedTurn.text, constraint);
      const missingGloss = questUses.find(
        (entry) => textMentionsLemma(normalizedTurn.text, entry.lemmaId) && !entry.hasParentheticalGloss
      );
      const missingRequiredQuestEssential =
        (constraint.questEssentialLemmas?.length ?? 0) > 0 &&
        (execution.runtimeContext?.activeQuestObjectives?.objectives.length ?? 0) > 0 &&
        !constraint.questEssentialLemmas?.some((entry) =>
          textMentionsLemma(normalizedTurn.text, entry.lemmaRef.lemmaId)
        )
          ? constraint.questEssentialLemmas?.[0] ?? null
          : null;
      if (missingGloss) {
        const questEssential = constraint.questEssentialLemmas?.find(
          (entry) => entry.lemmaRef.lemmaId === missingGloss.lemmaId
        );
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("quest-essential.generator-missed-gloss", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            lemmaRef:
              questEssential?.lemmaRef ?? {
                lemmaId: missingGloss.lemmaId,
                lang: constraint.targetLanguage
              },
            expectedGloss: missingGloss.supportLanguageGloss,
            generatedText: normalizedTurn.text,
            sourceObjectiveDisplayName: questEssential?.sourceObjectiveDisplayName
          }),
          logger
        );
      }
      if (missingRequiredQuestEssential) {
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("quest-essential.generator-missed-required", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            expectedLemmas: [missingRequiredQuestEssential.lemmaRef],
            generatedText: normalizedTurn.text,
            sourceObjectiveDisplayName:
              missingRequiredQuestEssential.sourceObjectiveDisplayName
          }),
          logger
        );
      }

      if (verdict.withinEnvelope && !missingGloss && !missingRequiredQuestEssential) {
        return normalizedTurn;
      }

      const instructions = [
        ...verdict.violations.map(
          (violation) => `Remove or simplify "${violation.lemmaRef.lemmaId}".`
        ),
        ...(missingGloss
          ? [
              `You used "${missingGloss.lemmaId}" without the required parenthetical translation. Add "(${missingGloss.supportLanguageGloss})" immediately after "${missingGloss.lemmaId}".`
            ]
          : []),
        ...(missingRequiredQuestEssential
          ? [
              `Mention the current quest objective using "${missingRequiredQuestEssential.lemmaRef.lemmaId}" with "(${missingRequiredQuestEssential.supportLanguageGloss})".`
            ]
          : [])
      ];
      const repairedText = await attemptRepair(
        normalizedTurn.text,
        instructions,
        services.llmClient,
        constraint
      );
      if (repairedText) {
        const repairedVerdict = services.classifier.check(repairedText, learner, {
          prescription: constraint.rawPrescription,
          knownEntities: new Set(scene.properNouns),
          questEssentialLemmas: questEssentialLemmaIds ?? new Set<string>(),
          lang: constraint.targetLanguage,
          sceneLexicon: scene,
          conversationId,
          sessionId,
          turnId: traceTurnId
        });
        const repairedQuestUses = findQuestEssentialUses(repairedText, constraint);
        const repairedMissingGloss = repairedQuestUses.find(
          (entry) =>
            textMentionsLemma(repairedText, entry.lemmaId) &&
            !entry.hasParentheticalGloss
        );
        const repairedMissingRequired =
          (constraint.questEssentialLemmas?.length ?? 0) > 0 &&
          (execution.runtimeContext?.activeQuestObjectives?.objectives.length ?? 0) > 0 &&
          !constraint.questEssentialLemmas?.some((entry) =>
            textMentionsLemma(repairedText, entry.lemmaRef.lemmaId)
          );
        if (
          repairedVerdict.withinEnvelope &&
          !repairedMissingGloss &&
          !repairedMissingRequired
        ) {
          normalizedTurn.text = repairedText;
          await emitTelemetry(
            telemetry,
            createTelemetryEvent("verify.repair-triggered", {
              conversationId,
              sessionId,
              turnId: traceTurnId,
              timestamp: Date.now(),
              sceneId,
              originalText: originalTurnText,
              repairedText,
              violations: instructions,
              repairPrompt: instructions
            }),
            logger
          );
          return normalizedTurn;
        }
      }

      try {
        const simplified = autoSimplify(
          normalizedTurn.text,
          verdict.violations.map((violation) => violation.lemmaRef),
          learner
        );
        const originalText = normalizedTurn.text;
        normalizedTurn.text = simplified.text;
        await emitTelemetry(
          telemetry,
          createTelemetryEvent("verify.auto-simplify-triggered", {
            conversationId,
            sessionId,
            turnId: traceTurnId,
            timestamp: Date.now(),
            sceneId,
            originalText,
            simplifiedText: simplified.text,
            substitutions: verdict.violations.map(
              (violation) => violation.lemmaRef.lemmaId
            )
          }),
          logger
        );
      } catch (error) {
        logger.warn("Sugarlang autoSimplify failed; returning original turn.", {
          reason: error instanceof Error ? error.message : String(error)
        });
      }

      return normalizedTurn;
    }
  };
}
