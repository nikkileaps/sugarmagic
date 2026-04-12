/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-questionnaire-loader.ts
 *
 * Purpose: Reserves the loader for plugin-shipped placement questionnaire assets.
 *
 * Exports:
 *   - loadPlacementQuestionnaire
 *
 * Relationships:
 *   - Will read data/languages/<lang>/placement-questionnaire.json once Epic 4 and Epic 11 land.
 *   - Will be consumed by the placement flow orchestrator.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import esQuestionnaire from "../../data/languages/es/placement-questionnaire.json";
import itQuestionnaire from "../../data/languages/it/placement-questionnaire.json";
import type { PlacementQuestionnaire } from "../types";

function assertValidPlacementQuestion(question: unknown, lang: string): void {
  if (typeof question !== "object" || question === null) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": question is not an object.`
    );
  }

  const typedQuestion = question as Record<string, unknown>;
  if (
    typeof typedQuestion.questionId !== "string" ||
    typedQuestion.questionId.length === 0
  ) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": question is missing questionId.`
    );
  }

  switch (typedQuestion.kind) {
    case "multiple-choice":
      if (
        !Array.isArray(typedQuestion.options) ||
        typedQuestion.options.length < 2
      ) {
        throw new Error(
          `Invalid placement questionnaire for "${lang}": multiple-choice question "${typedQuestion.questionId}" has too few options.`
        );
      }
      return;
    case "free-text":
      if (
        !Array.isArray(typedQuestion.expectedLemmas) ||
        typedQuestion.expectedLemmas.length === 0
      ) {
        throw new Error(
          `Invalid placement questionnaire for "${lang}": free-text question "${typedQuestion.questionId}" is missing expectedLemmas.`
        );
      }
      return;
    case "yes-no":
      if (
        (typedQuestion.correctAnswer !== "yes" &&
          typedQuestion.correctAnswer !== "no") ||
        typeof typedQuestion.yesLabel !== "string" ||
        typeof typedQuestion.noLabel !== "string"
      ) {
        throw new Error(
          `Invalid placement questionnaire for "${lang}": yes-no question "${typedQuestion.questionId}" is incomplete.`
        );
      }
      return;
    case "fill-in-blank":
      if (
        typeof typedQuestion.sentenceTemplate !== "string" ||
        !Array.isArray(typedQuestion.acceptableAnswers) ||
        typedQuestion.acceptableAnswers.length === 0
      ) {
        throw new Error(
          `Invalid placement questionnaire for "${lang}": fill-in-blank question "${typedQuestion.questionId}" is incomplete.`
        );
      }
      return;
    default:
      throw new Error(
        `Invalid placement questionnaire for "${lang}": unknown question kind "${String(
          typedQuestion["kind"]
        )}".`
      );
  }
}

function assertValidPlacementQuestionnaire(
  data: unknown,
  lang: string
): asserts data is PlacementQuestionnaire {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": expected object root.`
    );
  }

  const record = data as Record<string, unknown>;
  if (record.lang !== lang) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": lang mismatch.`
    );
  }
  if (!Array.isArray(record.questions)) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": missing questions array.`
    );
  }
  if (record.schemaVersion !== 1) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": unsupported schemaVersion.`
    );
  }
  if (
    typeof record.formTitle !== "string" ||
    typeof record.formIntro !== "string"
  ) {
    throw new Error(
      `Invalid placement questionnaire for "${lang}": missing form metadata.`
    );
  }
  for (const question of record.questions) {
    assertValidPlacementQuestion(question, lang);
  }
}

const DEFAULT_QUESTIONNAIRES: Record<string, PlacementQuestionnaire> = {
  es: esQuestionnaire as PlacementQuestionnaire,
  it: itQuestionnaire as PlacementQuestionnaire
};

export class PlacementQuestionnaireLoader {
  private readonly cache = new Map<string, PlacementQuestionnaire>();

  constructor(
    private readonly questionnaires: Partial<
      Record<string, PlacementQuestionnaire>
    > = DEFAULT_QUESTIONNAIRES
  ) {}

  getQuestionnaire(lang: string): PlacementQuestionnaire {
    const cached = this.cache.get(lang);
    if (cached) {
      return cached;
    }

    const questionnaire = this.questionnaires[lang];
    if (!questionnaire) {
      throw new Error(
        `Missing sugarlang placement questionnaire for language "${lang}".`
      );
    }

    assertValidPlacementQuestionnaire(questionnaire, lang);
    this.cache.set(lang, questionnaire);
    return questionnaire;
  }
}

const defaultPlacementQuestionnaireLoader = new PlacementQuestionnaireLoader();

export function getQuestionnaire(lang: string): PlacementQuestionnaire {
  return defaultPlacementQuestionnaireLoader.getQuestionnaire(lang);
}

export function loadPlacementQuestionnaire(
  lang: string
): PlacementQuestionnaire {
  return getQuestionnaire(lang);
}
