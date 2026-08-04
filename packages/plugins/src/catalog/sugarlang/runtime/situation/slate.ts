/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/slate.ts
 *
 * Purpose: The SLATE -- what this learner should be working on in this
 *   situation. Stable until the situation key moves.
 *
 * NOT A PER-TURN ANSWER
 *   The Teacher used to produce a directive per turn. A slate is a working set:
 *   decided once for a situation, then applied per piece of text by realization
 *   (090.8). That is what makes the Teacher affordable enough to run on judgment
 *   rather than on a countdown.
 *
 * IT CARRIES TEACHABLES, NOT LEMMA REFS
 *   The Teacher can teach two kinds of thing -- a vocabulary item realized as a
 *   lemma, and a competency realized as exponents. A slate of `LemmaRef` can
 *   only express the first, so competencies would be filtered out and dropped
 *   on the way through.
 *
 * DELIBERATELY NOT TRUNCATED
 *   A slate is a working set, not a teaching quota. Cutting it to a top N is why
 *   a scene-wide top-3 almost never intersects one specific paragraph -- the
 *   mechanism behind both the item-description bug and the A1 dialogue bug. The
 *   cap belongs at realization, where the text is known.
 *
 * Exports:
 *   - SlateAction, SlateItem, Slate
 *
 * Relationships:
 *   - Produced by the Teacher (090.4). Stored by ./slate-store. Applied per text
 *     by realization (090.8).
 *
 * Implements: Plan 090 story 090.3 (the shape and the store; 090.4 fills it)
 *
 * Status: active
 */

import type { TeachableKind } from "../contracts/scene-teachable";

/**
 * What the Teacher decided to DO with a teachable in this situation.
 *
 * `skip` is recorded rather than omitted: "considered and rejected" and "never
 * considered" are different, and only the first tells an author their content is
 * being seen and passed over.
 */
export type SlateAction = "introduce" | "reinforce" | "probe" | "skip";

export interface SlateItem {
  kind: TeachableKind;
  /** Atlas lemma id, or competency id. Unique together with `kind`. */
  id: string;
  action: SlateAction;
}

export interface Slate {
  /** The situation this slate was decided for. */
  situationKey: string;
  /**
   * Every teachable considered, with what the Teacher chose to do about it.
   * NOT truncated -- see the header.
   */
  items: SlateItem[];
  issuedAtMs: number;
}
