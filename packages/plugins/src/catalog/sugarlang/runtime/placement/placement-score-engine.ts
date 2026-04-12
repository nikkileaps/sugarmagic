/**
 * packages/plugins/src/catalog/sugarlang/runtime/placement/placement-score-engine.ts
 *
 * Purpose: Implements the deterministic questionnaire scoring engine for Sugarlang placement.
 *
 * Exports:
 *   - PlacementScoreResult
 *   - PlacementScoreEngine
 *
 * Relationships:
 *   - Depends on the plugin-owned placement questionnaire assets.
 *   - Will be consumed by the placement flow orchestrator in Epic 11.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Placement Interaction Contract
 *
 * Status: active
 */

import type {
  CEFRBand,
  LexicalAtlasProvider,
  LemmaRef,
  PlacementQuestionnaire,
  PlacementQuestionnaireResponse,
  PlacementScoreResult
} from "../types";
import { MorphologyLoader } from "../classifier/morphology-loader";
import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";

export type { PlacementScoreResult } from "../types";

const CEFR_BANDS_ASCENDING: CEFRBand[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CONTENT_STOPWORDS: Record<string, Set<string>> = {
  es: new Set(["yo", "tu", "tú", "mi", "mis", "con", "de", "del", "la", "el", "los", "las", "un", "una", "y", "o"]),
  it: new Set(["io", "tu", "mio", "mia", "miei", "mie", "con", "di", "del", "della", "il", "lo", "la", "gli", "le", "un", "una", "e", "o"])
};

function createEmptyBandScores(): PlacementScoreResult["perBandScores"] {
  return {
    A1: { correct: 0, total: 0 },
    A2: { correct: 0, total: 0 },
    B1: { correct: 0, total: 0 },
    B2: { correct: 0, total: 0 },
    C1: { correct: 0, total: 0 },
    C2: { correct: 0, total: 0 }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getQuestionnaireVersion(questionnaire: PlacementQuestionnaire): string {
  return `${questionnaire.lang}-placement-v${questionnaire.schemaVersion}`;
}

function normalizeText(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

function extractSeededContentLemmas(args: {
  text: string;
  lang: string;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
}): LemmaRef[] {
  const seen = new Set<string>();
  const lemmas: LemmaRef[] = [];
  const stopwords = CONTENT_STOPWORDS[args.lang] ?? new Set<string>();

  for (const token of tokenize(args.text, args.lang)) {
    if (token.kind !== "word") {
      continue;
    }

    const lemmaId = lemmatize(token.surface, args.lang, args.morphology);
    if (!lemmaId || stopwords.has(lemmaId) || seen.has(lemmaId)) {
      continue;
    }
    if (!args.atlas.getLemma(lemmaId, args.lang)) {
      continue;
    }

    seen.add(lemmaId);
    lemmas.push({
      lemmaId,
      lang: args.lang
    });
  }

  return lemmas.sort((left, right) => left.lemmaId.localeCompare(right.lemmaId));
}

function scoreMultipleChoice(
  question: Extract<PlacementQuestionnaire["questions"][number], { kind: "multiple-choice" }>,
  answer: PlacementQuestionnaireResponse["answers"][string]
): boolean {
  if (!answer || answer.kind !== "multiple-choice") {
    return false;
  }

  return question.options.some(
    (option) => option.isCorrect && option.optionId === answer.optionId
  );
}

function scoreYesNo(
  question: Extract<PlacementQuestionnaire["questions"][number], { kind: "yes-no" }>,
  answer: PlacementQuestionnaireResponse["answers"][string]
): boolean {
  return answer?.kind === "yes-no" && answer.answer === question.correctAnswer;
}

function scoreFillInBlank(args: {
  question: Extract<PlacementQuestionnaire["questions"][number], { kind: "fill-in-blank" }>;
  answer: PlacementQuestionnaireResponse["answers"][string];
  morphology: MorphologyLoader;
  lang: string;
}): boolean {
  if (!args.answer || args.answer.kind !== "fill-in-blank") {
    return false;
  }

  const normalized = normalizeText(args.answer.text);
  if (args.question.acceptableAnswers.some((entry) => normalizeText(entry) === normalized)) {
    return true;
  }

  const lemmaId = lemmatize(normalized, args.lang, args.morphology);
  return (
    lemmaId !== null &&
    (args.question.acceptableLemmas ?? []).includes(lemmaId)
  );
}

function scoreFreeText(args: {
  question: Extract<PlacementQuestionnaire["questions"][number], { kind: "free-text" }>;
  answer: PlacementQuestionnaireResponse["answers"][string];
  morphology: MorphologyLoader;
  lang: string;
}): boolean {
  if (!args.answer || args.answer.kind !== "free-text") {
    return false;
  }

  const normalized = normalizeText(args.answer.text);
  if (
    typeof args.question.minExpectedLength === "number" &&
    normalized.length < args.question.minExpectedLength
  ) {
    return false;
  }

  const lemmaIds = new Set(
    tokenize(normalized, args.lang)
      .filter((token) => token.kind === "word")
      .map((token) => lemmatize(token.surface, args.lang, args.morphology))
      .filter((lemmaId): lemmaId is string => lemmaId !== null)
  );
  if (args.question.expectedLemmas.some((lemmaId) => lemmaIds.has(lemmaId))) {
    return true;
  }

  return (args.question.acceptableForms ?? []).some(
    (entry) => normalizeText(entry) === normalized
  );
}

export function scorePlacement(
  questionnaire: PlacementQuestionnaire,
  response: PlacementQuestionnaireResponse,
  atlas: LexicalAtlasProvider,
  morphology: MorphologyLoader
): PlacementScoreResult {
  const perBandScores = createEmptyBandScores();
  const seededLemmaMap = new Map<string, LemmaRef>();
  let skippedCount = 0;
  let answeredCount = 0;

  for (const question of questionnaire.questions) {
    const answer = response.answers[question.questionId];
    if (!answer || answer.kind === "skipped") {
      skippedCount += 1;
      continue;
    }

    answeredCount += 1;
    perBandScores[question.targetBand].total += 1;

    let passed = false;
    switch (question.kind) {
      case "multiple-choice":
        passed = scoreMultipleChoice(question, answer);
        break;
      case "yes-no":
        passed = scoreYesNo(question, answer);
        break;
      case "fill-in-blank":
        passed = scoreFillInBlank({
          question,
          answer,
          morphology,
          lang: questionnaire.targetLanguage
        });
        if (passed && answer.kind === "fill-in-blank") {
          for (const lemma of extractSeededContentLemmas({
            text: answer.text,
            lang: questionnaire.targetLanguage,
            atlas,
            morphology
          })) {
            seededLemmaMap.set(lemma.lemmaId, lemma);
          }
        }
        break;
      case "free-text":
        passed = scoreFreeText({
          question,
          answer,
          morphology,
          lang: questionnaire.targetLanguage
        });
        if (passed && answer.kind === "free-text") {
          for (const lemma of extractSeededContentLemmas({
            text: answer.text,
            lang: questionnaire.targetLanguage,
            atlas,
            morphology
          })) {
            seededLemmaMap.set(lemma.lemmaId, lemma);
          }
        }
        break;
      default: {
        const exhaustive: never = question;
        throw new Error(`Unhandled placement question kind: ${String(exhaustive)}`);
      }
    }

    if (passed) {
      perBandScores[question.targetBand].correct += 1;
    }
  }

  let cefrBand: CEFRBand = "A1";
  const a1Score = perBandScores.A1;
  if (
    a1Score.total > 0 &&
    a1Score.correct / a1Score.total >= 0.5
  ) {
    for (const band of CEFR_BANDS_ASCENDING) {
      const score = perBandScores[band];
      if (score.total === 0) {
        continue;
      }
      if (score.correct / score.total >= 0.7) {
        cefrBand = band;
      }
    }
  }

  return {
    cefrBand,
    confidence: clamp(
      questionnaire.questions.length === 0
        ? 0.3
        : answeredCount / questionnaire.questions.length,
      0.3,
      0.95
    ),
    perBandScores,
    lemmasSeededFromFreeText: Array.from(seededLemmaMap.values()).sort((left, right) =>
      left.lemmaId.localeCompare(right.lemmaId)
    ),
    skippedCount,
    totalCount: questionnaire.questions.length,
    scoredAtMs: response.submittedAtMs,
    questionnaireVersion: getQuestionnaireVersion(questionnaire)
  };
}

export class PlacementScoreEngine {
  constructor(
    private readonly atlas: LexicalAtlasProvider,
    private readonly morphology: MorphologyLoader
  ) {}

  scoreResponses(
    responses: PlacementQuestionnaireResponse,
    questionnaire: PlacementQuestionnaire
  ): PlacementScoreResult {
    return scorePlacement(questionnaire, responses, this.atlas, this.morphology);
  }
}
