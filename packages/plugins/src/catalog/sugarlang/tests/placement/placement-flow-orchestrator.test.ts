/**
 * packages/plugins/src/catalog/sugarlang/tests/placement/placement-flow-orchestrator.test.ts
 *
 * Purpose: Verifies placement phase transitions and reducer-event construction.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/placement/placement-flow-orchestrator.
 *   - Covers the pure state-machine layer that the context and observe middlewares share.
 *
 * Implements: Epic 11 Story 11.3
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  advancePlacementPhase,
  buildPlacementCompletionEvent,
  getPlacementQuestionnaireVersion
} from "../../runtime/placement/placement-flow-orchestrator";
import { createLearnerProfile } from "../learner/test-helpers";

describe("placement-flow-orchestrator", () => {
  it("advances through the documented phases", () => {
    expect(
      advancePlacementPhase({
        currentPhase: "not-active",
        currentTurnCount: 0,
        openingDialogTurns: 2,
        closingDialogTurns: 2,
        questionnaireSubmitted: false
      })
    ).toBe("opening-dialog");

    expect(
      advancePlacementPhase({
        currentPhase: "opening-dialog",
        currentTurnCount: 1,
        openingDialogTurns: 2,
        closingDialogTurns: 2,
        questionnaireSubmitted: false
      })
    ).toBe("opening-dialog");

    expect(
      advancePlacementPhase({
        currentPhase: "opening-dialog",
        currentTurnCount: 2,
        openingDialogTurns: 2,
        closingDialogTurns: 2,
        questionnaireSubmitted: false
      })
    ).toBe("questionnaire");

    expect(
      advancePlacementPhase({
        currentPhase: "questionnaire",
        currentTurnCount: 0,
        openingDialogTurns: 2,
        closingDialogTurns: 2,
        questionnaireSubmitted: true
      })
    ).toBe("closing-dialog");

    expect(
      advancePlacementPhase({
        currentPhase: "closing-dialog",
        currentTurnCount: 2,
        openingDialogTurns: 2,
        closingDialogTurns: 2,
        questionnaireSubmitted: false
      })
    ).toBe("not-active");
  });

  it("is pure for identical inputs", () => {
    const input = {
      currentPhase: "opening-dialog" as const,
      currentTurnCount: 2,
      openingDialogTurns: 2,
      closingDialogTurns: 2,
      questionnaireSubmitted: false
    };

    expect(advancePlacementPhase(input)).toBe(advancePlacementPhase(input));
  });

  it("builds the reducer completion event from the score result", () => {
    const event = buildPlacementCompletionEvent(
      {
        cefrBand: "B1",
        confidence: 0.72,
        perBandScores: {
          A1: { correct: 2, total: 2 },
          A2: { correct: 2, total: 2 },
          B1: { correct: 1, total: 2 },
          B2: { correct: 0, total: 0 },
          C1: { correct: 0, total: 0 },
          C2: { correct: 0, total: 0 }
        },
        lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }],
        skippedCount: 1,
        totalCount: 6,
        scoredAtMs: 999,
        questionnaireVersion: "es-placement-v1"
      },
      createLearnerProfile("A2")
    );

    expect(event).toEqual({
      type: "placement-completion",
      cefrBand: "B1",
      confidence: 0.72,
      completedAtMs: 999,
      lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }]
    });
  });

  it("derives the questionnaire version string canonically", () => {
    expect(
      getPlacementQuestionnaireVersion({
        schemaVersion: 1,
        lang: "it",
        targetLanguage: "it",
        supportLanguage: "en",
        formTitle: "Modulo",
        formIntro: "Intro",
        minAnswersForValid: 6,
        questions: []
      })
    ).toBe("it-placement-v1");
  });
});
