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
 * Implements: Epic 9 teacher test support
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  LexicalAtlasProvider,
  TeacherContext,
  PedagogicalDirective
} from "../../runtime/types";
import { runtimeFact, unavailable, type Situation } from "../../runtime/situation";
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
    { lemmaId: "hola", lang: "es", cefrPriorBand: "A1", frequencyRank: 1, partsOfSpeech: ["interjection"], glosses: { en: "hello" } },
    { lemmaId: "billete", lang: "es", cefrPriorBand: "A2", frequencyRank: 15, partsOfSpeech: ["noun"], glosses: { en: "ticket" } },
    { lemmaId: "anden", lang: "es", cefrPriorBand: "B1", frequencyRank: 42, partsOfSpeech: ["noun"], glosses: { en: "platform" } },
    { lemmaId: "queso", lang: "es", cefrPriorBand: "A2", frequencyRank: 90, partsOfSpeech: ["noun"], glosses: { en: "cheese" } }
  ];
  const byId = new Map(entries.map((entry) => [`${entry.lang}:${entry.lemmaId}`, entry]));

  return {
    getLemma: (lemmaId, lang) => byId.get(`${lang}:${lemmaId}`),
    getBand: (lemmaId, lang) => byId.get(`${lang}:${lemmaId}`)?.cefrPriorBand,
    getForms: (lemmaId, lang) => byId.get(`${lang}:${lemmaId}`)?.forms,
    getFrequencyRank: (lemmaId, lang) =>
      byId.get(`${lang}:${lemmaId}`)?.frequencyRank ?? undefined,
    getGloss: (lemmaId, lang, supportLang) =>
      byId.get(`${lang}:${lemmaId}`)?.glosses?.[supportLang],
    // 090.4b: a real reverse lookup, because the fallback now resolves concepts
    // through it. Returning [] made every situation-derived slate silently
    // empty -- the stub disagreeing with the real provider is its own bug class.
    resolveFromGloss: (glossWord, lang, supportLang) =>
      entries.filter(
        (entry) =>
          entry.lang === lang &&
          entry.glosses?.[supportLang]?.toLowerCase() === glossWord.trim().toLowerCase()
      ),
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
  // 090.4: replaces the old SceneVocabularyModel `scene` fixture (deleted from
  // TeacherContext -- see contracts/providers.ts's two-doors note). Concepts
  // here resolve through the atlas fixture below the same way the deleted
  // scene's four lemmas used to: `ticket` -> billete (mustComprehend, matching
  // the old questEssentialLemmas entry), `cheese` -> queso, `hello` -> hola,
  // `platform` -> anden.
  const situation: Situation = {
    sceneId: "scene-station",
    sceneContext: runtimeFact({
      sceneId: "scene-station",
      contentHash: "scene-hash",
      promptVersion: "prompt-v1",
      supportLanguage: "en",
      prose: "A train station platform where a stationmaster sells tickets.",
      concepts: [
        {
          label: "hello",
          pos: "interjection",
          provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }]
        },
        {
          label: "ticket",
          pos: "noun",
          provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }],
          mustComprehend: true
        },
        {
          label: "platform",
          pos: "noun",
          provenance: [{ sourceId: "region:scene-station", kind: "region" }]
        },
        {
          label: "cheese",
          pos: "noun",
          provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }]
        }
      ],
      extractedAtMs: 100,
      extractedByModel: "test-model",
      reviewFlag: false
    }),
    runtime: {
      questObjectives: unavailable(),
      questStage: unavailable(),
      trackedQuest: unavailable(),
      timeOfDay: unavailable(),
      knownFacts: unavailable(),
      recentWorldEvents: unavailable()
    },
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
    // 090.4: the value the old hand-written probeFloorState carried. With 3
    // pending lemmas (oldest 7 turns) this derives to neither floor reached,
    // which is what that fixture asserted.
    turnsSinceLastProbe: 9
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
      // 090.4: was 4. The pending-provisional signal is DERIVED from
      // `turns - provisionalEvidenceFirstSeenTurn` now (learner/pacing-signals.ts)
      // rather than hand-written on the context, so the turn counter has to be
      // far enough along for the per-card ages below to be expressible.
      turns: 10,
    },
    // 090.4: THESE CARDS NOW PRODUCE THE PENDING-PROVISIONAL LIST.
    //
    // It used to be written by hand on the TeacherContext, and it DISAGREED
    // with these cards -- it listed `hola` and `queso` as pending when neither
    // card carried provisional evidence, and omitted `anden`, which did. That
    // is the stub-disagrees-with-the-real-thing bug class this fixture already
    // got bitten by once (see `resolveFromGloss` above). Deriving removes the
    // second copy; these values are what the old hand-written list claimed:
    //
    //   billete  2 units, pending 7 turns   (10 - 3)
    //   queso    1 unit,  pending 5 turns   (10 - 5)
    //   hola     1 unit,  pending 3 turns   (10 - 7)
    //   anden    not pending
    lemmaCards: {
      hola: createLemmaCard("hola", "A1", {
        retrievability: 0.9,
        reviewCount: 3,
        lastReviewedAt: 900,
        provisionalEvidence: 1,
        provisionalEvidenceFirstSeenTurn: 7
      }),
      queso: createLemmaCard("queso", "A2", {
        retrievability: 0.42,
        lapseCount: 1,
        reviewCount: 1,
        lastReviewedAt: 800,
        provisionalEvidence: 1,
        provisionalEvidenceFirstSeenTurn: 5
      }),
      billete: createLemmaCard("billete", "A2", {
        retrievability: 0.3,
        provisionalEvidence: 2,
        provisionalEvidenceFirstSeenTurn: 3,
        reviewCount: 0,
        lastReviewedAt: 700
      }),
      anden: createLemmaCard("anden", "B1", {
        retrievability: 0.2,
        lapseCount: 2,
        reviewCount: 1,
        lastReviewedAt: 600
      })
    }
  });

  return {
    conversationId: "conversation-1",
    learner,
    atlas: createTeacherAtlasProvider(),
    situation,
    lang: {
      targetLanguage: "es",
      supportLanguage: "en"
    },
    calibrationActive: false,
    ...overrides
  };
}

export function createDirectiveFixture(
  overrides: Partial<PedagogicalDirective> = {}
): PedagogicalDirective {
  return {
    targetVocab: {
      introduce: [{ kind: "vocabulary", lemmaId: "billete", lang: "es" }],
      reinforce: [{ kind: "vocabulary", lemmaId: "hola", lang: "es" }],
      avoid: [{ kind: "vocabulary", lemmaId: "anden", lang: "es" }]
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
