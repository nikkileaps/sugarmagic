/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/observation.ts
 *
 * Purpose: Declares the observation and FSRS-grade types used by the observer and budgeter seams.
 *
 * Exports:
 *   - ObservationKind
 *   - FSRSGrade
 *   - LemmaObservation
 *
 * Relationships:
 *   - Depends on lexical-prescription types for lemma references.
 *   - Is consumed by the observer middleware, learner-state reducer, and budgeter stubs.
 *
 * Implements: Proposal 001 §Implicit Signal Collection / §Receptive vs. Productive Knowledge
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { LemmaRef } from "./lexical-prescription";

export type ObservationKind =
  | "encountered"
  | "rapid-advance"
  | "hovered"
  | "quest-success"
  | "produced-chosen"
  | "produced-typed"
  | "produced-unprompted"
  | "produced-incorrect";

export type FSRSGrade = "Again" | "Hard" | "Good" | "Easy";

export interface LemmaObservation {
  lemmaRef: LemmaRef;
  kind: ObservationKind;
  observedAtMs: number;
  dwellMs?: number;
  metadata?: Record<string, unknown>;
}
