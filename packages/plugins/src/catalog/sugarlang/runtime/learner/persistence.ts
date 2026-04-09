/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/persistence.ts
 *
 * Purpose: Reserves learner-profile serialization and deserialization helpers.
 *
 * Exports:
 *   - serializeLearnerProfile
 *   - deserializeLearnerProfile
 *
 * Relationships:
 *   - Depends on learner-profile contract types.
 *   - Will be consumed by the learner persistence layer once Epic 7 lands.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { LearnerProfile } from "../types";

export function serializeLearnerProfile(_profile: LearnerProfile): string {
  throw new Error("TODO: Epic 7");
}

export function deserializeLearnerProfile(_json: string): LearnerProfile {
  throw new Error("TODO: Epic 7");
}
