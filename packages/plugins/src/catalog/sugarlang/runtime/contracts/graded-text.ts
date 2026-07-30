/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/graded-text.ts
 *
 * Purpose: The stored artifact of grading, and the discriminated union that
 * says what authored text it came from.
 *
 * Exports:
 *   - GradedTextSourceKind / GradedTextSource
 *   - gradedTextSourceKey / describeGradedTextSource
 *   - GradedTextRecord
 *   - VariantVerdict (re-exported for the record's shape)
 *
 * Relationships:
 *   - Leaf contract. Imported by the grading module, the variant cache, the
 *     runtime lookup and Studio surfaces; imports nothing from any of them.
 *
 * Implements: Epic 086 Story 086.3 (generalised 2026-07-28)
 *
 * Status: active
 *
 * WHY A UNION AND NOT A BASE INTERFACE
 *
 * The cache is a heterogeneous store. Reading a record back, you must narrow it
 * to know what it describes -- and inheritance cannot narrow, so a
 * `BakedItemVariant extends BakedGradedText` scheme would need a tag field
 * anyway, leaving you with a discriminated union plus a subtyping relationship
 * nothing uses. These records carry no behaviour, so there is nothing to
 * inherit.
 *
 * The union also makes adding a content kind a COMPILE ERROR everywhere that
 * switches on it, rather than a silent fallthrough. That is the property worth
 * paying for.
 */

import type { CEFRBand } from "../cefr";

/**
 * What kind of authored text a graded record came from.
 *
 * Adding a member here is deliberately breaking: every exhaustive switch stops
 * compiling until it handles the new kind.
 */
export type GradedTextSourceKind = "dialogue-node" | "item-view" | "spell-view";

/**
 * Where a graded record came from -- the ONLY part of a record that varies by
 * content kind. Text, band, verdict and hashes are identical whatever produced
 * them.
 */
export type GradedTextSource =
  | {
      kind: "dialogue-node";
      dialogueDefinitionId: string;
      nodeId: string;
    }
  | {
      kind: "item-view";
      itemDefinitionId: string;
      /** Which text field of the interaction view this is. */
      field: "title" | "body";
    }
  | {
      kind: "spell-view";
      spellDefinitionId: string;
      field: "description";
    };

/**
 * MIGRATION HAZARD -- do not grep-and-replace `nodeId` / `dialogueDefinitionId`
 * across sugarlang.
 *
 * That exact field PAIR appears in three unrelated types:
 *   - GradedTextSource (here)      -- moved under `source` in 2026-07
 *   - LineIntentArtifact           -- still top-level, correctly
 *   - LiveRenderCacheKey           -- still top-level, correctly
 *
 * A blind sweep rewrites all three and only the first is right. It typechecks
 * loudly for the key, which is lucky; do it by hand and let the compiler drive.
 */

/** Stable string form, for logging, dedupe, and cache-report rows. */
export function gradedTextSourceKey(source: GradedTextSource): string {
  switch (source.kind) {
    case "dialogue-node":
      return `dialogue-node:${source.dialogueDefinitionId}:${source.nodeId}`;
    case "item-view":
      return `item-view:${source.itemDefinitionId}:${source.field}`;
    case "spell-view":
      return `spell-view:${source.spellDefinitionId}:${source.field}`;
  }
}

/** Human-readable label for Studio surfaces. */
export function describeGradedTextSource(source: GradedTextSource): string {
  switch (source.kind) {
    case "dialogue-node":
      return `Dialogue node ${source.nodeId}`;
    case "item-view":
      return `Item ${source.itemDefinitionId} (${source.field})`;
    case "spell-view":
      return `Spell ${source.spellDefinitionId} (${source.field})`;
  }
}

export interface VariantVerdict {
  envelopePasses: boolean;
  ratioPasses: boolean;
  voiceRetentionScore: number;
  fidelityPasses: boolean;
  overallPasses: boolean;
}

/**
 * One graded rendering of one piece of authored text, at one band, in one
 * language. The unit of storage.
 */
export interface GradedTextRecord {
  source: GradedTextSource;
  lang: string;
  band: CEFRBand;
  text: string;
  verdict: VariantVerdict;
  reviewFlag: boolean;
  generatedAtMs: number;
  generatedByModel: string;
  /** Hash of the authored text (and whatever else the source seeds in). */
  contentHash: string;
  promptVersion: string;
}
