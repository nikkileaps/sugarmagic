/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/test-helpers.ts
 *
 * Purpose: Shares compact fixtures for Epic 5 classifier tests.
 *
 * Exports:
 *   - createLearnerProfile
 *   - createLexicalAtlasProvider
 *   - createMorphologyData
 *
 * Relationships:
 *   - Is consumed by the classifier unit tests in this directory.
 *   - Keeps test-only fixture duplication out of the runtime modules.
 *
 * Implements: Epic 5 classifier test support
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  CEFRBand,
  CefrPosterior,
  LearnerProfile,
  LemmaCard,
  LemmaRef,
  LexicalAtlasProvider
} from "../../runtime/types";
import type { MorphologyDataFile } from "../../runtime/classifier/morphology-loader";

function createPosterior(): CefrPosterior {
  return {
    A1: { alpha: 1, beta: 1 },
    A2: { alpha: 1, beta: 1 },
    B1: { alpha: 1, beta: 1 },
    B2: { alpha: 1, beta: 1 },
    C1: { alpha: 1, beta: 1 },
    C2: { alpha: 1, beta: 1 }
  };
}

export function createLearnerProfile(
  estimatedCefrBand: CEFRBand,
  options: {
    targetLanguage?: string;
    supportLanguage?: string;
    knownLemmaIds?: string[];
  } = {}
): LearnerProfile {
  const knownLemmaIds = options.knownLemmaIds ?? [];
  const lemmaCards: Record<string, LemmaCard> = {};

  for (const lemmaId of knownLemmaIds) {
    lemmaCards[lemmaId] = {
      lemmaId,
      difficulty: 1,
      stability: 2,
      retrievability: 0.8,
      lastReviewedAt: null,
      reviewCount: 0,
      lapseCount: 0,
      cefrPriorBand: estimatedCefrBand,
      priorWeight: 1,
      productiveStrength: 0,
      lastProducedAtMs: null,
      provisionalEvidence: 0,
      provisionalEvidenceFirstSeenTurn: null
    };
  }

  return {
    learnerId: "learner-epic-5" as LearnerProfile["learnerId"],
    targetLanguage: options.targetLanguage ?? "es",
    supportLanguage: options.supportLanguage ?? "en",
    assessment: {
      status: "estimated",
      evaluatedCefrBand: null,
      cefrConfidence: 0.5,
      evaluatedAtMs: null
    },
    estimatedCefrBand,
    cefrPosterior: createPosterior(),
    lemmaCards,
    currentSession: null,
    sessionHistory: []
  };
}

export function createLexicalAtlasProvider(
  lang: string,
  entries: Array<{
    lemmaId: string;
    cefrPriorBand: CEFRBand;
    frequencyRank?: number;
    gloss?: string;
  }>
): LexicalAtlasProvider {
  const lemmaMap = new Map<string, AtlasLemmaEntry>();

  for (const entry of entries) {
    lemmaMap.set(entry.lemmaId, {
      lemmaId: entry.lemmaId,
      lang,
      cefrPriorBand: entry.cefrPriorBand,
      frequencyRank: entry.frequencyRank ?? 1,
      partsOfSpeech: ["test"],
      gloss: entry.gloss
    });
  }

  return {
    getLemma(lemmaId: string, _lookupLang: string): AtlasLemmaEntry | undefined {
      return lemmaMap.get(lemmaId);
    },
    getBand(lemmaId: string, _lookupLang: string): CEFRBand | undefined {
      return lemmaMap.get(lemmaId)?.cefrPriorBand;
    },
    getFrequencyRank(lemmaId: string, _lookupLang: string): number | undefined {
      return lemmaMap.get(lemmaId)?.frequencyRank ?? undefined;
    },
    listLemmasAtBand(band: CEFRBand, _lookupLang: string): LemmaRef[] {
      return Array.from(lemmaMap.values())
        .filter((entry) => entry.cefrPriorBand === band)
        .map((entry) => ({
          lemmaId: entry.lemmaId,
          lang: entry.lang
        }));
    },
    getAtlasVersion(_lookupLang: string): string {
      return "test-atlas-v1";
    }
  };
}

export function createMorphologyData(
  lang: string,
  forms: Record<string, string>
): MorphologyDataFile {
  return {
    lang,
    forms: Object.fromEntries(
      Object.entries(forms).map(([surfaceForm, lemmaId]) => [
        surfaceForm,
        {
          lemmaId,
          partsOfSpeech: ["test"]
        }
      ])
    )
  };
}
