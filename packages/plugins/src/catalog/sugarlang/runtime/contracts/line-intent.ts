/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/line-intent.ts
 *
 * Purpose: Declares the per-dialogue-node intent artifact produced at bake time.
 *
 * Exports:
 *   - LineIntentArtifact
 *   - LineIntentCacheKey
 *
 * Status: active
 */

export interface LineIntentArtifact {
  nodeId: string;
  dialogueDefinitionId: string;
  /** Authored English anchor -- the text the intent was derived from. */
  anchorText: string;
  mustConveyFacts: string[];
  beat: string | null;
  voiceNote: string | null;
  /** True when fields were LLM-derived (not hand-authored); surface in exception report. */
  derived: boolean;
  /** True when derivation returned low-confidence or partial results; surface in exception report. */
  reviewFlag: boolean;
  extractedAtMs: number;
  extractedByModel: string;
}

export interface LineIntentCacheKey {
  contentHash: string;
  intentPromptVersion: string;
}
