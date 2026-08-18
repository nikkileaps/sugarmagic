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
 *   - buildItemViewAdaptRequest
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
import type { CEFRBand } from "../../cefr";
import type { GradedTextRequest } from "../graded-text-service";
import { TARGET_LANGUAGE_RATIO_BY_POSTURE } from "../../teacher/band-envelope";
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
          const authored = item.interactionView[field];
          const text = authored.trim();
          if (!text) continue;

          units.push({
            source: {
              kind: ITEM_VIEW_SOURCE_KIND,
              itemDefinitionId: item.definitionId,
              field
            },
            sourceText: text,
            // Hash the RAW authored value, not the trimmed one. Every other
            // site seeds from the raw field: the runtime resolver passes
            // `definition.interactionView[field]` verbatim, and so does the
            // Studio bake. Trimming here would make a body with a trailing
            // newline bake under one hash and be looked up under another --
            // a permanent silent miss that reads as "grading stopped working
            // for that item". Same rule as buildDialogueNodeContentHash.
            contentHash: buildItemViewContentHash(item.definitionId, field, authored),
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

/**
 * The adapt request for an item view bake (story #200).
 *
 * ITEM TEXT IS A FULL TRANSLATION AT EVERY BAND, not an interwoven graded
 * line. The item is a touchstone: a familiar, stable text the player re-reads
 * over time to feel their own progress, so it renders entirely in the target
 * language. The band still does the leveling -- an A1 translation is
 * radically simplified, and that loss is accepted. The guidance pitches the
 * writing at a reader who has fully mastered the band and is about to move
 * up. Dialogue keeps postureForBand; only items pin target-only.
 *
 * One function builds the request and the bake consumes it, so the test that
 * pins this policy and the code that runs it cannot drift apart.
 */
export function buildItemViewAdaptRequest(input: {
  text: string;
  targetLang: string;
  band: CEFRBand;
  field: "title" | "body";
}): GradedTextRequest {
  return {
    sourceText: input.text,
    targetLang: input.targetLang,
    band: input.band,
    posture: "target-only",
    directedRatio: TARGET_LANGUAGE_RATIO_BY_POSTURE["target-only"],
    guidance: {
      register: registerFor(input.field),
      notes: [
        `The reader has fully mastered ${input.band} and is about to move up a level. Write entirely in the target language, comfortably within ${input.band} - do not stretch beyond it to teach.`
      ]
    }
  };
}
