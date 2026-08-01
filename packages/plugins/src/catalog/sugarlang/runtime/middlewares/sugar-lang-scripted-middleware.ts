/**
 * packages/plugins/src/catalog/sugarlang/runtime/middlewares/sugar-lang-scripted-middleware.ts
 *
 * Purpose: Adapts scripted (authored English) NPC dialogue to the learner's
 *          language level. Runs in the analysis stage at priority 15, so it goes
 *          BEFORE verify (20) and observe (90) -- lower priority sorts first.
 *          This header said "after verify at 20" until 2026-07-31, which is
 *          backwards. It is harmless only because verify returns early in
 *          scripted mode; if that early return ever goes, the order matters.
 *
 * For anchored/supported postures: diglot weave (zero LLM calls).
 * For target-dominant posture: reads baked variant from variant cache; degrades
 *   to markGradedText when cache miss or no variant cache wired (zero LLM calls).
 *
 * For scripted dialogue:
 *   1. Reads the authored English turn text
 *   2. Reads the sugarlang constraint (posture/ratio)
 *   3a. anchored/supported: calls markGradedText; updates constraint.targetVocab.introduce
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
import { markGradedText } from "../grading/graded-text-marker";
import { buildDialogueNodeContentHash } from "../grading/sources/dialogue-node-source";
import { vocabularyRefs, type TeachableRef } from "../contracts/teachable-ref";
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
import { LINE_INTENT_PROMPT_VERSION } from "../compile/line-intent-extractor";
import type { LineIntentCacheKey } from "../compile/intent-cache";
import { buildIntentContentHash } from "../compile/intent-cache";
import type { CEFRBand } from "../cefr";
import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
// 090.8c: the live-render cache and its verifier are no longer imported here.
// They remain in compile/ because the BUILD path still needs them (090.11);
// what left is the runtime caller.

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
// 090.4: `validateTeachableFacts` deleted with its two callers. It filtered
// intent facts against the atlas as if they were lemma ids; since 090.1 they are
// propositions, so it filtered everything out.

/**
 * MERGED 2026-07-31. This was a private, byte-identical copy of
 * `buildDialogueNodeContentHash`, which is the bake side of the same key. Two
 * copies of the function that decides whether the runtime finds what the build
 * wrote is the one duplication in this pipeline that fails silently and totally:
 * if they drift, every scripted line misses cache forever and quietly falls
 * through to the weave. Read the full rule at the definition.
 */
const buildVariantContentHash = buildDialogueNodeContentHash;

/**
 * Runs markGradedText on the authored text using the prescription's introduce list,
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
  // 090.4: the marker substitutes WORDS, so it takes the vocabulary half.
  // Competencies on the slate are realized as exponents by the chunk matcher
  // inside the marker, not by word substitution -- narrowing here is explicit so
  // that "competencies do not flow through this argument" is a stated fact
  // rather than an accident of the type.
  const vocabularyIntroduce = vocabularyRefs(constraint.targetVocab.introduce);
  let inventoryChunks: import("../contracts/competency-inventory").InventoryChunk[] = [];
  try {
    inventoryChunks = getAllInventoryChunks(targetLanguage);
  } catch {
    // Missing inventory for this language -- weave proceeds with no chunk substitutions.
  }
  const markResult = markGradedText(
    authoredText,
    vocabularyIntroduce,
    inventoryChunks,
    services.atlas,
    targetLanguage,
    supportLanguage
  );

  if (markResult.markedForms.length > 0) {
    normalizedTurn.text = markResult.text;
    // THIS IS THE LAST WRITER OF `constraint.targetVocab` BESIDES THE TEACHER,
    // and unlike the two 090.4 deleted it is NOT a second decision -- it is a
    // REPORT. It narrows introduce to the forms that were actually placed in
    // this text, so observe highlights and cards what the learner really saw
    // rather than what was merely intended.
    //
    // But it is reporting through the intent channel, which is why it looks like
    // a writer. Under the model these are two different facts:
    //
    //   targetVocab      what the Teacher DECIDED to teach  (intent)
    //   realized forms   what this text ACTUALLY teaches    (realization)
    //
    // Conflating them means the Teacher's decision is unrecoverable after
    // rendering, and it is why the narrowing has to be conditional on
    // `markedForms.length > 0` -- overwriting with an empty list would erase the
    // intent entirely on the common A1 turn where nothing was placed.
    //
    // REVISIT with 090.11: realization output gets its own field, observe reads
    // THAT for card creation, and `targetVocab` stops being rewritten at render
    // time. Then the Teacher is the only writer, full stop.
    const wovenLemmaRefs: TeachableRef[] = markResult.markedForms.map((wf) => ({
      kind: "vocabulary" as const,
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
    weavedCount: markResult.markedForms.length,
    posture
  });
}

/**
 * 090.11: one place that reads a baked variant, shared by the beginner path and
 * the target-dominant path.
 *
 * Returns null for every reason a variant might be absent -- no cache wired, a
 * scene never built, a bake that failed its gates -- because the caller's answer
 * is the same for all of them: fall back rather than fail the turn.
 */
