/**
 * packages/plugins/src/catalog/sugarlang/tests/learner/test-helpers.ts
 *
 * Purpose: Shares compact fixtures for Epic 7 learner-state tests.
 *
 * Exports:
 *   - createLemmaCard
 *   - createLearnerProfile
 *   - createLearnerBlackboard
 *   - createAtlasProvider
 *   - createReducerObservationEvent
 *
 * Relationships:
 *   - Is consumed by the learner and provider tests in this directory.
 *   - Keeps test fixture duplication out of runtime modules.
 *
 * Implements: Epic 7 learner-state test support
 *
 * Status: active
 */

import {
  createRuntimeBlackboard,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type {
  AtlasLemmaEntry,
  CEFRBand,
  LearnerProfile,
  LemmaCard,
  LexicalAtlasProvider,
  ObservationEvent
} from "../../runtime/types";
import {
  createUniformCefrPosterior
} from "../../runtime/learner/cefr-posterior";
import {
  SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
} from "../../runtime/learner/fact-definitions";

export function createLemmaCard(
  lemmaId: string,
  cefrPriorBand: CEFRBand = "A1",
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
    cefrPriorBand,
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null,
    ...overrides
  };
}

export function createLearnerProfile(
  estimatedCefrBand: CEFRBand = "A1",
  overrides: Partial<LearnerProfile> = {}
): LearnerProfile {
  return {
    learnerId: "learner-epic-7" as LearnerProfile["learnerId"],
    targetLanguage: "es",
    supportLanguage: "en",
    assessment: {
      status: "unassessed",
      evaluatedCefrBand: null,
      cefrConfidence: 1 / 6,
      evaluatedAtMs: null
    },
    estimatedCefrBand,
    cefrPosterior: createUniformCefrPosterior(),
    lemmaCards: {},
    currentSession: null,
    sessionHistory: [],
    ...overrides
  };
}

export function createLearnerBlackboard(): RuntimeBlackboard {
  return createRuntimeBlackboard({
    definitions: SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
  });
}

export function createAtlasProvider(
  entries: Array<{
    lemmaId: string;
    lang?: string;
    cefrPriorBand: CEFRBand;
    frequencyRank?: number;
  }>
): LexicalAtlasProvider {
  const map = new Map<string, AtlasLemmaEntry>();
  for (const entry of entries) {
    map.set(`${entry.lang ?? "es"}:${entry.lemmaId}`, {
      lemmaId: entry.lemmaId,
      lang: entry.lang ?? "es",
      cefrPriorBand: entry.cefrPriorBand,
      frequencyRank: entry.frequencyRank ?? 1,
      partsOfSpeech: ["test"],
      cefrPriorSource: "cefrlex"
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
      return "test-atlas-v1";
    }
  };
}

export function createReducerObservationEvent(options: {
  lemmaId: string;
  kind: ObservationEvent["observation"]["kind"];
  observedAtMs?: number;
  turnId?: string;
  sessionId?: string;
  lang?: string;
  dwellMs?: number;
}): ObservationEvent {
  const observedAtMs = options.observedAtMs ?? 1000;
  const base = {
    observedAtMs
  };

  return {
    lemma: {
      lemmaId: options.lemmaId,
      lang: options.lang ?? "es"
    },
    context: {
      sessionId: options.sessionId ?? "session-1",
      turnId: options.turnId ?? "turn-1",
      sceneId: "scene-1",
      lang: options.lang ?? "es",
      conversationId: "conversation-1"
    },
    observation:
      options.kind === "rapid-advance"
        ? { ...base, kind: options.kind, dwellMs: options.dwellMs ?? 3000 }
        : options.kind === "hovered"
          ? { ...base, kind: options.kind, dwellMs: options.dwellMs }
          : options.kind === "quest-success"
            ? { ...base, kind: options.kind, objectiveNodeId: "objective-1" }
            : options.kind === "produced-typed"
              ? { ...base, kind: options.kind, inputText: "hola" }
              : options.kind === "produced-chosen"
                ? { ...base, kind: options.kind, choiceSetId: "choice-1" }
                : options.kind === "produced-incorrect"
                  ? {
                      ...base,
                      kind: options.kind,
                      attemptedForm: "ola",
                      expectedForm: "hola"
                    }
                  : { ...base, kind: options.kind }
  };
}
