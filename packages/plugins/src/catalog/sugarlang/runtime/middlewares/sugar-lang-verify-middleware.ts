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
import type { TelemetrySink } from "../telemetry/telemetry";
import type { SugarlangRuntimeServices } from "../runtime-services";
import type { SugarlangConstraint } from "../types";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  createNoOpSugarlangLogger,
  findQuestEssentialUses,
  getSceneId,
  normalizeTurn,
  textMentionsLemma,
  type SugarlangLoggerLike
} from "./shared";

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

export interface SugarLangVerifyMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
  telemetry?: TelemetrySink;
}

async function attemptRepair(
  originalText: string,
  instructions: string[],
  llmProvider: SugarlangRuntimeServices["resolveForExecution"] extends (
    ...args: any[]
  ) => infer T | null
    ? T extends { llmProvider: infer P }
      ? P
      : never
    : never,
  constraint: SugarlangConstraint
): Promise<string | null> {
  if (!llmProvider) {
    return null;
  }

  const repaired = await llmProvider.generateStructuredTurn({
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
  return repaired.trim() || null;
}

export function createSugarLangVerifyMiddleware(
  deps: SugarLangVerifyMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createNoOpSugarlangLogger();
  const telemetry = deps.telemetry ?? NO_OP_TELEMETRY;

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
      if (constraint.prePlacementOpeningLine || placementFlow?.phase === "opening-dialog") {
        await telemetry.emit("verify.pre-placement-bypass", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation"
        });
        return normalizedTurn;
      }

      const services = deps.services.resolveForExecution(execution);
      if (!services) {
        return normalizedTurn;
      }

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
        lang: constraint.targetLanguage
      });

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
        await telemetry.emit("quest-essential.generator-missed-gloss", {
          lemmaId: missingGloss.lemmaId,
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation"
        });
      }
      if (missingRequiredQuestEssential) {
        await telemetry.emit("quest-essential.generator-missed-required", {
          lemmaId: missingRequiredQuestEssential.lemmaRef.lemmaId,
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation"
        });
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
        services.llmProvider,
        constraint
      );
      if (repairedText) {
        const repairedVerdict = services.classifier.check(repairedText, learner, {
          prescription: constraint.rawPrescription,
          knownEntities: new Set(scene.properNouns),
          questEssentialLemmas: questEssentialLemmaIds ?? new Set<string>(),
          lang: constraint.targetLanguage
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
          await telemetry.emit("verify.turn-repaired", {
            conversationId:
              execution.selection.npcDefinitionId ??
              execution.selection.dialogueDefinitionId ??
              "conversation",
            repaired: true
          });
          return normalizedTurn;
        }
      }

      try {
        const simplified = autoSimplify(
          normalizedTurn.text,
          verdict.violations.map((violation) => violation.lemmaRef),
          learner
        );
        normalizedTurn.text = simplified.text;
        await telemetry.emit("verify.turn-auto-simplified", {
          conversationId:
            execution.selection.npcDefinitionId ??
            execution.selection.dialogueDefinitionId ??
            "conversation",
          substitutionCount: simplified.substitutionCount
        });
      } catch (error) {
        logger.warn("Sugarlang autoSimplify failed; returning original turn.", {
          reason: error instanceof Error ? error.message : String(error)
        });
      }

      return normalizedTurn;
    }
  };
}
