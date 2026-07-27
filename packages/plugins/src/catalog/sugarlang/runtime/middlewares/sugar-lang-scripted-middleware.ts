/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-scripted-middleware.ts
 *
 * Purpose: Adapts scripted (authored English) NPC dialogue to the learner's
 *          language level. Runs in the analysis stage at priority 15 (after
 *          verify at 20, before observe at 90).
 *
 * For anchored/supported postures: diglot weave (zero LLM calls).
 * For target-dominant posture: reads baked variant from variant cache; degrades
 *   to diglotWeave when cache miss or no variant cache wired (zero LLM calls).
 *
 * For scripted dialogue:
 *   1. Reads the authored English turn text
 *   2. Reads the sugarlang constraint (posture/ratio)
 *   3a. anchored/supported: calls diglotWeave; updates constraint.targetVocab.introduce
 *       from woven forms (supplemented by intent artifact teachables when available)
 *   3b. target-dominant: reads baked variant from cache; updates constraint.targetVocab.introduce
 *       from intent artifact teachables; degrades to weave on cache miss
 *   4. Replaces turn.text with the adapted version
 *
 * Skips: agent mode turns, player VO turns, turns without a constraint.
 *
 * Exports:
 *   - createSugarLangScriptedMiddleware
 *
 * Status: active
 */

import type { ConversationMiddleware, ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import {
  PLAYER_VO_SPEAKER,
  NARRATOR_SPEAKER,
  EXCERPT_SPEAKER
} from "@sugarmagic/domain";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices, SugarlangExecutionServices } from "../runtime-services";
import { diglotWeave } from "../classifier/diglot-weave";
import { getAllInventoryChunks } from "../inventory/function-inventory-loader";
import { createSugarlangLogger } from "../logger";
import type { SugarlangLoggerLike } from "./shared";
import {
  isScriptedMode,
  normalizeTurn,
  shouldRunSugarlangForExecution,
  SUGARLANG_CONSTRAINT_ANNOTATION
} from "./shared";
import type { VariantCacheKey } from "../compile/variant-cache";
import { VARIANT_PROMPT_VERSION } from "../compile/generate-variant";
import { INTENT_EXTRACTOR_PROMPT_VERSION } from "../compile/extract-intent";
import type { LineIntentCacheKey } from "../compile/intent-cache";
import type { CEFRBand } from "../contracts/learner-profile";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";

export interface SugarLangScriptedMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
}

/** Speakers that should NOT be adapted -- narration and voice-over stay as-is. */
function isNonAdaptableSpeaker(speakerId: string | undefined): boolean {
  return (
    speakerId === PLAYER_VO_SPEAKER.speakerId ||
    speakerId === NARRATOR_SPEAKER.speakerId ||
    speakerId === EXCERPT_SPEAKER.speakerId
  );
}

/**
 * Builds the contentHash for a dialogue node as the variant cache expects it.
 * Matches the key computed in compile-scheduler variantPipeline:
 *   [nodeId, text, JSON.stringify(intent)].join("|")
 * At runtime we have no intent artifact yet (that's a bake-time product), so
 * we use JSON.stringify({}) to match the scheduler's no-intent default.
 */
function buildVariantContentHash(nodeId: string, nodeText: string): string {
  return [nodeId, nodeText, JSON.stringify({})].join("|");
}

/**
 * Runs diglotWeave on the authored text using the prescription's introduce list,
 * then updates constraint.targetVocab.introduce with the woven forms.
 * Shared between anchored/supported and the target-dominant degradation path.
 */
function applyWeave(
  authoredText: string,
  constraint: SugarlangConstraint,
  execution: ConversationExecutionContext,
  normalizedTurn: ConversationTurnEnvelope,
  services: SugarlangExecutionServices,
  targetLanguage: string,
  supportLanguage: string,
  logger: SugarlangLoggerLike,
  posture: string
): void {
  const prescriptionIntroduce = constraint.targetVocab.introduce;
  const inventoryChunks = getAllInventoryChunks(targetLanguage);
  const weaveResult = diglotWeave(
    authoredText,
    prescriptionIntroduce,
    inventoryChunks,
    services.atlas,
    targetLanguage,
    supportLanguage
  );

  if (weaveResult.weavedForms.length > 0) {
    normalizedTurn.text = weaveResult.text;
    // Replace the introduce list with only the woven forms so the observe
    // middleware highlights exactly what was substituted. (086.4: gloss-scan
    // lineIntroduce deleted; weave forms + intent artifact are the signal.)
    const wovenLemmaRefs: LemmaRef[] = weaveResult.weavedForms.map((wf) => ({
      lemmaId: wf.lemmaId,
      lang: targetLanguage
    }));
    constraint.targetVocab = {
      introduce: wovenLemmaRefs,
      reinforce: constraint.targetVocab.reinforce,
      avoid: constraint.targetVocab.avoid
    };
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
  }

  logger.debug("Scripted line woven (zero LLM).", {
    authoredText,
    wovenText: normalizedTurn.text,
    weavedCount: weaveResult.weavedForms.length,
    posture
  });
}

