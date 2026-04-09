/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/blackboard-learner-store.ts
 *
 * Purpose: Reserves the Blackboard-backed learner-state store for sugarlang.
 *
 * Exports:
 *   - BlackboardLearnerStore
 *
 * Relationships:
 *   - Depends on learner-profile contract types and Blackboard fact ownership.
 *   - Will be consumed by middleware and learner-state integration in Epic 7 and Epic 10.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / ADR 010 provider boundaries
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { LearnerProfile } from "../../types";

export class BlackboardLearnerStore {
  readProfile(): LearnerProfile | null {
    throw new Error("TODO: Epic 7");
  }

  writeProfile(_profile: LearnerProfile): void {
    throw new Error("TODO: Epic 7");
  }
}
