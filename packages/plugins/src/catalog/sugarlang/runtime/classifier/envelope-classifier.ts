/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/envelope-classifier.ts
 *
 * Purpose: Reserves the main deterministic Envelope Classifier facade.
 *
 * Exports:
 *   - EnvelopeClassifier
 *
 * Relationships:
 *   - Depends on learner-profile and envelope contract types.
 *   - Will be consumed by the verify middleware once Epic 5 lands.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: skeleton (no implementation yet; see Epic 5)
 */

import type { EnvelopeVerdict, LearnerProfile } from "../types";

export class EnvelopeClassifier {
  check(_text: string, _learner: LearnerProfile): EnvelopeVerdict {
    throw new Error("TODO: Epic 5");
  }
}