export function createSugarLangScriptedMiddleware(
  deps: SugarLangScriptedMiddlewareDeps
): ConversationMiddleware {
  const logger = deps.logger ?? createSugarlangLogger({ debugLogging: false });

  return {
    middlewareId: "sugarlang.scripted",
    displayName: "Sugarlang Scripted Adaptation",
    priority: 15,
    stage: "analysis",
    async finalize(execution, turn) {
      const normalizedTurn = normalizeTurn(turn);
      if (!normalizedTurn) return turn;
      if (!shouldRunSugarlangForExecution(execution)) return normalizedTurn;
      if (!isScriptedMode(execution)) return normalizedTurn;
      if (isNonAdaptableSpeaker(normalizedTurn.speakerId)) return normalizedTurn;

      const constraint = execution.annotations[
        SUGARLANG_CONSTRAINT_ANNOTATION
      ] as SugarlangConstraint | undefined;
      // 086.4: gate on constraint existence only (generatorPromptOverlay no
      // longer set by the scripted branch of the teacher middleware).
      if (!constraint) return normalizedTurn;

      const authoredText = normalizedTurn.text;
      const targetLanguage = constraint.targetLanguage;
      const supportLanguage = execution.selection.supportLanguage ?? "en";

      // Anchored and supported postures use the zero-LLM weave path (086.2).
      // The English frame is expected; introduced lemmas are substituted bare.
      if (
        constraint.supportPosture === "anchored" ||
        constraint.supportPosture === "supported"
      ) {
        const services = await deps.services.resolveForExecution(execution);
        if (!services) return normalizedTurn;

        applyWeave(
          authoredText,
          constraint,
          execution,
          normalizedTurn,
          services,
          targetLanguage,
          supportLanguage,
          logger,
          constraint.supportPosture
        );

        // Optional enrichment: supplement introduce list from intent artifact
        // teachables if the intent cache has an entry for this node.
        const nodeId = String(execution.annotations["sugarlang.currentNodeId"] ?? "");
        if (nodeId && services.intentCache) {
          try {
            const intentKey: LineIntentCacheKey = {
              contentHash: buildVariantContentHash(nodeId, authoredText),
              intentPromptVersion: INTENT_EXTRACTOR_PROMPT_VERSION
            };
            const intentEntry = await services.intentCache.get(intentKey);
            if (intentEntry && intentEntry.artifact.mustConveyFacts.length > 0) {
              const existing = new Set(
                constraint.targetVocab.introduce.map((l) => l.lemmaId)
              );
              const extras: LemmaRef[] = intentEntry.artifact.mustConveyFacts
                .filter((fact) => !existing.has(fact))
                .map((fact) => ({ lemmaId: fact, lang: targetLanguage }));
              if (extras.length > 0) {
                constraint.targetVocab = {
                  introduce: [...constraint.targetVocab.introduce, ...extras],
                  reinforce: constraint.targetVocab.reinforce,
                  avoid: constraint.targetVocab.avoid
                };
                execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
              }
            }
          } catch {
            // Intent cache is optional enrichment -- never error the turn
          }
        }

        return normalizedTurn;
      }

      // target-dominant posture: read baked variant from variant cache (086.4).
      // Degrades gracefully to diglotWeave when the cache is cold or unavailable.
      const services = await deps.services.resolveForExecution(execution);
      if (!services) return normalizedTurn;

      const nodeId = String(execution.annotations["sugarlang.currentNodeId"] ?? "");
      const contentHash = buildVariantContentHash(nodeId, authoredText);
      const band = constraint.learnerCefr as CEFRBand;

      let usedVariant = false;

      if (services.variantCache) {
        try {
          const cacheKey: VariantCacheKey = {
            lang: targetLanguage,
            band,
            contentHash,
            variantPromptVersion: VARIANT_PROMPT_VERSION
          };
          const cached = await services.variantCache.get(cacheKey);
          if (cached) {
            normalizedTurn.text = cached.variant.text;
            usedVariant = true;

            // Populate introduce from intent artifact teachables when available.
            if (services.intentCache) {
              try {
                const intentKey: LineIntentCacheKey = {
                  contentHash,
                  intentPromptVersion: INTENT_EXTRACTOR_PROMPT_VERSION
                };
                const intentEntry = await services.intentCache.get(intentKey);
                if (intentEntry && intentEntry.artifact.mustConveyFacts.length > 0) {
                  const lemmaRefs: LemmaRef[] = intentEntry.artifact.mustConveyFacts.map(
                    (fact) => ({ lemmaId: fact, lang: targetLanguage })
                  );
                  constraint.targetVocab = {
                    introduce: lemmaRefs,
                    reinforce: constraint.targetVocab.reinforce,
                    avoid: constraint.targetVocab.avoid
                  };
                  execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
                }
              } catch {
                // Intent cache enrichment is optional -- never error the turn
              }
            }

            logger.debug("Scripted line: baked variant used (target-dominant, zero LLM).", {
              authoredText,
              variantText: cached.variant.text,
              band,
              lang: targetLanguage
            });
          }
        } catch {
          // Variant cache failure is non-fatal -- degrade to weave below
        }
      }

      if (!usedVariant) {
        // Degrade: no variant cache, cache miss, or lookup error.
        // Run diglotWeave to at least produce introduce highlights.
        logger.debug("Scripted line (target-dominant): variant cache miss -- degrading to weave.", {
          authoredText,
          band,
          lang: targetLanguage,
          hasVariantCache: Boolean(services.variantCache),
          nodeId: nodeId || "(none)"
        });
        applyWeave(
          authoredText,
          constraint,
          execution,
          normalizedTurn,
          services,
          targetLanguage,
          supportLanguage,
          logger,
          "target-dominant"
        );
      }

      return normalizedTurn;
    }
  };
}
