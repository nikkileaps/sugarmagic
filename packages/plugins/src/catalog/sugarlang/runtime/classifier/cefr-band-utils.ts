/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/cefr-band-utils.ts
 *
 * Purpose: Provides the classifier's single CEFR band ordering helper.
 *
 * Exports:
 *   - CEFR_BAND_ORDER
 *   - compareCefrBands
 *   - isBandAbove
 *
 * Relationships:
 *   - Is consumed by coverage, envelope-rule, envelope-classifier, and auto-simplify.
 *   - Keeps CEFR ordering logic out of individual classifier stages.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import type { CEFRBand } from "../types";

export const CEFR_BAND_ORDER: readonly CEFRBand[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2"
];

export function compareCefrBands(left: CEFRBand, right: CEFRBand): number {
  return CEFR_BAND_ORDER.indexOf(left) - CEFR_BAND_ORDER.indexOf(right);
}

export function isBandAbove(
  band: CEFRBand,
  reference: CEFRBand,
  delta = 0
): boolean {
  return compareCefrBands(band, reference) > delta;
}
