/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/session-signals.ts
 *
 * Purpose: Reserves the derived session-signal helpers used by learner-state updates.
 *
 * Exports:
 *   - computeFatigueScore
 *   - computeHoverRate
 *
 * Relationships:
 *   - Depends on learner-profile session types.
 *   - Will be consumed by LearnerStateReducer once Epic 7 lands.
 *
 * Implements: Proposal 001 §Learner State Model / §Implicit Signal Collection
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { CurrentSessionSignals } from "../types";

export function computeFatigueScore(
  _session: CurrentSessionSignals
): number {
  throw new Error("TODO: Epic 7");
}

export function computeHoverRate(
  _session: CurrentSessionSignals
): number {
  throw new Error("TODO: Epic 7");
}
