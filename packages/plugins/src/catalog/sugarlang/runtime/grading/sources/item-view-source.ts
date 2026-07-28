/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/sources/item-view-source.ts
 *
 * Purpose: Graded-text source strategy for item interaction-view text
 * (Examine and Consumable title/body).
 *
 * Exports:
 *   - ITEM_VIEW_SOURCE_KIND
 *   - GRADABLE_ITEM_VIEW_KINDS
 *   - buildItemViewContentHash
 *   - createItemViewSource
 *
 * Relationships:
 *   - Implements GradedTextSourceStrategy from ../graded-text-source.
 *   - Reads ItemDefinition from @sugarmagic/domain. One-way: domain never
 *     imports this, so an item still renders its authored English with
 *     sugarlang uninstalled.
 *
 * Implements: Epic 086 Story 086.3 (second source kind, 2026-07-28)
 *
 * Status: active
 */

import type { ItemViewKind } from "@sugarmagic/domain";
import type {
  GradedTextCorpus,
  GradedTextSourceStrategy,
  GradedTextUnit
} from "../graded-text-source";

export const ITEM_VIEW_SOURCE_KIND = "item-view" as const;

/**
 * View kinds whose title/body are prose worth grading.
 *
 * `readable` is excluded on purpose: it ignores its own title/body and defers
 * to a bound DocumentDefinition, so grading those fields would produce records
 * nothing ever reads. `none` and `trigger-castable` have no prose.
 */
export const GRADABLE_ITEM_VIEW_KINDS: ReadonlySet<ItemViewKind> = new Set<ItemViewKind>([
  "examine",
  "consumable"
]);

/**
 * Content-hash seed for an item view field.
 *
 * Same three-part shape as the dialogue seed (`id | text | intent-slot`) so
 * both read alike in a cache dump, but the id segment is namespaced by field:
 * title and body are independently editable, so they must hash and cache
 * independently or editing one would silently orphan the other.
 */
export function buildItemViewContentHash(
  itemDefinitionId: string,
  field: "title" | "body",
  text: string
): string {
  return [`item:${itemDefinitionId}:${field}`, text, JSON.stringify({})].join("|");
}

export function createItemViewSource(): GradedTextSourceStrategy {
  return {
    kind: ITEM_VIEW_SOURCE_KIND,
    displayName: "Item view text",
    collect(corpus: GradedTextCorpus): GradedTextUnit[] {
      const units: GradedTextUnit[] = [];
      for (const item of corpus.items ?? []) {
        if (!GRADABLE_ITEM_VIEW_KINDS.has(item.interactionView.kind)) continue;

        for (const field of ["title", "body"] as const) {
          const text = item.interactionView[field].trim();
          if (!text) continue;

          units.push({
            source: {
              kind: ITEM_VIEW_SOURCE_KIND,
              itemDefinitionId: item.definitionId,
              field
            },
            sourceText: text,
            contentHash: buildItemViewContentHash(item.definitionId, field, text),
            guidance: { register: registerFor(field) },
            // Nothing extracts must-convey facts for items yet. Empty skips the
            // fidelity gate, which is correct: there is nothing to check against.
            mustConveyFacts: []
          });
        }
      }
      return units;
    }
  };
}

/**
 * Titles and bodies want different writing, and the register is the only lever
 * the service has over output shape. A title graded with the body's register
 * comes back as a sentence.
 */
function registerFor(field: "title" | "body"): string {
  return field === "title" ? "item name" : "item description";
}
