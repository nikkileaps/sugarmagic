/**
 * packages/plugins/src/catalog/sugarlang/tests/integration/scene-lexicon-fixture.ts
 *
 * Purpose: Shares compact fixtures for Epic 8 budgeter tests.
 *
 * Exports:
 *   - createBudgeterLearner
 *   - createBudgeterLemmaCard
 *   - createBudgeterSceneLexicon
 *   - createBudgeterAtlasProvider
 *
 * Relationships:
 *   - Is consumed by the Budgeter unit tests in this directory.
 *   - Keeps test-only fixture duplication out of the runtime modules.
 *
 * Implements: Epic 8 budgeter test support
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  CEFRBand,
  SceneVocabularyModel,
  LearnerProfile,
  LemmaCard,
  LexicalAtlasProvider,
  QuestEssentialLemma
} from "../../runtime/types";
import { createUniformCefrPosterior } from "../../runtime/learner/cefr-posterior";

export function createBudgeterLemmaCard(
  lemmaId: string,
  band: CEFRBand,
  overrides: Partial<LemmaCard> = {}
): LemmaCard {
  return {
    lemmaId,
    difficulty: 3,
    stability: 2,
    retrievability: 0.75,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    cefrPriorBand: band,
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null,
    ...overrides
  };
}

export function createBudgeterLearner(
  band: CEFRBand,
  overrides: Partial<LearnerProfile> = {}
): LearnerProfile {
  return {
    learnerId: "learner-epic-8" as LearnerProfile["learnerId"],
    targetLanguage: "es",
    supportLanguage: "en",
    assessment: {
      status: "estimated",
      evaluatedCefrBand: null,
      cefrConfidence: 0.5,
      evaluatedAtMs: null
    },
    estimatedCefrBand: band,
    cefrPosterior: createUniformCefrPosterior(),
    lemmaCards: {},
    currentSession: {
      sessionId: "session-1",
      startedAt: 1000,
      turns: 10,
    },
    sessionHistory: [],
    ...overrides
  };
}

export function createBudgeterSceneLexicon(options: {
  sceneId?: string;
  entries: Array<{
    lemmaId: string;
    band: CEFRBand;
    frequencyRank?: number;
    anchor?: boolean;
    isQuestCritical?: boolean;
  }>;
  questEssentialLemmas?: QuestEssentialLemma[];
}): SceneVocabularyModel {
  const lemmaIds: string[] = [];

  for (const entry of options.entries) {
    // 090.2c: band / rank / POS live in the atlas now, so a fixture scene entry
    // carries only what the scene actually owns. Tests that need band or rank
    // must stub the atlas, which is the point -- the artifact cannot disagree
    // with the dictionary any more.
    lemmaIds.push(entry.lemmaId);
  }

  return {
    sceneId: options.sceneId ?? "scene-budgeter",
    contentHash: "content-hash",
    pipelineVersion: "pipeline-v1",
    atlasVersion: "atlas-v1",
    profile: "runtime-preview",
    lemmaIds,
    properNouns: [],
    questEssentialLemmas: options.questEssentialLemmas ?? []
  };
}

export function createBudgeterAtlasProvider(
  entries: Array<{
    lemmaId: string;
    band: CEFRBand;
    frequencyRank?: number;
    lang?: string;
    cefrPriorSource?: AtlasLemmaEntry["cefrPriorSource"];
  }>
): LexicalAtlasProvider {
  const map = new Map<string, AtlasLemmaEntry>();

  for (const entry of entries) {
    const lang = entry.lang ?? "es";
    map.set(`${lang}:${entry.lemmaId}`, {
      lemmaId: entry.lemmaId,
      lang,
      cefrPriorBand: entry.band,
      frequencyRank: entry.frequencyRank ?? 1,
      partsOfSpeech: ["noun"],
      cefrPriorSource: entry.cefrPriorSource ?? "cefrlex"
    });
  }

  return {
    getLemma(lemmaId, lang) {
      return map.get(`${lang}:${lemmaId}`);
    },
    getBand(lemmaId, lang) {
      return map.get(`${lang}:${lemmaId}`)?.cefrPriorBand;
    },
    getFrequencyRank(lemmaId, lang) {
      return map.get(`${lang}:${lemmaId}`)?.frequencyRank ?? undefined;
    },
    listLemmasAtBand(band, lang) {
      return Array.from(map.values())
        .filter((entry) => entry.lang === lang && entry.cefrPriorBand === band)
        .map((entry) => ({ lemmaId: entry.lemmaId, lang: entry.lang }));
    },
    getGloss(lemmaId, lang, supportLang) {
      return map.get(`${lang}:${lemmaId}`)?.glosses?.[supportLang];
    },
    resolveFromGloss() {
      return [];
    },
    getAtlasVersion() {
      return "atlas-v1";
    }
  };
}
