/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/coverage.ts
 *
 * Purpose: Reserves the coverage-profile computation used by the classifier.
 *
 * Exports:
 *   - computeCoverage
 *
 * Relationships:
 *   - Depends on learner-profile, lexical-prescription, and provider contract types.
 *   - Will be consumed by EnvelopeClassifier and telemetry in Epic 5.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: skeleton (no implementation yet; see Epic 5)
 */

import type {
  CoverageProfile,
  LearnerProfile,
  LemmaRef,
  LexicalAtlasProvider
} from "../types";

export function computeCoverage(
  _lemmas: LemmaRef[],
  _learner: LearnerProfile,
  _atlas: LexicalAtlasProvider
): CoverageProfile {
  throw new Error("TODO: Epic 5");
}
