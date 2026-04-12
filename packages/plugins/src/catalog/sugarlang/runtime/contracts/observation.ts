/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/observation.ts
 *
 * Purpose: Declares the observation and FSRS-grade types used by the observer and budgeter seams.
 *
 * Exports:
 *   - ObservationKind
 *   - ProducedObservationKind
 *   - FSRSGrade
 *   - ObservationContext
 *   - LemmaObservation
 *   - ObservationEvent
 *   - ObservationOutcome
 *
 * Relationships:
 *   - Depends on lexical-prescription types for lemma references.
 *   - Is consumed by the observer middleware, learner-state reducer, and budgeter stubs.
 *
 * Implements: Proposal 001 §Implicit Signal Collection / §Receptive vs. Productive Knowledge
 *
 * Status: active
 */

import type { LemmaRef } from "./lexical-prescription";

/**
 * All observation kinds emitted by sugarlang's implicit-signal layer.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge / §Observer Latency Bias
 */
export type ObservationKind =
  | "encountered"
  | "rapid-advance"
  | "hovered"
  | "quest-success"
  | "produced-chosen"
  | "produced-typed"
  | "produced-unprompted"
  | "produced-incorrect";

/**
 * Convenience helper for narrowing to the four productive observation subkinds.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge
 */
export type ProducedObservationKind = Extract<ObservationKind, `produced-${string}`>;

/**
 * FSRS grade output used by the deterministic observation-mapping layer.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge
 */
export type FSRSGrade = "Again" | "Hard" | "Good" | "Easy";

interface BaseObservation {
  observedAtMs: number;
}

/**
 * Discriminated union over every implicit learning signal sugarlang records.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge / §Observer Latency Bias
 */
export type LemmaObservation =
  | ({ kind: "encountered" } & BaseObservation)
  | ({ kind: "rapid-advance"; dwellMs: number } & BaseObservation)
  | ({ kind: "hovered"; dwellMs?: number } & BaseObservation)
  | ({ kind: "hovered-introduce"; dwellMs?: number } & BaseObservation)
  | ({ kind: "quest-success"; objectiveNodeId: string } & BaseObservation)
  | ({ kind: "produced-typed"; inputText: string } & BaseObservation)
  | ({ kind: "produced-chosen"; choiceSetId: string } & BaseObservation)
  | ({ kind: "produced-unprompted" } & BaseObservation)
  | ({
      kind: "produced-incorrect";
      attemptedForm: string;
      expectedForm: string;
    } & BaseObservation);

/**
 * Runtime context attached to one observation event.
 *
 * Implements: Proposal 001 §Implicit Signal Collection
 */
export interface ObservationContext {
  sessionId: string;
  turnId: string;
  sceneId: string;
  lang: string;
  conversationId: string;
}

/**
 * Fully contextualized observation event written into the learner pipeline.
 *
 * Implements: Proposal 001 §Implicit Signal Collection
 */
export interface ObservationEvent {
  observation: LemmaObservation;
  lemma: LemmaRef;
  context: ObservationContext;
}

/**
 * Deterministic outcome produced by the observation→grade rule table.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge / §Observer Latency Bias
 */
export interface ObservationOutcome {
  receptiveGrade: FSRSGrade | null;
  productiveStrengthDelta: number;
  provisionalEvidenceDelta: number;
}
