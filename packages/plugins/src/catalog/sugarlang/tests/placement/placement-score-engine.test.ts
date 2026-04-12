/**
 * packages/plugins/src/catalog/sugarlang/tests/placement/placement-score-engine.test.ts
 *
 * Purpose: Verifies deterministic placement questionnaire scoring and free-text lemma seeding.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/placement/placement-score-engine.
 *   - Uses lightweight morphology and atlas fixtures to keep the scoring rules auditable.
 *
 * Implements: Epic 11 Story 11.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { MorphologyLoader, type MorphologyDataFile } from "../../runtime/classifier/morphology-loader";
import { PlacementScoreEngine } from "../../runtime/placement/placement-score-engine";
import type {
  PlacementQuestionnaire,
  PlacementQuestionnaireResponse
} from "../../runtime/types";
import { createAtlasProvider } from "../learner/test-helpers";

const SPANISH_MORPHOLOGY: MorphologyDataFile = {
  lang: "es",
  forms: {
    me: { lemmaId: "me" },
    llamo: { lemmaId: "llamarse" },
    soy: { lemmaId: "ser" },
    si: { lemmaId: "si" },
    sí: { lemmaId: "si" },
    trabajo: { lemmaId: "trabajar" },
    viajé: { lemmaId: "viajar" },
    viaje: { lemmaId: "viajar" },
    viajo: { lemmaId: "viajar" },
    viaja: { lemmaId: "viajar" },
    vengo: { lemmaId: "venir" },
    ciudad: { lemmaId: "ciudad" },
    familia: { lemmaId: "familia" },
    con: { lemmaId: "con" },
    mi: { lemmaId: "mi" },
    resolví: { lemmaId: "resolver" },
    problema: { lemmaId: "problema" },
    biglietto: { lemmaId: "biglietto" }
  }
};

function createQuestionnaire(
  overrides: Partial<PlacementQuestionnaire> = {}
): PlacementQuestionnaire {
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
        questionId: "q-a1-choice",
        targetBand: "A1",
        promptText: "Question 1",
        options: [
          { optionId: "a", text: "Correct", isCorrect: true },
          { optionId: "b", text: "Wrong", isCorrect: false }
        ]
      },
      {
        kind: "fill-in-blank",
        questionId: "q-a1-fill",
        targetBand: "A1",
        promptText: "Question 2",
        sentenceTemplate: "Yo ___ de Canada.",
        acceptableAnswers: ["soy"],
        acceptableLemmas: ["ser"]
      },
      {
        kind: "yes-no",
        questionId: "q-a2-yesno",
        targetBand: "A2",
        promptText: "Question 3",
        correctAnswer: "yes",
        yesLabel: "si",
        noLabel: "no"
      },
      {
        kind: "free-text",
        questionId: "q-a2-free",
        targetBand: "A2",
        promptText: "Question 4",
        expectedLemmas: ["trabajar"],
        acceptableForms: ["trabajo"],
        minExpectedLength: 6
      },
      {
        kind: "fill-in-blank",
        questionId: "q-b1-fill",
        targetBand: "B1",
        promptText: "Question 5",
        sentenceTemplate: "Ayer yo ___.",
        acceptableAnswers: ["viajo"],
        acceptableLemmas: ["viajar"]
      },
      {
        kind: "free-text",
        questionId: "q-b1-free",
        targetBand: "B1",
        promptText: "Question 6",
        expectedLemmas: ["venir", "ciudad"],
        minExpectedLength: 10
      }
    ],
    ...overrides
  };
}

function createEngine(): PlacementScoreEngine {
  return new PlacementScoreEngine(
    createAtlasProvider([
      { lemmaId: "trabajar", cefrPriorBand: "A1" },
      { lemmaId: "viajar", cefrPriorBand: "A2" },
      { lemmaId: "familia", cefrPriorBand: "A1" },
      { lemmaId: "venir", cefrPriorBand: "A2" },
      { lemmaId: "ciudad", cefrPriorBand: "A2" },
      { lemmaId: "resolver", cefrPriorBand: "B1" },
      { lemmaId: "problema", cefrPriorBand: "A2" }
    ]),
    new MorphologyLoader({ es: SPANISH_MORPHOLOGY })
  );
}

function createResponse(
  answers: PlacementQuestionnaireResponse["answers"]
): PlacementQuestionnaireResponse {
  return {
    questionnaireId: "es-placement-v1",
    submittedAtMs: 1234,
    answers
  };
}

describe("PlacementScoreEngine", () => {
  it("scores a fully correct A1-only questionnaire to A1 with high confidence", () => {
    const questionnaire = createQuestionnaire({
      questions: createQuestionnaire().questions.slice(0, 2)
    });
    const result = createEngine().scoreResponses(
      createResponse({
        "q-a1-choice": { kind: "multiple-choice", optionId: "a" },
        "q-a1-fill": { kind: "fill-in-blank", text: "soy" }
      }),
      questionnaire
    );

    expect(result.cefrBand).toBe("A1");
    expect(result.confidence).toBe(0.95);
    expect(result.perBandScores.A1).toEqual({ correct: 2, total: 2 });
  });

  it("scores a correct A1/A2/B1 mix up to B1", () => {
    const result = createEngine().scoreResponses(
      createResponse({
        "q-a1-choice": { kind: "multiple-choice", optionId: "a" },
        "q-a1-fill": { kind: "fill-in-blank", text: "soy" },
        "q-a2-yesno": { kind: "yes-no", answer: "yes" },
        "q-a2-free": { kind: "free-text", text: "Yo trabajo aqui." },
        "q-b1-fill": { kind: "fill-in-blank", text: "viajé" },
        "q-b1-free": { kind: "free-text", text: "Vengo a la ciudad." }
      }),
      createQuestionnaire()
    );

    expect(result.cefrBand).toBe("B1");
    expect(result.perBandScores.B1).toEqual({ correct: 2, total: 2 });
  });

  it("scores an all-skipped questionnaire to A1 at the confidence floor", () => {
    const questionnaire = createQuestionnaire();
    const result = createEngine().scoreResponses(
      createResponse(
        Object.fromEntries(
          questionnaire.questions.map((question) => [
            question.questionId,
            { kind: "skipped" as const }
          ])
        )
      ),
      questionnaire
    );

    expect(result.cefrBand).toBe("A1");
    expect(result.confidence).toBe(0.3);
    expect(result.skippedCount).toBe(questionnaire.questions.length);
  });

  it("accepts fill-in-blank and free-text answers via lemma fallback in unexpected inflections", () => {
    const result = createEngine().scoreResponses(
      createResponse({
        "q-a1-choice": { kind: "multiple-choice", optionId: "a" },
        "q-a1-fill": { kind: "fill-in-blank", text: "soy" },
        "q-a2-yesno": { kind: "yes-no", answer: "yes" },
        "q-a2-free": { kind: "free-text", text: "Yo trabajo." },
        "q-b1-fill": { kind: "fill-in-blank", text: "viajé" },
        "q-b1-free": { kind: "free-text", text: "Vengo a la ciudad." }
      }),
      createQuestionnaire()
    );

    expect(result.perBandScores.B1.correct).toBe(2);
  });

  it("is byte-deterministic for identical inputs", () => {
    const engine = createEngine();
    const questionnaire = createQuestionnaire();
    const response = createResponse({
      "q-a1-choice": { kind: "multiple-choice", optionId: "a" },
      "q-a1-fill": { kind: "fill-in-blank", text: "soy" },
      "q-a2-yesno": { kind: "yes-no", answer: "yes" },
      "q-a2-free": { kind: "free-text", text: "Yo trabajo con mi familia." }
    });

    expect(engine.scoreResponses(response, questionnaire)).toEqual(
      engine.scoreResponses(response, questionnaire)
    );
  });

  it("seeds only content lemmas from correct free-text answers", () => {
    const questionnaire = createQuestionnaire({
      questions: [
        createQuestionnaire().questions[0]!,
        createQuestionnaire().questions[1]!,
        createQuestionnaire().questions[2]!,
        {
          kind: "free-text",
          questionId: "q-seed",
          targetBand: "A2",
          promptText: "Describe your trip.",
          expectedLemmas: ["viajar"],
          minExpectedLength: 6
        }
      ]
    });
    const result = createEngine().scoreResponses(
      createResponse({
        "q-a1-choice": { kind: "multiple-choice", optionId: "a" },
        "q-a1-fill": { kind: "fill-in-blank", text: "soy" },
        "q-a2-yesno": { kind: "yes-no", answer: "yes" },
        "q-seed": {
          kind: "free-text",
          text: "yo viajo con mi familia"
        }
      }),
      questionnaire
    );

    expect(result.lemmasSeededFromFreeText).toEqual([
      { lemmaId: "familia", lang: "es" },
      { lemmaId: "viajar", lang: "es" }
    ]);
  });
});
