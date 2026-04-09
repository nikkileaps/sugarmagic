/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-rule.ts
 *
 * Purpose: Reserves the deterministic in-envelope rule used by the classifier.
 *
 * Exports:
 *   - applyEnvelopeRule
 *
 * Relationships:
 *   - Depends on the envelope contract types.
 *   - Will be consumed by EnvelopeClassifier once Epic 5 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: skeleton (no implementation yet; see Epic 5)
 */

import type {
  CoverageProfile,
  EnvelopeRuleOptions
} from "../types";

export function applyEnvelopeRule(
  _profile: CoverageProfile,
  _options: EnvelopeRuleOptions = {}
): boolean {
  throw new Error("TODO: Epic 5");
}
