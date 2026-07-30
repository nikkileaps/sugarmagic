/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/test-helpers.ts
 *
 * Purpose: Shares compact fixtures for Epic 9 Teacher'stests.
 *
 * Exports:
 *   - createTeacherContext
 *   - createDirectiveFixture
 *
 * Relationships:
 *   - Builds on learner test helpers and runtime contract types.
 *   - Is consumed by the Teacher prompt, parser, policy, cache, and facade tests.
 *
 * Implements: Epic 9 director test support
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  CompiledSceneLexicon,
  LexicalAtlasProvider,
  TeacherContext,
  LexicalPrescription,
  PedagogicalDirective
} from "../../runtime/types";
import {
  createLemmaCard,
  createLearnerProfile
} from "../learner/test-helpers";

/**
 * 090.2c: band / rank / POS moved out of the scene artifact into the atlas, so
 * the fixture scene above no longer carries them and the prompt reads them from
 * here. Values match what the scene entries used to declare, so prompt snapshots
 * are unchanged by the move.
 */
function createTeacherAtlasProvider(): LexicalAtlasProvider {
  const entries: AtlasLemmaEntry[] = [
    { lemmaId: "hola", lang: "es", cefrPriorBand: "A1", frequencyRank: 1, partsOfSpeech: ["interjection"] },
    { lemmaId: "billete", lang: "es", cefrPriorBand: "A2", frequencyRank: 15, partsOfSpeech: ["noun"] },
    { lemmaId: "anden", lang: "es", cefrPriorBand: "B1", frequencyRank: 42, partsOfSpeech: ["noun"] },
    { lemmaId: "queso", lang: "es", cefrPriorBand: "A2", frequencyRank: 90, partsOfSpeech: ["noun"] }
  ];
  const byId = new Map(entries.map((entry) => [`${entry.lang}:${entry.lemmaId}`, entry]));

  return {
    getLemma: (lemmaId, lang) => byId.get(`${lang}:${lemmaId}`),
    getBand: (lemmaId, lang) => byId.get(`${lang}:${lemmaId}`)?.cefrPriorBand,
    getFrequencyRank: (lemmaId, lang) =>
      byId.get(`${lang}:${lemmaId}`)?.frequencyRank ?? undefined,
    getGloss: (lemmaId, lang, supportLang) =>
      byId.get(`${lang}:${lemmaId}`)?.glosses?.[supportLang],
    resolveFromGloss: () => [],
    listLemmasAtBand: (band, lang) =>
      entries
        .filter((entry) => entry.lang === lang && entry.cefrPriorBand === band)
        .map((entry) => ({ lemmaId: entry.lemmaId, lang: entry.lang })),
    getAtlasVersion: () => "atlas-v1"
  };
}

export function createTeacherContext(
  overrides: Partial<TeacherContext> = {}
): TeacherContext {
  const scene: CompiledSceneLexicon = {
    sceneId: "scene-station",
    contentHash: "scene-hash",
    pipelineVersion: "pipeline-v1",
    atlasVersion: "atlas-v1",
    profile: "runtime-preview",
    lemmas: {
      hola: {
        lemmaId: "hola",
        isQuestCritical: false,
        sceneWeight: 1,
        npcSourceIds: []
      },
      billete: {
        lemmaId: "billete",
        isQuestCritical: true,
        sceneWeight: 1,
        npcSourceIds: []
      },
      anden: {
        lemmaId: "anden",
        isQuestCritical: true,
        sceneWeight: 1,
        npcSourceIds: []
      },
      queso: {
        lemmaId: "queso",
        isQuestCritical: false,
        sceneWeight: 1,
        npcSourceIds: []
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
      probeFailRate: 0.05,
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
    atlas: createTeacherAtlasProvider(),
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
