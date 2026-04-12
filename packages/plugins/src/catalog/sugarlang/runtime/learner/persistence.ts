/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/persistence.ts
 *
 * Purpose: Implements learner-profile serialization plus save/load helpers that split card persistence from profile serialization.
 *
 * Exports:
 *   - PersistedLearnerProfileCore
 *   - createEmptyLearnerProfile
 *   - cloneLearnerProfile
 *   - serializeLearnerProfile
 *   - deserializeLearnerProfile
 *   - loadLearnerProfile
 *   - saveLearnerProfile
 *
 * Relationships:
 *   - Depends on the learner-profile contract, the card-store abstraction, and sugarlang-owned blackboard facts.
 *   - Is consumed by the learner reducer and BlackboardLearnerStore.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import {
  createBlackboardScope,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type {
  CEFRBand,
  LearnerId,
  LearnerProfile,
  LemmaCard
} from "../types";
import { createUniformCefrPosterior } from "./cefr-posterior";
import {
  CARD_STORE_PAGE_SIZE,
  type CardStore
} from "./card-store";
import { LEARNER_PROFILE_FACT } from "./fact-definitions";

export type PersistedLearnerProfileCore = Omit<LearnerProfile, "lemmaCards">;

interface LoadLearnerProfileOptions {
  blackboard: RuntimeBlackboard;
  playerEntityId: string;
  cardStore: CardStore;
  fallbackProfile: LearnerProfile;
}

interface SaveLearnerProfileOptions {
  blackboard: RuntimeBlackboard;
  playerEntityId: string;
  profile: LearnerProfile;
  cardStore: CardStore;
  sourceSystem: string;
  changedCards?: LemmaCard[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCefrBand(value: unknown): value is CEFRBand {
  return value === "A1" || value === "A2" || value === "B1" || value === "B2" || value === "C1" || value === "C2";
}

function cloneCard(card: LemmaCard): LemmaCard {
  return { ...card };
}

function toPersistedCore(profile: LearnerProfile): PersistedLearnerProfileCore {
  const { lemmaCards: _lemmaCards, ...core } = profile;
  return {
    ...core,
    currentSession: core.currentSession ? { ...core.currentSession } : null,
    assessment: { ...core.assessment },
    sessionHistory: core.sessionHistory.map((session) => ({ ...session })),
    cefrPosterior: Object.fromEntries(
      Object.entries(core.cefrPosterior).map(([band, weight]) => [band, { ...weight }])
    ) as LearnerProfile["cefrPosterior"]
  };
}

export function cloneLearnerProfile(profile: LearnerProfile): LearnerProfile {
  return {
    ...toPersistedCore(profile),
    lemmaCards: Object.fromEntries(
      Object.entries(profile.lemmaCards).map(([lemmaId, card]) => [lemmaId, cloneCard(card)])
    )
  };
}

export function createEmptyLearnerProfile(options: {
  learnerId: LearnerId;
  targetLanguage: string;
  supportLanguage: string;
  estimatedCefrBand?: CEFRBand;
}): LearnerProfile {
  const estimatedCefrBand = options.estimatedCefrBand ?? "A1";

  return {
    learnerId: options.learnerId,
    targetLanguage: options.targetLanguage,
    supportLanguage: options.supportLanguage,
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
    sessionHistory: []
  };
}

export function serializeLearnerProfile(profile: LearnerProfile): string {
  return JSON.stringify(toPersistedCore(profile));
}

export function deserializeLearnerProfile(json: string): LearnerProfile {
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Invalid learner profile JSON: expected object root.");
  }
  if (typeof parsed.learnerId !== "string") {
    throw new Error("Invalid learner profile JSON: missing learnerId.");
  }
  if (typeof parsed.targetLanguage !== "string" || parsed.targetLanguage.length === 0) {
    throw new Error("Invalid learner profile JSON: missing targetLanguage.");
  }
  if (typeof parsed.supportLanguage !== "string" || parsed.supportLanguage.length === 0) {
    throw new Error("Invalid learner profile JSON: missing supportLanguage.");
  }
  if (!isCefrBand(parsed.estimatedCefrBand)) {
    throw new Error("Invalid learner profile JSON: estimatedCefrBand is invalid.");
  }
  if (!isRecord(parsed.assessment)) {
    throw new Error("Invalid learner profile JSON: missing assessment.");
  }
  if (!isRecord(parsed.cefrPosterior)) {
    throw new Error("Invalid learner profile JSON: missing cefrPosterior.");
  }
  if (!Array.isArray(parsed.sessionHistory)) {
    throw new Error("Invalid learner profile JSON: sessionHistory must be an array.");
  }

  return {
    learnerId: parsed.learnerId as LearnerId,
    targetLanguage: parsed.targetLanguage,
    supportLanguage: parsed.supportLanguage,
    assessment: {
      status:
        parsed.assessment.status === "estimated" ||
        parsed.assessment.status === "evaluated"
          ? parsed.assessment.status
          : "unassessed",
      evaluatedCefrBand: isCefrBand(parsed.assessment.evaluatedCefrBand)
        ? parsed.assessment.evaluatedCefrBand
        : null,
      cefrConfidence:
        typeof parsed.assessment.cefrConfidence === "number"
          ? parsed.assessment.cefrConfidence
          : 1 / 6,
      evaluatedAtMs:
        typeof parsed.assessment.evaluatedAtMs === "number"
          ? parsed.assessment.evaluatedAtMs
          : null
    },
    estimatedCefrBand: parsed.estimatedCefrBand,
    cefrPosterior: parsed.cefrPosterior as LearnerProfile["cefrPosterior"],
    lemmaCards: {},
    currentSession: isRecord(parsed.currentSession)
      ? {
          sessionId:
            typeof parsed.currentSession.sessionId === "string"
              ? parsed.currentSession.sessionId
              : "unknown-session",
          startedAt:
            typeof parsed.currentSession.startedAt === "number"
              ? parsed.currentSession.startedAt
              : 0,
          turns:
            typeof parsed.currentSession.turns === "number" ? parsed.currentSession.turns : 0,
          avgResponseLatencyMs:
            typeof parsed.currentSession.avgResponseLatencyMs === "number"
              ? parsed.currentSession.avgResponseLatencyMs
              : 0,
          hoverRate:
            typeof parsed.currentSession.hoverRate === "number"
              ? parsed.currentSession.hoverRate
              : 0,
          retryRate:
            typeof parsed.currentSession.retryRate === "number"
              ? parsed.currentSession.retryRate
              : 0,
          fatigueScore:
            typeof parsed.currentSession.fatigueScore === "number"
              ? parsed.currentSession.fatigueScore
              : 0
        }
      : null,
    sessionHistory: parsed.sessionHistory
      .filter(isRecord)
      .map((session) => ({
        sessionId: typeof session.sessionId === "string" ? session.sessionId : "unknown-session",
        startedAt: typeof session.startedAt === "number" ? session.startedAt : 0,
        completedAt: typeof session.completedAt === "number" ? session.completedAt : 0,
        turns: typeof session.turns === "number" ? session.turns : 0
      }))
  };
}

export async function loadLearnerProfile(
  options: LoadLearnerProfileOptions
): Promise<LearnerProfile> {
  const envelope = options.blackboard.getFact(
    LEARNER_PROFILE_FACT,
    createBlackboardScope("entity", options.playerEntityId)
  );
  const baseProfile = envelope?.value
    ? cloneLearnerProfile(envelope.value)
    : cloneLearnerProfile(options.fallbackProfile);

  const lemmaCards: Record<string, LemmaCard> = {
    ...Object.fromEntries(
      Object.entries(baseProfile.lemmaCards).map(([lemmaId, card]) => [lemmaId, cloneCard(card)])
    )
  };

  let cursor: string | null = null;
  while (true) {
    const page = await options.cardStore.listPage(cursor, CARD_STORE_PAGE_SIZE);
    for (const card of page.cards) {
      lemmaCards[card.lemmaId] = cloneCard(card);
    }
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return {
    ...baseProfile,
    lemmaCards
  };
}

export async function saveLearnerProfile(
  options: SaveLearnerProfileOptions
): Promise<void> {
  const cardsToPersist = options.changedCards ?? Object.values(options.profile.lemmaCards);

  for (let index = 0; index < cardsToPersist.length; index += CARD_STORE_PAGE_SIZE) {
    await options.cardStore.bulkSet(cardsToPersist.slice(index, index + CARD_STORE_PAGE_SIZE));
  }

  options.blackboard.setFact({
    definition: LEARNER_PROFILE_FACT,
    scope: createBlackboardScope("entity", options.playerEntityId),
    value: cloneLearnerProfile(options.profile),
    sourceSystem: options.sourceSystem
  });
}
