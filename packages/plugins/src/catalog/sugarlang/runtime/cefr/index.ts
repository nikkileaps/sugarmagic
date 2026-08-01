/**
 * packages/plugins/src/catalog/sugarlang/runtime/cefr/index.ts
 *
 * Purpose: The CEFR band scale -- which bands exist, and what "higher" means.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT PART OF THE LEARNER
 *   A band is not a learner fact. A WORD has a band (the atlas), a stretch of
 *   TEXT has a band (the classifier), a PLACEMENT question has a band, and a
 *   learner has one too. Filing the scale under any one of those owners forces
 *   the other four to reach into a module they have no business depending on --
 *   which is exactly what happened: this array existed SEVEN times, under seven
 *   names, in classifier / learner / scheduler / grading / placement and twice
 *   in the Studio shell. There was no home every caller could legally reach, so
 *   each one made its own copy.
 *
 *   It previously lived in `contracts/learner-profile.ts`, which made the Studio
 *   density histogram import a learner contract to draw a bar chart.
 *
 * Exports:
 *   - CEFRBand, CEFR_BAND_ORDER
 *   - compareCefrBands, isBandAbove, bandIndex
 *
 * Relationships:
 *   - Depends on nothing. Everything that speaks about level depends on it.
 *
 * Implements: Proposal 001 §Learner State Model + Plan 090 story 090.9
 *
 * Status: active
 */

/**
 * Canonical CEFR bands used across learner state, scene lexicons, and directives.
 */
export type CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/**
 * THE band order. Ascending, A1 lowest.
 *
 * Only for ORDER-DEPENDENT use -- `indexOf`, `slice`, comparison. Membership
 * checks and schema enums are a different question and may keep their own
 * literals (`config.ts` `VALID_DEBUG_BANDS` is a Set; the MWE extractor's is an
 * Ajv enum). A deliberate SUBSET is also not a copy: the placement question-bank
 * viewer shows A1..B2 only, on purpose.
 */
export const CEFR_BAND_ORDER: readonly CEFRBand[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2"
];

/** Negative when `left` is the lower band. */
export function compareCefrBands(left: CEFRBand, right: CEFRBand): number {
  return CEFR_BAND_ORDER.indexOf(left) - CEFR_BAND_ORDER.indexOf(right);
}

/**
 * True when `band` sits more than `delta` steps above `reference`.
 *
 * `delta` is load-bearing and the call sites do NOT agree on it, deliberately:
 * `delta 0` is a strict stretch gate on competencies, `delta 1` is the in-reach
 * boundary on lemmas. Three predicates use this primitive with different deltas
 * on different entities; folding them together would be a behavior change
 * wearing a cleanup's clothes.
 */
export function isBandAbove(
  band: CEFRBand,
  reference: CEFRBand,
  delta = 0
): boolean {
  return compareCefrBands(band, reference) > delta;
}

/** Index of a band in the canonical order; -1 when unknown. */
export function bandIndex(band: CEFRBand): number {
  return CEFR_BAND_ORDER.indexOf(band);
}
