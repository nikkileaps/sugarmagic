/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/scene-teachable.ts
 *
 * Purpose: What the curriculum can actually supply for one scene's concepts.
 *
 * CONCEPT IS DEMAND; TEACHABLE IS SUPPLY
 *   A `Concept` says "this scene is about cheese" and says nothing about what to
 *   teach. Two tables answer that -- the atlas (a vocabulary teachable) and the
 *   competency inventory (a competency teachable) -- but only the atlas is
 *   resolved by lookup. The inventory is ten entries and matching a concept to a
 *   competency is a judgment, so it happens in the Teacher against the situation
 *   (090.3, 090.4), not here. `kind` exists because the slate the Teacher
 *   produces must carry BOTH -- a competency reaching teaching only by being
 *   flattened into a lemma list is the defect that makes deleting the prescriber
 *   delete competency teaching.
 *
 * NOTHING HERE IS PERSISTED
 *   Derived at read time from concepts + atlas, both already in hand, against a
 *   gloss index built once and cached in-provider. Deriving means an atlas edit
 *   applies with no recompile, and there is no cache key to keep honest.
 *
 * ROWS ARE KEYED BY TEACHABLE, NOT BY CONCEPT
 *   Two concepts resolving to one lemma merge into one row carrying both
 *   demanders. That is why `Concept` needs no identity, and it is also the
 *   ranking signal the Teacher gets in place of the budgeter's `w_npc` boost:
 *   a teachable demanded by three NPCs outranks one mentioned in a lore page.
 *
 * Exports:
 *   - TEACHABLE_KINDS, TeachableKind
 *   - SceneTeachable
 *   - CurriculumGap
 *   - SceneTeachableResolution
 *
 * Relationships:
 *   - Produced by ../inventory/scene-teachable-resolver from `Concept`s
 *     (./scene-context) against LexicalAtlasProvider (./providers) and
 *     CompetencyInventory (./competency-inventory).
 *
 * Implements: Plan 090 story 090.2
 *
 * Status: active
 */

import type { ConceptProvenance } from "./scene-context";

export const TEACHABLE_KINDS = ["vocabulary", "competency"] as const;

export type TeachableKind = (typeof TEACHABLE_KINDS)[number];

/**
 * One thing the curriculum can teach, that this scene creates demand for.
 */
export interface SceneTeachable {
  kind: TeachableKind;
  /** Atlas lemma id, or competency id. Unique together with `kind`. */
  id: string;
  /**
   * Every concept label that demanded this teachable, sorted.
   *
   * The demand side must survive into the row: without it the Teacher cannot
   * tell quest-critical from incidental, nor "three NPCs are about this" from
   * "one lore page mentions it".
   */
  concepts: string[];
  /** Union of the demanding concepts' provenance, deduped and sorted. */
  provenance: ConceptProvenance[];
  /** True when ANY demanding concept is quest-essential. */
  mustComprehend: boolean;
}

export interface SceneTeachableResolution {
  teachables: SceneTeachable[];
  diagnostics: {
    conceptCount: number;
    /** Concepts that produced a vocabulary teachable. */
    atlasHits: number;
    /**
     * Concepts whose gloss matched atlas entries but whose POS filter emptied
     * the pool -- e.g. `dock` glosses only `atracar`, a verb. Distinct from a
     * plain miss, because it means the atlas HAS the word in another sense.
     */
    droppedForPos: number;
    /**
     * Multi-word labels, which never reach the atlas at all. Not a warning:
     * the miss is the mechanism that routes a phrase to the competency table.
     */
    skippedMultiWord: number;
  };
}