async function readBakedVariant(
  services: { variantCache?: { get: (key: VariantCacheKey) => Promise<{ variant: { text: string } } | null> } },
  nodeId: string,
  authoredText: string,
  targetLanguage: string,
  band: CEFRBand
): Promise<{ text: string } | null> {
  if (!services.variantCache) return null;
  try {
    const cached = await services.variantCache.get({
      lang: targetLanguage,
      band,
      contentHash: buildVariantContentHash(nodeId, authoredText),
      variantPromptVersion: VARIANT_PROMPT_VERSION
    });
    return cached ? { text: cached.variant.text } : null;
  } catch {
    // A cache read failure is not a turn failure.
    return null;
  }
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

      // 090.11: ANCHORED/SUPPORTED READ THE BAKED VARIANT FIRST.
      //
      // These two postures were the last ones realized at RUNTIME -- the weave
      // substituting lemmas into authored English as the line displayed -- while
      // every other band read a variant baked at build. Both are the same
      // operation; only the moment differed, and the split was an accident of
      // which technique arrived first.
      //
      // The weave stays as the FALLBACK, not the path. A cold cache, a scene
      // never built, or a bake that failed its gates all land here, and a woven
      // line is far better than an untouched English one. It is deleted for good
      // once the build-time Teacher call makes a missing A1 variant a build
      // error rather than a normal state.
      //
      // Why it could not switch on sooner: A1/A2 were not in the baked set at
      // all, because `GradedTextService` defaults posture to `target-dominant`
      // and so verified a beginner bake against a B1+ ratio. `generateVariant`
      // passes posture and ratio now, which is what makes these bands bakeable.
      if (
        constraint.supportPosture === "anchored" ||
        constraint.supportPosture === "supported"
      ) {
        const services = await deps.services.resolveForExecution(execution);
        if (!services) return normalizedTurn;

        const beginnerNodeId = String(normalizedTurn.metadata?.nodeId ?? "");
        const beginnerVariant = beginnerNodeId
          ? await readBakedVariant(
              services,
              beginnerNodeId,
              authoredText,
              targetLanguage,
              constraint.learnerCefr as CEFRBand
            )
          : null;

        if (beginnerVariant) {
          normalizedTurn.text = beginnerVariant.text;
          logger.debug("Scripted beginner line read from baked variant.", {
            posture: constraint.supportPosture,
            band: constraint.learnerCefr,
            nodeId: beginnerNodeId
          });
          return normalizedTurn;
        }

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

        // 090.4 DELETED AN UNOWNED WRITER OF constraint.targetVocab HERE.
        //
        // It appended the line's intent `mustConveyFacts` to
        // `targetVocab.introduce` -- uncapped, with no slate, no learning
        // status and no band envelope. It was the LAST writer before observe,
        // and `buildTargetLemmaSet` (observe-middleware.ts:87-93) gates card
        // creation on introduce union reinforce -- so this block decided which
        // lemmas entered the learner's permanent record, without the Teacher
        // ever seeing them.
        //
        // It was also ALREADY INERT and nobody noticed. 090.1 changed
        // `mustConveyFacts` to hold PROPOSITIONS ("the luggage is missing"),
        // with the extraction prompt explicitly forbidding vocabulary -- while
        // this code kept feeding each fact to `atlas.getLemma()` as a lemma id.
        // A proposition is never a lemma id, so the filter dropped everything.
        // The intent cache keys on LINE_INTENT_PROMPT_VERSION ("090.1.0"), so
        // pre-090.1 artifacts are unreachable and it cannot come back to life.

        return normalizedTurn;
      }

      // target-dominant posture: read baked variant from variant cache (086.4).
      // Degrades gracefully to markGradedText when the cache is cold or unavailable.
      const services = await deps.services.resolveForExecution(execution);
      if (!services) return normalizedTurn;

      const nodeId = String(normalizedTurn.metadata?.nodeId ?? "");
      const contentHash = buildVariantContentHash(nodeId, authoredText);
      const band = constraint.learnerCefr as CEFRBand;

      let usedVariant = false;

      // 090.8c DELETED THE 087.5 LIVE-RENDER PATH.
      //
      // It fired a gateway call WHILE DISPLAYING an authored dialogue line: when
      // a scheduled due teachable matched the line's intent facts, it asked the
      // LLM to render the line in the target language, verified the result, and
      // used it. The model budgets ZERO LLM per rendered line, so this was the
      // one thing making that invariant false.
      //
      // The work moves to build (090.11). An LLM call per line is exactly right
      // once, at bake time; it is exactly wrong on the turn the player is
      // waiting for.
      //
      // Stated plainly because the deletion is not free: this path was
      // production-reachable and NEVER TESTED -- 087's own outstanding list
      // records that no test ever fired the trigger. Nothing will fail loudly if
      // removing it was wrong. The zero-gateway-call pin below is the guard.
      const dialogueDefinitionId = execution.selection.dialogueDefinitionId ?? "";
      const nodeIntent = dialogueDefinitionId && nodeId
        ? services.dialogueDefinitions
            .find((d) => d.definitionId === dialogueDefinitionId)
            ?.nodes.find((n) => n.nodeId === nodeId)?.intent
        : undefined;
      const intentContentHash = buildIntentContentHash(nodeId, authoredText, nodeIntent);

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

            // 090.4 DELETED THE SECOND UNOWNED WRITER HERE.
            //
            // It REPLACED `targetVocab.introduce` wholesale from the line's
            // intent facts on the baked-variant path -- same broken premise as
            // its twin above: `mustConveyFacts` holds propositions since 090.1,
            // not lemma ids, so it produced nothing. Deleted rather than fixed,
            // because what a line teaches is the Teacher's decision and this
            // was a third party overwriting it.

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
        // Run markGradedText to at least produce introduce highlights.
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
