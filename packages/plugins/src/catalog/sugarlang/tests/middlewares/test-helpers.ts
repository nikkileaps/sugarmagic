/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/test-helpers.ts
 *
 * Purpose: Provides shared builders for Sugarlang middleware tests.
 *
 * Exports:
 *   - createTestLearnerProfile
 *   - createTestExecution
 *   - createTestTurn
 *   - createServicesStub
 *   - createEmptyPrescription
 *   - createBaseConstraint
 *
 * Relationships:
 *   - Depends on runtime-core execution contracts and sugarlang runtime types.
 *   - Is consumed by the Epic 10 middleware tests to keep fixtures consistent.
 *
 * Implements: Epic 10 middleware verification support
 *
 * Status: active
 */

import type {
  ConversationExecutionContext,
  ConversationTurnEnvelope
} from "@sugarmagic/runtime-core";
import type {
  CefrPosterior,
  LearnerProfile,
  SugarlangConstraint
} from "../../runtime/types";

function createPosterior(): CefrPosterior {
  return {
    A1: { alpha: 4, beta: 1 },
    A2: { alpha: 2, beta: 2 },
    B1: { alpha: 1, beta: 3 },
    B2: { alpha: 1, beta: 4 },
    C1: { alpha: 1, beta: 5 },
    C2: { alpha: 1, beta: 6 }
  };
}

export function createTestLearnerProfile(
  overrides: Partial<LearnerProfile> = {}
): LearnerProfile {
  return {
    learnerId: "learner:es:en" as LearnerProfile["learnerId"],
    targetLanguage: "es",
    supportLanguage: "en",
    assessment: {
      status: "estimated",
      evaluatedCefrBand: null,
      cefrConfidence: 0.72,
      evaluatedAtMs: null
    },
    estimatedCefrBand: "A2",
    cefrPosterior: createPosterior(),
    lemmaCards: {},
    currentSession: {
      sessionId: "session-1",
      startedAt: 1,
      turns: 2,
      avgResponseLatencyMs: 500,
      hoverRate: 0,
      retryRate: 0,
      fatigueScore: 0
    },
    sessionHistory: [],
    ...overrides
  };
}

export function createEmptyPrescription() {
  return {
    introduce: [],
    reinforce: [],
    avoid: [],
    budget: {
      newItemsAllowed: 0
    },
    rationale: {
      candidateSetSize: 0,
      envelopeSurvivorCount: 0,
      priorityScores: [],
      reasons: [],
      summary: "test"
    }
  };
}

export function createBaseConstraint(
  overrides: Partial<SugarlangConstraint> = {}
): SugarlangConstraint {
  return {
    targetVocab: {
      introduce: [],
      reinforce: [],
      avoid: []
    },
    supportPosture: "supported",
    targetLanguageRatio: 0.65,
    interactionStyle: "guided_dialogue",
    glossingStrategy: "inline",
    sentenceComplexityCap: "two-clause",
    targetLanguage: "es",
    learnerCefr: "A2",
    rawPrescription: createEmptyPrescription(),
    ...overrides
  };
}

export function createTestExecution(
  overrides: Partial<ConversationExecutionContext> = {}
): ConversationExecutionContext {
  return {
    selection: {
      conversationKind: "free-form",
      npcDefinitionId: "npc-1",
      npcDisplayName: "Marisol",
      interactionMode: "agent",
      targetLanguage: "es",
      supportLanguage: "en",
      metadata: {}
    },
    input: null,
    state: {
      "sugaragent.session": {
        sessionId: "session-1",
        turnCount: 1,
        history: []
      }
    },
    annotations: {},
    runtimeContext: {
      here: {
        regionId: "region-1",
        regionDisplayName: "Region",
        regionLorePageId: null,
        sceneId: "scene-1",
        sceneDisplayName: "Scene",
        area: null,
        parentArea: null
      },
      playerLocation: null,
      playerPosition: null,
      playerArea: null,
      npcLocation: null,
      npcPosition: null,
      npcArea: null,
      npcPlayerRelation: null,
      npcBehavior: null,
      trackedQuest: null,
      activeQuestStage: null,
      activeQuestObjectives: null
    },
    ...overrides
  };
}

export function createTestTurn(
  text = "Hola."
): ConversationTurnEnvelope {
  return {
    turnId: "turn-1",
    providerId: "sugaragent.provider",
    conversationKind: "free-form",
    speakerId: "npc-1",
    speakerLabel: "Marisol",
    text,
    choices: [],
    inputMode: "advance",
    annotations: {},
    diagnostics: {}
  };
}

export function createServicesStub(overrides: Record<string, unknown> = {}) {
  return {
    resolveForExecution: () => null,
    getBlackboard: () => null,
    getConfig: () => ({
      debugLogging: false,
      placement: {
        enabled: true,
        minAnswersForValid: "use-bank-default" as const,
        confidenceFloor: 0.3,
        openingDialogTurns: 2,
        closingDialogTurns: 2
      }
    }),
    findNpcDefinition: () => null,
    ...overrides
  };
}
