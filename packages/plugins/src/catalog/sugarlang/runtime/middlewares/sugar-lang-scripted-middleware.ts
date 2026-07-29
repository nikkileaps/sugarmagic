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
import { resolveDialogueSpeaker } from "@sugarmagic/domain";
import type { LemmaRef, SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices, SugarlangExecutionServices } from "../runtime-services";
import { diglotWeave } from "../classifier/diglot-weave";
import { getAllInventoryChunks } from "../inventory/competency-inventory-loader";
import { createSugarlangLogger } from "../logger";
import type { SugarlangLoggerLike } from "./shared";
import {
  isScriptedMode,
  normalizeTurn,
  shouldRunSugarlangForExecution,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_SCHEDULE_ANNOTATION
} from "./shared";
import type { TeachSchedule } from "../scheduler/teach-schedule";
import type { VariantCacheKey } from "../compile/variant-cache";
import { VARIANT_PROMPT_VERSION } from "../compile/generate-variant";
import { INTENT_EXTRACTOR_PROMPT_VERSION } from "../compile/extract-intent";
import type { LineIntentCacheKey } from "../compile/intent-cache";
import { buildIntentContentHash } from "../compile/intent-cache";
import type { CEFRBand } from "../contracts/learner-profile";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import type { LiveRenderCacheKey } from "../compile/live-render-cache";
import { buildTeachablesKey } from "../compile/live-render-cache";
import { verifyLiveRender } from "../compile/verify-live-render";

export interface SugarLangScriptedMiddlewareDeps {
  services: SugarlangRuntimeServices;
  logger?: SugarlangLoggerLike;
}

/**
 * Speakers that should NOT be adapted -- narration and voice-over stay as-is.
 *
 * NOTE the deliberate asymmetry: `player` is ADAPTABLE here while `player-vo`
 * is not. Player choice text is authored dialogue the learner reads and so gets
 * woven; voice-over, narration and excerpts are authorial voice and stay in the
 * support language. This is the one place in the repo that partitions built-in
 * speakers this way -- it is not an oversight, so do not "align" it with the
 * player/player-vo split used by `isPlayerSpokenTurn` and friends.
 */
function isNonAdaptableSpeaker(speakerId: string | undefined): boolean {
  const speaker = resolveDialogueSpeaker(speakerId, null);
  if (!speaker) return false;
  switch (speaker.kind) {
    case "player-vo":
    case "narrator":
    case "excerpt":
      return true;
    case "player":
    case "npc":
      return false;
  }
}

/**
 * Filters intent-artifact mustConveyFacts down to entries that are real
 * teachable references before they become LemmaRefs.
 *
 * The extractor prompt deliberately allows mixed output: "each entry is either a
 * target-language lemmaId or a short English fact string." The English facts are
 * for the fidelity gate ONLY -- mapping them verbatim into
 * constraint.targetVocab.introduce would put fake lemmaIds ("the merchant
 * arrives at dawn") into the weave/highlight/observe machinery, which contracts
 * LemmaRef.lemmaId as an atlas lemmaId or a chunk: ref.
 *
 * Validation: atlas membership for bare ids, competency-inventory membership for
 * chunk: refs. Anything that resolves to neither is dropped here.
 */
function validateTeachableFacts(
  facts: string[],
  targetLanguage: string,
  services: SugarlangExecutionServices
): string[] {
  let inventoryChunkIds: Set<string> | null = null;
  return facts.filter((fact) => {
    if (fact.startsWith("chunk:")) {
      if (!inventoryChunkIds) {
        inventoryChunkIds = new Set(
          getAllInventoryChunks(targetLanguage).map((chunk) => chunk.chunkId)
        );
      }
      return inventoryChunkIds.has(fact.slice("chunk:".length));
    }
    return Boolean(services.atlas.getLemma(fact, targetLanguage));
  });
}

