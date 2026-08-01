/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/generate-variant.ts
 *
 * Purpose: Dialogue-flavoured wrapper over `GradedTextService`. Supplies the
 * dialogue register and must-convey facts, then stamps dialogue identity onto
 * the adapter's output to produce a `BakedLineVariant`.
 *
 * Exports:
 *   - VARIANT_PROMPT_VERSION
 *   - VOICE_RETENTION_PASS_THRESHOLD
 *   - GenerateVariantInput
 *   - GenerateVariantResult
 *   - generateVariant
 *
 * Relationships:
 *   - Delegates ALL grading and verification to ../grading/graded-text-service.
 *   - Is consumed by compile-scheduler variantPipeline and by the Studio
 *     per-node variant popover (ui/shell/editor-support).
 *
 * Implements: Epic 086 Story 086.3
 *
 * Status: active
 *
 * WHY THIS IS NOW A WRAPPER (2026-07-28)
 *
 * This file used to hold the grading logic itself, with `dialogueDefinitionId`
 * and `nodeId` in its signature -- fields no line of that logic read; they were
 * stamped onto the result and nothing more. The genuinely caller-specific
 * knobs (posture, ratio, token budget, and the prompt's register) were
 * hardcoded constants in the body. That made the whole thing unusable for any
 * other kind of authored text.
 *
 * The grading now lives in `GradedTextService`, which knows nothing about
 * dialogue. What is left here is what is actually dialogue-specific: unpacking
 * `LineIntentArtifact` into adapter inputs, and attaching the ids that let a
 * baked line be found again. That is the correct amount of dialogue in a
 * dialogue module.
 */

import type { CEFRBand } from "../cefr";
import type { SupportPosture } from "../contracts/pedagogy";
import type { LineIntentArtifact } from "../contracts/line-intent";
import type { BakedLineVariant } from "../contracts/baked-variant";
import type { SugarlangLLMClient } from "../llm/types";
import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/competency-inventory";
import type { GradedTextSlate } from "../grading/graded-text-service";
import {
  buildHighlightTerms,
  focusTermsOf
} from "../grading/highlight-terms";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import {
  GRADED_TEXT_PROMPT_VERSION,
  GradedTextService,
  VOICE_RETENTION_PASS_THRESHOLD
} from "../grading/graded-text-service";
import {
  TARGET_LANGUAGE_RATIO_BY_POSTURE,
  postureForBand
} from "../teacher/band-envelope";

/**
 * Re-exported so the variant cache key and the runtime lookup keep reading one
 * version string. Bumping the adapter's prompt invalidates baked variants by
 * design -- the key is what makes that automatic rather than manual.
 */
export const VARIANT_PROMPT_VERSION = GRADED_TEXT_PROMPT_VERSION;
export { VOICE_RETENTION_PASS_THRESHOLD };

export interface GenerateVariantInput {
  authoredText: string;
  targetLang: string;
  band: CEFRBand;
  intent: LineIntentArtifact | null;
  contentHash: string;
  dialogueDefinitionId: string;
  nodeId: string;
  /** Support language for the baked glosses. Defaults to "en". */
  supportLang?: string;
  /**
   * 090.11: posture for this line. Absent falls back to the band's posture --
   * the same derivation the runtime scripted path uses today. Present is how a
   * Teacher-chosen posture arrives once the build-time Teacher call lands.
   */
  posture?: SupportPosture;
  /**
   * 090.11: what the Teacher wants this line to teach.
   *
   * This is the field that makes a build-time Teacher call worth making at all.
   * Without it the only directive value the bake could consume was `posture`,
   * which `postureForBand` already derives for free -- so calling the Teacher
   * bought a gateway round-trip and changed nothing.
   *
   * Absent means "no vocabulary steer, grade for level only", which is what
   * every caller did before this existed and remains valid for any caller
   * without a scene.
   */
  teach?: GradedTextSlate;
}

export interface GenerateVariantResult {
  variant: BakedLineVariant | null;
  failure?: { message: string };
}

export async function generateVariant(
  input: GenerateVariantInput,
  deps: {
    llmClient: SugarlangLLMClient;
    atlas: LexicalAtlasProvider;
    inventoryChunks: InventoryChunk[];
  }
): Promise<GenerateVariantResult> {
  const adapter = new GradedTextService({
    llmClient: deps.llmClient,
    atlas: deps.atlas,
    inventoryChunks: deps.inventoryChunks
  });

  // 090.11: POSTURE AND RATIO ARE PASSED, NOT DEFAULTED.
  //
  // `GradedTextService` falls back to `target-dominant` / its default ratio when
  // the caller says nothing, which is ~85% target language. That was harmless
  // while only B1+ was baked and actively wrong the moment A1 joined: an A1
  // variant would be generated and then VERIFIED against a B1+ ratio, so either
  // the line comes out far too Spanish or the ratio gate rejects everything.
  // That defaulting is why A1/A2 were never in the baked set.
  //
  // `postureForBand` is the interim source. The story's end state is the Teacher
  // choosing posture per line at bake time; this is the same value the runtime
  // scripted path already derives, moved earlier, so turning A1/A2 on does not
  // wait for the Teacher call.
  const posture = input.posture ?? postureForBand(input.band);
  const result = await adapter.adapt({
    sourceText: input.authoredText,
    targetLang: input.targetLang,
    band: input.band,
    posture,
    directedRatio: TARGET_LANGUAGE_RATIO_BY_POSTURE[posture],
    ...(input.teach ? { teach: input.teach } : {}),
    mustConveyFacts: input.intent?.mustConveyFacts ?? [],
    guidance: {
      register: "dialogue line",
      notes: [
        input.intent?.beat ? `Dramatic beat: ${input.intent.beat}` : null,
        input.intent?.voiceNote ? `Voice note: ${input.intent.voiceNote}` : null
      ].filter((note): note is string => note !== null)
    }
  });

  if (result.text === null || result.verdict === null) {
    return {
      variant: null,
      failure: { message: result.failure?.message ?? "Variant generation failed" }
    };
  }

  // BAKE THE MARKS (rf6.5.2). The slate that steered this generation is right
  // here; at runtime it is not -- scripted mode never calls the Teacher and
  // carries an empty targetVocab. So the terms are computed once, now, against
  // the text that was just produced, and ride on the variant.
  //
  // Same builder the observe middleware uses for agent turns, so a word cannot
  // highlight differently depending on whether its line was baked.
  const highlight = input.teach
    ? buildHighlightTerms({
        text: result.text,
        introduce: input.teach.introduce,
        reinforce: input.teach.reinforce,
        atlas: deps.atlas,
        targetLanguage: input.targetLang,
        supportLanguage: input.supportLang ?? "en",
        chunkMatcher:
          deps.inventoryChunks.length > 0
            ? createChunkMatcher(deps.inventoryChunks, input.targetLang)
            : null
      })
    : null;

  return {
    variant: {
      source: {
        kind: "dialogue-node",
        dialogueDefinitionId: input.dialogueDefinitionId,
        nodeId: input.nodeId
      },
      lang: input.targetLang,
      band: input.band,
      text: result.text,
      ...(highlight
        ? {
            highlight: {
              focusTerms: focusTermsOf(highlight),
              introduceTerms: highlight.introduceTerms,
              glosses: highlight.glosses
            }
          }
        : {}),
      verdict: result.verdict,
      reviewFlag: !result.verdict.overallPasses,
      generatedAtMs: Date.now(),
      generatedByModel: result.generatedByModel,
      contentHash: input.contentHash,
      promptVersion: result.promptVersion
    }
  };
}
