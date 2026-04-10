/**
 * packages/plugins/src/catalog/sugarlang/tests/budgeter/observations.test.ts
 *
 * Purpose: Verifies the pure observation-to-outcome rule table.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Imports ../../runtime/budgeter/observations as the implementation under test.
 *   - Covers Epic 8 Story 8.2.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type {
  LemmaObservation,
  ObservationKind,
  ObservationOutcome
} from "../../runtime/types";
import {
  PRODUCTIVE_DELTAS,
  PROVISIONAL_DELTA_CAP,
  computeProvisionalEvidenceDelta,
  observationToFsrsGrade,
  observationToOutcome
} from "../../runtime/budgeter/observations";

function createObservation(kind: ObservationKind): LemmaObservation {
  switch (kind) {
    case "encountered":
      return { kind, observedAtMs: 0 };
    case "rapid-advance":
      return { kind, dwellMs: 2000, observedAtMs: 0 };
    case "hovered":
      return { kind, observedAtMs: 0 };
    case "quest-success":
      return { kind, objectiveNodeId: "objective-1", observedAtMs: 0 };
    case "produced-chosen":
      return { kind, choiceSetId: "choice-1", observedAtMs: 0 };
    case "produced-typed":
      return { kind, inputText: "hola", observedAtMs: 0 };
    case "produced-unprompted":
      return { kind, observedAtMs: 0 };
    case "produced-incorrect":
      return {
        kind,
        attemptedForm: "ola",
        expectedForm: "hola",
        observedAtMs: 0
      };
  }
}

describe("budgeter observations", () => {
  it("maps every observation kind to the documented outcome", () => {
    const outcomes: Record<ObservationKind, ObservationOutcome> = {
      encountered: observationToOutcome({ kind: "encountered", observedAtMs: 0 }),
      "rapid-advance": observationToOutcome({
        kind: "rapid-advance",
        dwellMs: 2000,
        observedAtMs: 0
      }),
      hovered: observationToOutcome({ kind: "hovered", observedAtMs: 0 }),
      "quest-success": observationToOutcome({
        kind: "quest-success",
        objectiveNodeId: "objective-1",
        observedAtMs: 0
      }),
      "produced-chosen": observationToOutcome({
        kind: "produced-chosen",
        choiceSetId: "choice-1",
        observedAtMs: 0
      }),
      "produced-typed": observationToOutcome({
        kind: "produced-typed",
        inputText: "hola",
        observedAtMs: 0
      }),
      "produced-unprompted": observationToOutcome({
        kind: "produced-unprompted",
        observedAtMs: 0
      }),
      "produced-incorrect": observationToOutcome({
        kind: "produced-incorrect",
        attemptedForm: "ola",
        expectedForm: "hola",
        observedAtMs: 0
      })
    };

    expect(outcomes.encountered).toEqual({
      receptiveGrade: null,
      productiveStrengthDelta: 0,
      provisionalEvidenceDelta: 0
    });
    expect(outcomes["rapid-advance"]).toEqual({
      receptiveGrade: null,
      productiveStrengthDelta: 0,
      provisionalEvidenceDelta: 0.2
    });
    expect(outcomes.hovered.receptiveGrade).toBe("Hard");
    expect(outcomes["produced-unprompted"].productiveStrengthDelta).toBe(0.5);
    expect(observationToFsrsGrade({ kind: "hovered", observedAtMs: 0 })).toBe("Hard");
  });

  it("exports auditable constants and keeps production invariants intact", () => {
    expect(PRODUCTIVE_DELTAS.producedUnprompted).toBeGreaterThan(
      PRODUCTIVE_DELTAS.producedTyped
    );
    expect(PRODUCTIVE_DELTAS.producedTyped).toBeGreaterThanOrEqual(0.15);
    expect(PRODUCTIVE_DELTAS.producedIncorrect).toBeLessThan(0);
    expect(PROVISIONAL_DELTA_CAP).toBe(0.3);

    const positiveProductionKinds: ObservationKind[] = [
      "produced-chosen",
      "produced-typed",
      "produced-unprompted"
    ];
    for (const kind of positiveProductionKinds) {
      const outcome = observationToOutcome(createObservation(kind));
      expect(outcome.productiveStrengthDelta).toBeGreaterThanOrEqual(0);
      expect(outcome.receptiveGrade).not.toBeNull();
    }
  });

  it("keeps rapid-advance as provisional evidence only and caps the delta function", () => {
    expect(computeProvisionalEvidenceDelta(0)).toBe(0);
    expect(computeProvisionalEvidenceDelta(1000)).toBe(0.1);
    expect(computeProvisionalEvidenceDelta(3000)).toBe(0.3);
    expect(computeProvisionalEvidenceDelta(10000)).toBe(0.3);

    const rapidAdvance = observationToOutcome({
      kind: "rapid-advance",
      dwellMs: 2000,
      observedAtMs: 0
    });
    expect(rapidAdvance).toEqual({
      receptiveGrade: null,
      productiveStrengthDelta: 0,
      provisionalEvidenceDelta: 0.2
    });

    const otherKinds: ObservationKind[] = [
      "encountered",
      "hovered",
      "quest-success",
      "produced-chosen",
      "produced-typed",
      "produced-unprompted",
      "produced-incorrect"
    ];
    for (const kind of otherKinds) {
      const outcome = observationToOutcome(createObservation(kind));
      expect(outcome.provisionalEvidenceDelta).toBe(0);
    }
  });
});
