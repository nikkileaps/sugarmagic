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
 * ZERO LLM CALLS, EVERY BAND. This serves a variant baked in Studio, or it
 * serves the authored English. It does not adapt text itself.
 *
 *   1. Read the authored English turn text and the sugarlang constraint
 *   2. Look up the variant baked for this line at the learner's band
 *   3. HIT  -> replace turn.text, and attach the MARKS baked alongside it so the
 *              line highlights its teachables exactly as an agent line does
 *      MISS -> leave the authored English alone
 *
 * CITATION-FORM SUBSTITUTION IS GONE FROM THIS PATH (rf6.5.2, nikki 2026-07-31).
 * Anchored/supported postures
 * used to substitute target words into the authored line on a cache miss. It is
 * deleted: a line with no baked variant is untaught but correct and readable,
 * which beats a line half-rewritten by a mechanism that made no pedagogical
 * decision. Its removal also fixed an inversion where the FALLBACK highlighted
 * and the correctly BAKED line did not.
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
import type { SugarlangConstraint } from "../types";
import type { SugarlangRuntimeServices } from "../runtime-services";
import { buildDialogueNodeContentHash } from "../grading/sources/dialogue-node-source";
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
import type { CEFRBand } from "../cefr";
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
 * arrives at dawn") into the substitution/highlight/observe machinery, which contracts
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
 * through to substitution. Read the full rule at the definition.
 */
const buildVariantContentHash = buildDialogueNodeContentHash;

/**
 * Attaches the marks BAKED ONTO THE VARIANT to the turn, so a scripted line gets
 * the same highlighting an agent line gets.
 *
 * WHY THE MARKS COME FROM THE VARIANT AND NOT FROM A SLATE.
 *   Scripted mode never calls the Teacher -- the teacher middleware early-returns
 *   with an empty `targetVocab` -- so at runtime there IS no slate to derive
 *   terms from. The slate existed at BAKE time, which is where the terms were
 *   computed, against the very text being served here.
 *
 *   Until rf6.5.2 this was missing and the two paths were BACKWARDS: a substituted
 *   FALLBACK line highlighted (because substitution repopulated `targetVocab` as a
 *   side effect) while a correctly BAKED line highlighted nothing at all. No
 *   test caught it, because the scripted tests pin the TEXT and not the
 *   annotation.
 *
 * `celebrateTerms` is empty here on purpose: the dialogue entry decorator fills
 * it on PLAYER turns from what the player actually typed.
 */
function attachBakedHighlight(
  variant: {
    highlight?: {
      focusTerms: string[];
      introduceTerms: string[];
      glosses: Record<string, string>;
    };
  },
  normalizedTurn: ConversationTurnEnvelope
): void {
  const highlight = variant.highlight;
  if (!highlight || highlight.focusTerms.length === 0) return;
  normalizedTurn.annotations = {
    ...(normalizedTurn.annotations ?? {}),
    dialogueHighlight: {
      focusTerms: highlight.focusTerms,
      introduceTerms: highlight.introduceTerms,
      celebrateTerms: [],
      glosses: highlight.glosses
    }
  };
}

/**
 * 090.11: one place that reads a baked variant, shared by the beginner path and
 * the target-dominant path.
 *
 * Returns null for every reason a variant might be absent -- no cache wired, a
 * scene never built, a bake that failed its gates -- because the caller's answer
 * is the same for all of them: fall back rather than fail the turn.
 */
/**
 * `ServedVariant` carries the BAKED MARKS alongside the text. It was `{text}`
 * only, which is how a baked line reached the player with no highlighting: the
 * narrowing silently discarded the field the presentation layer needs.
 */
type ServedVariant = {
  text: string;
  highlight?: {
    focusTerms: string[];
    introduceTerms: string[];
    glosses: Record<string, string>;
  };
};

async function readBakedVariant(
  services: { variantCache?: { get: (key: VariantCacheKey) => Promise<{ variant: ServedVariant } | null> } },
  nodeId: string,
  authoredText: string,
  targetLanguage: string,
  band: CEFRBand
): Promise<ServedVariant | null> {
  if (!services.variantCache) return null;
  try {
    const cached = await services.variantCache.get({
      lang: targetLanguage,
      band,
      contentHash: buildVariantContentHash(nodeId, authoredText),
      variantPromptVersion: VARIANT_PROMPT_VERSION
    });
    // The WHOLE variant, not `{text}`. Rebuilding a narrowed object here is
    // what dropped the baked marks on the floor -- the type said `{text}` and
    // the code obligingly made one, so the highlight never reached the turn.
    return cached ? cached.variant : null;
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

      // 090.11: ANCHORED/SUPPORTED READ THE BAKED VARIANT FIRST.
      //
      // These two postures were the last ones realized at RUNTIME -- substitution
      // substituting lemmas into authored English as the line displayed -- while
      // every other band read a variant baked at build. Both are the same
      // operation; only the moment differed, and the split was an accident of
      // which technique arrived first.
      //
      // Substitution stays as the FALLBACK, not the path. A cold cache, a scene
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
          attachBakedHighlight(beginnerVariant, normalizedTurn);
          logger.debug("Scripted beginner line read from baked variant.", {
            posture: constraint.supportPosture,
            band: constraint.learnerCefr,
            nodeId: beginnerNodeId
          });
          return normalizedTurn;
        }

        // NO VARIANT -> THE AUTHORED ENGLISH, UNCHANGED (nikki, 2026-07-31).
        // Citation-form substitution used to run here, putting target words into the
        // authored line. It is deleted: a line with no baked variant is untaught
        // but correct and readable, which is a better failure than a line
        // half-rewritten by a mechanism that made no pedagogical decision.
        logger.debug("Scripted beginner line has no baked variant -- serving authored text.", {
          band: constraint.learnerCefr,
          nodeId: beginnerNodeId
        });

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
      // Serves the authored English when the cache is cold or unavailable.
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
      // rf6.5.1: the per-turn dialogue-definition lookup and its intent hash are
      // GONE. Both were computed on every scripted turn and read by nothing --
      // they fed the live-render path deleted in 090.8c.

      // rf6.5.1: the gate here was `!usedVariant && services.variantCache`. The
      // negation was unconditionally true -- nothing assigned `usedVariant`
      // between its declaration and this point -- and its comment justified the
      // gate by saying it stopped a baked variant from overwriting a successful
      // LIVE RENDER, a path deleted in 090.8c. A condition that cannot be false,
      // explained by machinery that no longer exists.
      //
      // `usedVariant` itself STAYS: the `if (!usedVariant)` below is what tells a
      // cache hit from a miss, and the miss branch is what serves authored English.
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
            attachBakedHighlight(cached.variant, normalizedTurn);
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
          // Variant cache failure is non-fatal -- degrade to substitution below
        }
      }

      if (!usedVariant) {
        // NO VARIANT -> THE AUTHORED ENGLISH, UNCHANGED. See the note on the
        // beginner path above; substitution is deleted on both.
        logger.debug("Scripted line (target-dominant): no baked variant -- serving authored text.", {
          authoredText,
          band,
          lang: targetLanguage,
          hasVariantCache: Boolean(services.variantCache),
          nodeId: nodeId || "(none)"
        });
      }

      return normalizedTurn;
    }
  };
}
