/**
 * packages/plugins/src/catalog/sugarlang/tests/director/test-helpers.ts
 *
 * Purpose: Shares compact fixtures for Epic 9 Director tests.
 *
 * Exports:
 *   - createDirectorContext
 *   - createDirectiveFixture
 *
 * Relationships:
 *   - Builds on learner test helpers and runtime contract types.
 *   - Is consumed by the Director prompt, parser, policy, cache, and facade tests.
 *
 * Implements: Epic 9 director test support
 *
 * Status: active
 */

import type {
  CompiledSceneLexicon,
  DirectorContext,
  LexicalPrescription,
  PedagogicalDirective
} from "../../runtime/types";
import {
  createLemmaCard,
  createLearnerProfile
} from "../learner/test-helpers";

export function createDirectorContext(
  overrides: Partial<DirectorContext> = {}
): DirectorContext {
  const scene: CompiledSceneLexicon = {
    sceneId: "scene-station",
    contentHash: "scene-hash",
    pipelineVersion: "pipeline-v1",
    atlasVersion: "atlas-v1",
    profile: "runtime-preview",
    lemmas: {
      hola: {
        lemmaId: "hola",
        cefrPriorBand: "A1",
        frequencyRank: 1,
        partsOfSpeech: ["interjection"],
        isQuestCritical: false
      },
      billete: {
        lemmaId: "billete",
        cefrPriorBand: "A2",
        frequencyRank: 15,
        partsOfSpeech: ["noun"],
        isQuestCritical: true
      },
      anden: {
        lemmaId: "anden",
        cefrPriorBand: "B1",
        frequencyRank: 42,
        partsOfSpeech: ["noun"],
        isQuestCritical: true
      },
      queso: {
        lemmaId: "queso",
        cefrPriorBand: "A2",
        frequencyRank: 90,
        partsOfSpeech: ["noun"],
        isQuestCritical: false
      }
    },
    properNouns: ["Orrin"],
    anchors: ["hola"],
    questEssentialLemmas: [
      {
        lemmaId: "billete",
        lang: "es",
        cefrBand: "A2",
        sourceQuestId: "quest-ticket",
        sourceObjectiveNodeId: "objective-ticket",
        sourceObjectiveDisplayName: "Ask for a ticket"
      }
    ]
  };

  const prescription: LexicalPrescription = {
    introduce: [
      { lemmaId: "billete", lang: "es" },
      { lemmaId: "queso", lang: "es" }
    ],
    reinforce: [{ lemmaId: "hola", lang: "es" }],
    avoid: [{ lemmaId: "anden", lang: "es" }],
    anchor: { lemmaId: "hola", lang: "es" },
    budget: {
      newItemsAllowed: 2
    },
    rationale: {
      summary: "Favor ticket-buying vocabulary.",
      candidateSetSize: 4,
      envelopeSurvivorCount: 3,
      priorityScores: [],
      reasons: ["test"]
    }
  };

  const learner = createLearnerProfile("A2", {
    assessment: {
      status: "evaluated",
      evaluatedCefrBand: "A2",
      cefrConfidence: 0.52,
      evaluatedAtMs: 100
    },
    currentSession: {
      sessionId: "session-1",
      startedAt: 100,
      turns: 4,
      avgResponseLatencyMs: 900,
      hoverRate: 0.2,
      retryRate: 0.05,
      fatigueScore: 0.15
    },
    lemmaCards: {
      hola: createLemmaCard("hola", "A1", {
        retrievability: 0.9,
        reviewCount: 3,
        lastReviewedAt: 900
      }),
      queso: createLemmaCard("queso", "A2", {
        retrievability: 0.42,
        lapseCount: 1,
        reviewCount: 1,
        lastReviewedAt: 800
      }),
      billete: createLemmaCard("billete", "A2", {
        retrievability: 0.3,
        provisionalEvidence: 2,
        reviewCount: 0,
        lastReviewedAt: 700
      }),
      anden: createLemmaCard("anden", "B1", {
        retrievability: 0.2,
        lapseCount: 2,
        provisionalEvidence: 1,
        reviewCount: 1,
        lastReviewedAt: 600
      })
    }
  });

  return {
    conversationId: "conversation-1",
    learner,
    scene,
    prescription,
    npc: {
      npcDefinitionId: "npc-orrin",
      displayName: "Orrin",
      lorePageId: "root.characters.orrin",
      metadata: {
        mood: "brisk",
        role: "stationmaster"
      }
    },
    recentTurns: [
      {
        turnId: "turn-1",
        speaker: "npc",
        text: "Hola, viajero.",
        lang: "es"
      },
      {
        turnId: "turn-2",
        speaker: "player",
        text: "Necesito ayuda.",
        lang: "es"
      }
    ],
    lang: {
      targetLanguage: "es",
      supportLanguage: "en"
    },
    calibrationActive: false,
    pendingProvisionalLemmas: [
      {
        lemmaRef: { lemmaId: "hola", lang: "es" },
        evidenceAmount: 1,
        turnsPending: 3
      },
      {
        lemmaRef: { lemmaId: "billete", lang: "es" },
        evidenceAmount: 2,
        turnsPending: 7
      },
      {
        lemmaRef: { lemmaId: "queso", lang: "es" },
        evidenceAmount: 1,
        turnsPending: 5
      }
    ],
    probeFloorState: {
      turnsSinceLastProbe: 9,
      totalPendingLemmas: 3,
      softFloorReached: false,
      hardFloorReached: false
    },
    activeQuestEssentialLemmas: [
      {
        lemmaRef: { lemmaId: "billete", lang: "es" },
        sourceObjectiveNodeId: "objective-ticket",
        sourceObjectiveDisplayName: "Ask for a ticket",
        sourceQuestId: "quest-ticket",
        cefrBand: "A2",
        supportLanguageGloss: "ticket"
      }
    ],
    selectionMetadata: {
      beat: "player asks for travel help"
    },
    ...overrides
  };
}

export function createDirectiveFixture(
  overrides: Partial<PedagogicalDirective> = {}
): PedagogicalDirective {
  return {
    targetVocab: {
      introduce: [{ lemmaId: "billete", lang: "es" }],
      reinforce: [{ lemmaId: "hola", lang: "es" }],
      avoid: [{ lemmaId: "anden", lang: "es" }]
    },
    supportPosture: "supported",
    targetLanguageRatio: 0.65,
    interactionStyle: "guided_dialogue",
    glossingStrategy: "inline",
    sentenceComplexityCap: "two-clause",
    comprehensionCheck: {
      trigger: false,
      probeStyle: "none",
      targetLemmas: []
    },
    directiveLifetime: {
      maxTurns: 3,
      invalidateOn: ["quest_stage_change", "location_change"]
    },
    citedSignals: ["test"],
    rationale: "Fixture directive.",
    confidenceBand: "medium",
    isFallbackDirective: false,
    ...overrides
  };
}
