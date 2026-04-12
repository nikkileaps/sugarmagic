/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/calibration-mode.test.ts
 *
 * Purpose: Verifies the tiny post-placement calibration hint utility surface.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/calibration-mode directly.
 *   - Guards against reviving the old Director-owned placement flow by accident.
 *
 * Implements: Epic 9 Story 9.6
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  buildPostPlacementCalibrationHint,
  isInPostPlacementCalibration
} from "../../runtime/teacher/calibration-mode";
import { createTeacherContext } from "./test-helpers";

describe("calibration-mode", () => {
  it("returns true for a low-confidence evaluated learner early in session", () => {
    const learner = createTeacherContext().learner;
    learner.assessment.cefrConfidence = 0.4;
    learner.currentSession!.turns = 4;

    expect(isInPostPlacementCalibration(learner)).toBe(true);
  });

  it("returns false for a high-confidence learner", () => {
    const learner = createTeacherContext().learner;
    learner.assessment.cefrConfidence = 0.9;

    expect(isInPostPlacementCalibration(learner)).toBe(false);
  });

  it("returns false once the session warm-up window closes", () => {
    const learner = createTeacherContext().learner;
    learner.currentSession!.turns = 12;

    expect(isInPostPlacementCalibration(learner)).toBe(false);
  });

  it("returns false before placement completes", () => {
    const learner = createTeacherContext().learner;
    learner.assessment.status = "unassessed";

    expect(isInPostPlacementCalibration(learner)).toBe(false);
  });

  it("returns the exact calibration hint text", () => {
    expect(buildPostPlacementCalibrationHint()).toBe(
      "NOTE: This learner just completed their placement assessment but has not yet built up session history. Lean slightly toward the cautious side - prefer supported posture over target-dominant, prefer inline glossing on any new word, keep sentences at one or two clauses. This is a brief settling-in window, not a permanent constraint."
    );
  });
});
