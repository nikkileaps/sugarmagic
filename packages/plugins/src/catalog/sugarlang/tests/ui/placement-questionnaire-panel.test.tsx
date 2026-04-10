/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/placement-questionnaire-panel.test.tsx
 *
 * Purpose: Verifies the shared questionnaire panel helpers and static render contract.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../ui/shell/placement-questionnaire-panel.
 *   - Keeps the shell-side questionnaire primitive aligned with the runtime host rules.
 *
 * Implements: Epic 11 Story 11.2
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import {
  PlacementQuestionnairePanel,
  canSubmitPlacementQuestionnaire,
  countAnsweredPlacementAnswers,
  createPlacementQuestionnaireResponse,
  setPlacementQuestionnaireAnswer
} from "../../ui/shell/placement-questionnaire-panel";
import type { PlacementQuestionnaire } from "../../runtime/types";

function createQuestionnaire(): PlacementQuestionnaire {
  return {
    schemaVersion: 1,
    lang: "es",
    targetLanguage: "es",
    supportLanguage: "en",
    formTitle: "Arrival Form",
    formIntro: "Answer in Spanish.",
    minAnswersForValid: 2,
    questions: [
      {
        kind: "multiple-choice",
        questionId: "q1",
        targetBand: "A1",
        promptText: "Como te llamas?",
        options: [
          { optionId: "a", text: "Me llamo Ana.", isCorrect: true },
          { optionId: "b", text: "Tengo una maleta.", isCorrect: false }
        ]
      },
      {
        kind: "free-text",
        questionId: "q2",
        targetBand: "A1",
        promptText: "Escribe una frase.",
        expectedLemmas: ["trabajar"]
      },
      {
        kind: "yes-no",
        questionId: "q3",
        targetBand: "A1",
        promptText: "Hablas espanol?",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "fill-in-blank",
        questionId: "q4",
        targetBand: "A1",
        promptText: "Completa la frase.",
        sentenceTemplate: "Yo ___ de Canada.",
        acceptableAnswers: ["soy"],
        acceptableLemmas: ["ser"]
      }
    ]
  };
}

describe("PlacementQuestionnairePanel", () => {
  it("produces a valid React element for the questionnaire panel", () => {
    const element = (
      <PlacementQuestionnairePanel
        questionnaire={createQuestionnaire()}
        onSubmit={vi.fn()}
      />
    );

    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(PlacementQuestionnairePanel);
  });

  it("keeps skipped answers out of the submit threshold", () => {
    const questionnaire = createQuestionnaire();
    const withSkippedOnly = setPlacementQuestionnaireAnswer(
      createPlacementQuestionnaireResponse(questionnaire),
      "q1",
      { kind: "skipped" }
    );

    expect(countAnsweredPlacementAnswers(withSkippedOnly)).toBe(0);
    expect(canSubmitPlacementQuestionnaire(questionnaire, withSkippedOnly)).toBe(false);
  });

  it("allows submission once the minimum answered threshold is met", () => {
    const questionnaire = createQuestionnaire();
    const response = setPlacementQuestionnaireAnswer(
      setPlacementQuestionnaireAnswer(
        createPlacementQuestionnaireResponse(questionnaire),
        "q1",
        { kind: "multiple-choice", optionId: "a" }
      ),
      "q2",
      { kind: "free-text", text: "Trabajo aqui." }
    );

    expect(countAnsweredPlacementAnswers(response)).toBe(2);
    expect(canSubmitPlacementQuestionnaire(questionnaire, response)).toBe(true);
  });
});
