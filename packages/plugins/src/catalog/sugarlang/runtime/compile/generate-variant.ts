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

import type { CEFRBand } from "../contracts/learner-profile";
import type { LineIntentArtifact } from "../contracts/line-intent";
import type { BakedLineVariant } from "../contracts/baked-variant";
import type { SugarlangLLMClient } from "../llm/types";
import type { LexicalAtlasProvider } from "../types";
import type { InventoryChunk } from "../contracts/function-inventory";
import {
  GRADED_TEXT_PROMPT_VERSION,
  GradedTextService,
  VOICE_RETENTION_PASS_THRESHOLD
} from "../grading/graded-text-service";

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

  const result = await adapter.adapt({
    sourceText: input.authoredText,
    targetLang: input.targetLang,
    band: input.band,
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
      verdict: result.verdict,
      reviewFlag: !result.verdict.overallPasses,
      generatedAtMs: Date.now(),
      generatedByModel: result.generatedByModel,
      contentHash: input.contentHash,
      promptVersion: result.promptVersion
    }
  };
}