/**
 * Builds the contentHash for a dialogue node as the VARIANT cache expects it.
 * The variant pipeline keys on JSON.stringify({}) on both bake and runtime sides
 * deliberately -- intent is embedded in the LLM prompt, not the cache key, so
 * variant cache hits survive hand-authored intent edits.
 * Do NOT use this for the intent cache key; use buildIntentContentHash there.
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
  let inventoryChunks: import("../contracts/competency-inventory").InventoryChunk[] = [];
  try {
    inventoryChunks = getAllInventoryChunks(targetLanguage);
  } catch {
    // Missing inventory for this language -- weave proceeds with no chunk substitutions.
  }
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
        const nodeId = String(normalizedTurn.metadata?.nodeId ?? "");
        if (nodeId && services.intentCache) {
          try {
            const dialogueDefId = execution.selection.dialogueDefinitionId ?? "";
            const nodeIntent = dialogueDefId
              ? services.dialogueDefinitions
                  .find((d) => d.definitionId === dialogueDefId)
                  ?.nodes.find((n) => n.nodeId === nodeId)?.intent
              : undefined;
            const intentKey: LineIntentCacheKey = {
              contentHash: buildIntentContentHash(nodeId, authoredText, nodeIntent),
              intentPromptVersion: INTENT_EXTRACTOR_PROMPT_VERSION
            };
            const intentEntry = await services.intentCache.get(intentKey);
            if (intentEntry && intentEntry.artifact.mustConveyFacts.length > 0) {
              const existing = new Set(
                constraint.targetVocab.introduce.map((l) => l.lemmaId)
              );
              const extras: LemmaRef[] = validateTeachableFacts(
                intentEntry.artifact.mustConveyFacts,
                targetLanguage,
                services
              )
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

      const nodeId = String(normalizedTurn.metadata?.nodeId ?? "");
      const contentHash = buildVariantContentHash(nodeId, authoredText);
      const band = constraint.learnerCefr as CEFRBand;

      let usedVariant = false;

      // 087.5: deterministic trigger -- due teachable x line-intent match x strain headroom.
      // Reads the outer-loop schedule (written by context middleware) and the intent artifact
      // for this node (baked by the compile pipeline). When a scheduled due item's id appears
      // in the line's mustConveyFacts AND the learner is not in strain-suppressed mode,
      // the line renders live with the due word woven in.
      const dialogueDefinitionId = execution.selection.dialogueDefinitionId ?? "";
      const nodeIntent = dialogueDefinitionId && nodeId
        ? services.dialogueDefinitions
            .find((d) => d.definitionId === dialogueDefinitionId)
            ?.nodes.find((n) => n.nodeId === nodeId)?.intent
        : undefined;
      const intentContentHash = buildIntentContentHash(nodeId, authoredText, nodeIntent);
      const schedule = execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] as TeachSchedule | undefined;
      let liveRenderTriggered = false;
      let liveRenderIntroduce = constraint.targetVocab.introduce;

      if (nodeId && schedule && !schedule.strainSuppressed && services.intentCache) {
        try {
          const intentKey: LineIntentCacheKey = {
            contentHash: buildIntentContentHash(nodeId, authoredText, nodeIntent),
            intentPromptVersion: INTENT_EXTRACTOR_PROMPT_VERSION
          };
          const intentEntry = await services.intentCache.get(intentKey);
          if (intentEntry && intentEntry.artifact.mustConveyFacts.length > 0) {
            const factSet = new Set(intentEntry.artifact.mustConveyFacts);
            const dueMatches: LemmaRef[] = schedule.teachables
              .filter((t) => t.teachReason === "due" && factSet.has(t.id))
              .map((t) => ({ lemmaId: t.id, lang: targetLanguage }));
            if (dueMatches.length > 0) {
              liveRenderTriggered = true;
              liveRenderIntroduce = dueMatches;
            }
          }
        } catch {
          // Trigger check is optional -- never error the turn; fall through to baked variant
        }
      }

      if (liveRenderTriggered) {
        const introduce = liveRenderIntroduce;
        const teachablesKey = buildTeachablesKey(introduce);
        const liveKey: LiveRenderCacheKey = {
          nodeId,
          dialogueDefinitionId,
          lang: constraint.targetLanguage,
          band,
          posture: constraint.supportPosture,
          teachablesKey
        };

        try {
          // Cache hit: skip LLM entirely.
          const cached = services.liveRenderCache?.get(liveKey) ?? null;
          if (cached) {
            normalizedTurn.text = cached.text;
            usedVariant = true;
            logger.debug("Scripted line: live-render cache hit (zero LLM).", {
              nodeId,
              band,
              lang: constraint.targetLanguage
            });
          } else if (services.llmClient) {
            // Cache miss: call the LLM to render the line live.
            const inventoryChunks = getAllInventoryChunks(constraint.targetLanguage);
            const llmResult = await services.llmClient.generate({
              systemPrompt: [
                `You are a dialogue writer for a language-learning game.`,
                `Render the given English dialogue line in ${constraint.targetLanguage} for a ${band} learner.`,
                `Return only the translated/adapted line, nothing else.`
              ].join(" "),
              userPrompt: [
                `Target language: ${constraint.targetLanguage}`,
                `Learner level: ${band}`,
                `\nOriginal English line:\n${authoredText}`
              ].join("\n"),
              maxTokens: 300
            });

            const renderedText = llmResult.text.trim();
            if (renderedText) {
              // Verify with deterministic gates only (no LLM fidelity judge at runtime).
              const verdict = verifyLiveRender({
                text: renderedText,
                targetLang: constraint.targetLanguage,
                band,
                posture: constraint.supportPosture,
                directedRatio: constraint.targetLanguageRatio,
                introduce,
                inventoryChunks,
                atlas: services.atlas
              });

              if (verdict.overallPasses) {
                // Cache and use the live render.
                services.liveRenderCache?.set(liveKey, {
                  text: renderedText,
                  verdict,
                  cachedAtMs: Date.now()
                });
                normalizedTurn.text = renderedText;
                usedVariant = true;
                logger.debug("Scripted line: live-render produced and cached.", {
                  nodeId,
                  band,
                  lang: constraint.targetLanguage
                });
              }
              // On verify failure: fall through to baked variant below (usedVariant stays false).
            }
            // On empty response or LLM error caught below: fall through (usedVariant stays false).
          }
        } catch {
          // Any live-render failure is non-fatal -- fall through to baked variant below.
        }
      }

      // Only consult the baked variant when the live render did NOT produce the
      // line. Without the !usedVariant gate a baked-variant cache hit overwrites
      // a successful live render -- and since baked variants exist for every node
      // in a baked scene, that is exactly where the 087.5 trigger is meant to fire.
      if (!usedVariant && services.variantCache) {
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
                  contentHash: intentContentHash,
                  intentPromptVersion: INTENT_EXTRACTOR_PROMPT_VERSION
                };
                const intentEntry = await services.intentCache.get(intentKey);
                if (intentEntry && intentEntry.artifact.mustConveyFacts.length > 0) {
                  const lemmaRefs: LemmaRef[] = validateTeachableFacts(
                    intentEntry.artifact.mustConveyFacts,
                    targetLanguage,
                    services
                  ).map((fact) => ({ lemmaId: fact, lang: targetLanguage }));
                  if (lemmaRefs.length > 0) {
                    constraint.targetVocab = {
                      introduce: lemmaRefs,
                      reinforce: constraint.targetVocab.reinforce,
                      avoid: constraint.targetVocab.avoid
                    };
                    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = constraint;
                  }
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
