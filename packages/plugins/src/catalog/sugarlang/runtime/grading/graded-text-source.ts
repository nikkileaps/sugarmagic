/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/graded-text-source.ts
 *
 * Purpose: The source-side contracts for grading. Declares what a gradable unit
 * of authored text is, what identifies it, and the Strategy interface each
 * content kind implements to produce them.
 *
 * Exports:
 *   - GradedTextSourceKind / GradedTextSource
 *   - GradedTextUnit
 *   - GradedTextCorpus
 *   - GradedTextSourceStrategy
 *   - gradedTextSourceKey
 *
 * Relationships:
 *   - Consumed by the registry, by every strategy under ./sources, and by
 *     graded-text-service (which reads only `sourceText` / `guidance` /
 *     `mustConveyFacts` and is otherwise blind to all of this).
 *
 * Implements: Epic 086 Story 086.3 (generalised 2026-07-28)
 *
 * Status: active
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN, AND WHY
 *
 * Grading is one algorithm applied to many kinds of authored text. The
 * algorithm never varies. What varies sits entirely at the EDGES:
 *
 *   inbound   where the text lives, what identifies it, how its content hash
 *             is seeded, what register it should be written in
 *   outbound  what the stored record points back at
 *
 * So: push the variance to the edges, keep the middle blind.
 *
 *   - OUTBOUND is a DISCRIMINATED UNION (`GradedTextSource`). The cache is a
 *     heterogeneous store; reading a record back you must narrow it to know
 *     what it describes. Inheritance cannot narrow -- you would end up adding a
 *     tag anyway, and inherit nothing, because these records carry no
 *     behaviour. The union also makes adding a kind a COMPILE ERROR at every
 *     consumer that switches on it, which is the property worth having.
 *
 *   - INBOUND is the STRATEGY pattern (`GradedTextSourceStrategy`). "Given
 *     content, produce gradable units" is a family of interchangeable
 *     algorithms selected by content kind. Not Template Method: that would
 *     weld the varying parts into the invariant algorithm's lifecycle by
 *     inheritance, when the algorithm is already a free-standing service. Not
 *     Visitor: Visitor pays off for many operations over a FIXED hierarchy;
 *     this is one operation over a GROWING set.
 *
 * `GradedTextUnit` is the seam between the two. Strategies emit it, the
 * service consumes it, and the service never learns what a dialogue node is.
 *
 * PLUGIN BOUNDARY -- LOAD-BEARING
 *
 * Every strategy reads DOMAIN types and returns plain data. Nothing here is
 * imported by `@sugarmagic/domain` or `@sugarmagic/runtime-core`, and nothing
 * here may ever be. The dependency runs one way: sugarlang -> domain.
 *
 * The consequence that matters: with sugarlang disabled or uninstalled, no
 * strategy runs, no record is written, and every consumer falls back to the
 * authored English it already had. Graded text is an OVERLAY on authored
 * content, never a replacement for it -- which is why `GradedTextUnit` carries
 * `sourceText` rather than the content mutating itself, and why the record is
 * addressed by content hash rather than the content storing a pointer to it.
 * Turn the plugin off and you have a plain English game, by construction
 * rather than by a fallback path someone has to remember to write.
 */

import type {
  DialogueDefinition,
  ItemDefinition,
  SpellDefinition
} from "@sugarmagic/domain";
import type {
  GradedTextSource,
  GradedTextSourceKind
} from "../contracts/graded-text";
import type { GradedTextGuidance } from "./graded-text-service";

// The source union and its key/label helpers are CONTRACTS, not grading
// internals: the cache, the runtime lookup and Studio surfaces all read them
// without going through this module. Re-exported here so strategy authors have
// one import.
export type {
  GradedTextSource,
  GradedTextSourceKind
} from "../contracts/graded-text";
export { gradedTextSourceKey, describeGradedTextSource } from "../contracts/graded-text";

/**
 * One piece of authored text that can be graded, with everything the service
 * and the cache need and nothing else.
 */
export interface GradedTextUnit {
  source: GradedTextSource;
  /** Authored source-language text. English today. */
  sourceText: string;
  /**
   * Cache identity for this unit's CONTENT. Two units with the same hash grade
   * to the same result and share a cache entry; edit the authored text and the
   * hash changes, orphaning the old entry. Built by the strategy because only
   * the strategy knows what else belongs in the seed.
   */
  contentHash: string;
  guidance: GradedTextGuidance;
  /** Facts the adaptation must preserve. Empty skips the fidelity gate. */
  mustConveyFacts: string[];
}

/**
 * Everything a strategy might read, all optional.
 *
 * Deliberately a bag rather than a scene context: `SceneAuthoringContext` is
 * scene-scoped, but spells (and other library content) are not scoped to a
 * scene at all, so it cannot be the universal input. Each strategy reads only
 * its own slice and returns [] when that slice is absent -- so a caller that
 * holds only items passes only items, and no strategy breaks.
 */
export interface GradedTextCorpus {
  targetLanguage: string;
  dialogues?: DialogueDefinition[];
  items?: ItemDefinition[];
  spells?: SpellDefinition[];
}

/**
 * A content kind's knowledge of how to find and describe its gradable text.
 *
 * `collect` MUST be pure and cheap -- no model calls, no IO. It runs over the
 * whole corpus on every scheduler pass, and callers filter its output rather
 * than asking it for a subset.
 */
export interface GradedTextSourceStrategy {
  readonly kind: GradedTextSourceKind;
  /** Human-readable, for Studio surfaces listing what can be graded. */
  readonly displayName: string;
  collect(corpus: GradedTextCorpus): GradedTextUnit[];
}
