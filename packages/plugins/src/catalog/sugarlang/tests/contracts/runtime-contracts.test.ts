/**
 * packages/plugins/src/catalog/sugarlang/tests/contracts/runtime-contracts.test.ts
 *
 * Purpose: Verifies the public sugarlang runtime contract surface and type-level invariants.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/types as the single public import surface.
 *   - Guards Epic 3's contract stability before later implementation epics land.
 *
 * Implements: Epic 3 type-level and invariant tests
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  INITIAL_PRODUCTIVE_STRENGTH,
  INITIAL_PROVISIONAL_EVIDENCE,
  PROVISIONAL_EVIDENCE_MAX,
  type ActiveQuestEssentialLemma,
  type AtlasLemmaEntry,
  type CEFRBand,
  type CefrPosterior,
  type CompiledSceneLexicon,
  type ComprehensionCheckSpec,
  type CoverageProfile,
  type TeacherContext,
  type TeacherPolicy,
  type EnvelopeVerdict,
  type FSRSGrade,
  type LearnerPriorProvider,
  type LearnerProfile,
  type LemmaCard,
  type LexicalAtlasProvider,
  type LexicalChunk,
  type LexicalPrescription,
  type ObservationKind,
  type ObservationOutcome,
  type PedagogicalDirective,
  type PlacementAnswer,
  type PlacementQuestionnaire,
  type PlacementQuestionnaireQuestion,
  type PlacementQuestionnaireResponse,
  type PlacementScoreResult,
  type ProbeFloorState,
  type ProbeTriggerReason,
  type ProducedObservationKind,
  type QuestEssentialLemma,
  type SceneLemmaInfo,
  type SugarlangConstraint
} from "../../runtime/types";

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function mapObservationKind(kind: ObservationKind): ObservationOutcome {
  switch (kind) {
    case "encountered":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: 0
      };
    case "rapid-advance":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: 0.2
      };
    case "hovered":
      return {
        receptiveGrade: "Hard",
        productiveStrengthDelta: -0.05,
        provisionalEvidenceDelta: 0
      };
    case "quest-success":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: 0,
        provisionalEvidenceDelta: 0
      };
    case "produced-typed":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: 0.3,
        provisionalEvidenceDelta: 0
      };
    case "produced-chosen":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: 0.15,
        provisionalEvidenceDelta: 0
      };
    case "produced-unprompted":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: 0.5,
        provisionalEvidenceDelta: 0
      };
    case "produced-incorrect":
      return {
        receptiveGrade: "Again",
        productiveStrengthDelta: -0.2,
        provisionalEvidenceDelta: 0
      };
    default:
      return assertNever(kind);
  }
}

function describePlacementQuestion(question: PlacementQuestionnaireQuestion): string {
  switch (question.kind) {
    case "multiple-choice":
      return question.options.map((option) => option.optionId).join(",");
    case "free-text":
      return question.expectedLemmas.join(",");
    case "yes-no":
      return question.correctAnswer;
    case "fill-in-blank":
      return question.acceptableAnswers.join(",");
    default:
      return assertNever(question);
  }
}

function describePlacementAnswer(answer: PlacementAnswer): string {
  switch (answer.kind) {
    case "multiple-choice":
      return answer.optionId;
    case "free-text":
      return answer.text;
    case "yes-no":
      return answer.answer;
    case "fill-in-blank":
      return answer.text;
    case "skipped":
      return "skipped";
    default:
      return assertNever(answer);
  }
}

describe("sugarlang runtime contracts", () => {
  it("exports learner-state invariant constants with the agreed defaults", () => {
    expect(INITIAL_PRODUCTIVE_STRENGTH).toBe(0);
    expect(INITIAL_PROVISIONAL_EVIDENCE).toBe(0);
    expect(PROVISIONAL_EVIDENCE_MAX).toBe(5);
  });

  it("accepts the full pedagogical directive and constraint shapes", () => {
    const directive: PedagogicalDirective = {
      targetVocab: {
        introduce: [{ lemmaId: "hola", lang: "es" }],
        reinforce: [{ lemmaId: "tren", lang: "es" }],
        avoid: [{ lemmaId: "ferrocarril", lang: "es" }]
      },
      supportPosture: "supported",
      targetLanguageRatio: 0.7,
      interactionStyle: "elicitation_mode",
      glossingStrategy: "parenthetical",
      sentenceComplexityCap: "two-clause",
      comprehensionCheck: {
        trigger: true,
        probeStyle: "recognition",
        targetLemmas: [{ lemmaId: "hola", lang: "es" }],
        triggerReason: "soft-floor",
        characterVoiceReminder: "Warm stationmaster cadence",
        acceptableResponseForms: "short-phrase"
      },
      directiveLifetime: {
        maxTurns: 2,
        invalidateOn: ["quest_stage_change", "location_change"]
      },
      citedSignals: ["pending-provisional", "quest-essential"],
      rationale: "Keep it supportive while eliciting one known gap word.",
      confidenceBand: "medium",
      isFallbackDirective: false
    };

    const constraint: SugarlangConstraint = {
      targetVocab: directive.targetVocab,
      supportPosture: directive.supportPosture,
      targetLanguageRatio: directive.targetLanguageRatio,
      interactionStyle: directive.interactionStyle,
      glossingStrategy: directive.glossingStrategy,
      sentenceComplexityCap: directive.sentenceComplexityCap,
      targetLanguage: "es",
      learnerCefr: "A2",
      comprehensionCheckInFlight: {
        active: true,
        probeStyle: "recognition",
        targetLemmas: [{ lemmaId: "hola", lang: "es" }],
        characterVoiceReminder: "Warm stationmaster cadence",
        triggerReason: "soft-floor"
      },
      questEssentialLemmas: [
        {
          lemmaRef: { lemmaId: "billete", lang: "es" },
          sourceObjectiveDisplayName: "Ask for a ticket",
          supportLanguageGloss: "ticket"
        }
      ],
      prePlacementOpeningLine: {
        text: "Welcome to Wordlark Hollow.",
        lang: "en",
        lineId: "opening-1"
      },
      rawPrescription: {
        introduce: [],
        reinforce: [],
        avoid: [],
        budget: { newItemsAllowed: 0 },
        rationale: {
          candidateSetSize: 0,
          envelopeSurvivorCount: 0,
          priorityScores: [],
          reasons: []
        }
      }
    };

    const probe: ComprehensionCheckSpec = {
      trigger: true,
      probeStyle: "recognition",
      targetLemmas: [{ lemmaId: "hola", lang: "es" }],
      triggerReason: "soft-floor",
      characterVoiceReminder: "Warm stationmaster cadence",
      acceptableResponseForms: "short-phrase"
    };

    expect(directive.comprehensionCheck).toEqual(probe);
    expect(constraint.comprehensionCheckInFlight?.active).toBe(true);
  });

  it("accepts learner, prescription, classifier, scene, provider, and placement fixtures", () => {
    const posterior: CefrPosterior = {
      A1: { alpha: 1, beta: 1 },
      A2: { alpha: 1, beta: 1 },
      B1: { alpha: 1, beta: 1 },
      B2: { alpha: 1, beta: 1 },
      C1: { alpha: 1, beta: 1 },
      C2: { alpha: 1, beta: 1 }
    };
    const card: LemmaCard = {
      lemmaId: "hola",
      difficulty: 1,
      stability: 2,
      retrievability: 0.8,
      lastReviewedAt: null,
      reviewCount: 0,
      lapseCount: 0,
      cefrPriorBand: "A1",
      priorWeight: 1,
      productiveStrength: 0,
      lastProducedAtMs: null,
      provisionalEvidence: 0,
      provisionalEvidenceFirstSeenTurn: null
    };
    const learner: LearnerProfile = {
      learnerId: "learner-1" as LearnerProfile["learnerId"],
      targetLanguage: "es",
      supportLanguage: "en",
      assessment: {
        status: "estimated",
        evaluatedCefrBand: null,
        cefrConfidence: 0.4,
        evaluatedAtMs: null
      },
      estimatedCefrBand: "A2",
      cefrPosterior: posterior,
      lemmaCards: { hola: card },
      currentSession: null,
      sessionHistory: []
    };
    const prescription: LexicalPrescription = {
      introduce: [{ lemmaId: "hola", lang: "es" }],
      reinforce: [{ lemmaId: "tren", lang: "es" }],
      avoid: [{ lemmaId: "ferrocarril", lang: "es" }],
      anchor: { lemmaId: "estacion", lang: "es" },
      budget: { newItemsAllowed: 1, turnSeconds: 20 },
      rationale: {
        summary: "One new station word, one due review.",
        candidateSetSize: 20,
        envelopeSurvivorCount: 14,
        priorityScores: [
          {
            lemmaRef: { lemmaId: "hola", lang: "es" },
            score: 0.9,
            reasons: ["scene-anchor", "new-item-slot"]
          }
        ],
        reasons: ["one anchor selected"],
        questEssentialExclusionLemmaIds: ["billete"]
      }
    };
    const chunk: LexicalChunk = {
      chunkId: "chunk-1",
      normalizedForm: "de_vez_en_cuando",
      surfaceForms: ["de vez en cuando"],
      cefrBand: "A2",
      constituentLemmas: ["de", "vez", "cuando"],
      extractedByModel: "claude-sonnet-4-6",
      extractedAtMs: 1,
      extractorPromptVersion: "v1",
      source: "llm-extracted"
    };
    const sceneLemma: SceneLemmaInfo = {
      lemmaId: "hola",
      cefrPriorBand: "A1",
      frequencyRank: 10,
      partsOfSpeech: ["interjection"],
      isQuestCritical: false
    };
    const questEssential: QuestEssentialLemma = {
      lemmaId: "billete",
      lang: "es",
      cefrBand: "B1",
      sourceQuestId: "quest-1",
      sourceObjectiveNodeId: "objective-1",
      sourceObjectiveDisplayName: "Ask for a ticket"
    };
    const lexicon: CompiledSceneLexicon = {
      sceneId: "scene-1",
      contentHash: "hash-1",
      pipelineVersion: "pipeline-1",
      atlasVersion: "atlas-1",
      profile: "authoring-preview",
      lemmas: { hola: sceneLemma },
      properNouns: ["Orrin"],
      anchors: ["hola"],
      questEssentialLemmas: [questEssential],
      sources: {
        hola: [
          {
            file: "npc.json",
            lineStart: 1,
            lineEnd: 1,
            snippet: "hola"
          }
        ]
      },
      diagnostics: [
        {
          severity: "warning",
          message: "Low-frequency lemma",
          sceneId: "scene-1",
          lemmaId: "hola",
          suggestion: "Consider a gloss"
        }
      ],
      chunks: [chunk]
    };
    const coverage: CoverageProfile = {
      totalTokens: 10,
      knownTokens: 7,
      inBandTokens: 2,
      unknownTokens: 1,
      bandHistogram: {
        A1: 5,
        A2: 2,
        B1: 1,
        B2: 1,
        C1: 1,
        C2: 0
      },
      outOfEnvelopeLemmas: [{ lemmaId: "ferrocarril", lang: "es" }],
      ceilingExceededLemmas: [{ lemmaId: "ferrocarril", lang: "es" }],
      questEssentialLemmasMatched: ["billete"],
      matchedChunks: [chunk],
      matchedChunkTokens: [
        {
          chunkId: chunk.chunkId,
          normalizedForm: chunk.normalizedForm,
          surfaceMatched: chunk.surfaceForms[0]!,
          start: 0,
          end: 18,
          cefrBand: chunk.cefrBand,
          constituentLemmaIds: [...chunk.constituentLemmas]
        }
      ],
      coverageRatio: 0.9
    };
    const verdict: EnvelopeVerdict = {
      withinEnvelope: false,
      profile: coverage,
      worstViolation: {
        lemmaRef: { lemmaId: "ferrocarril", lang: "es" },
        surfaceForm: "ferrocarril",
        cefrBand: "B2",
        reason: "above learner band ceiling"
      },
      rule: "coverage>=0.95 && i+1 ceiling",
      violations: [],
      exemptionsApplied: ["quest-essential"]
    };
    const pendingLemma: ActiveQuestEssentialLemma = {
      lemmaRef: { lemmaId: "billete", lang: "es" },
      sourceObjectiveNodeId: "objective-1",
      sourceObjectiveDisplayName: "Ask for a ticket",
      sourceQuestId: "quest-1",
      cefrBand: "B1",
      supportLanguageGloss: "ticket"
    };
    const probeFloorState: ProbeFloorState = {
      turnsSinceLastProbe: 16,
      totalPendingLemmas: 5,
      softFloorReached: true,
      hardFloorReached: false
    };
    const teacherContext: TeacherContext = {
      conversationId: "conversation-1",
      learner,
      prescription,
      scene: lexicon,
      npc: {
        npcDefinitionId: "npc-orinn",
        displayName: "Orrin",
        lorePageId: "root.characters.orinn",
        metadata: { sugarlangRole: "placement" }
      },
      recentTurns: [
        {
          turnId: "turn-1",
          speaker: "npc",
          text: "Hola, viajero.",
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
        }
      ],
      probeFloorState,
      activeQuestEssentialLemmas: [pendingLemma],
      selectionMetadata: { sugarlangRole: "placement" }
    };
    const atlas: LexicalAtlasProvider = {
      getLemma: () =>
        ({
          lemmaId: "hola",
          lang: "es",
          cefrPriorBand: "A1",
          frequencyRank: 10,
          partsOfSpeech: ["interjection"]
        }) satisfies AtlasLemmaEntry,
      getBand: () => "A1",
      getFrequencyRank: () => 10,
      getGloss: () => undefined,
      resolveFromGloss: () => [],
      listLemmasAtBand: () => [{ lemmaId: "hola", lang: "es" }],
      getAtlasVersion: () => "atlas-1"
    };
    const priorProvider: LearnerPriorProvider = {
      getInitialLemmaCard: () => card,
      getCefrInitialPosterior: () => posterior
    };
    const teacherPolicy: TeacherPolicy = {
      invoke: async () => ({
        targetVocab: prescription,
        supportPosture: "supported",
        targetLanguageRatio: 0.7,
        interactionStyle: "natural_dialogue",
        glossingStrategy: "inline",
        sentenceComplexityCap: "two-clause",
        comprehensionCheck: {
          trigger: false,
          probeStyle: "none",
          targetLemmas: []
        },
        directiveLifetime: {
          maxTurns: 2,
          invalidateOn: []
        },
        citedSignals: ["seed"],
        rationale: "default",
        confidenceBand: "high",
        isFallbackDirective: false
      })
    };
    const questionnaire: PlacementQuestionnaire = {
      schemaVersion: 1,
      lang: "es",
      targetLanguage: "es",
      supportLanguage: "en",
      formTitle: "Arrival Form",
      formIntro: "Fill in what you can.",
      minAnswersForValid: 2,
      questions: [
        {
          kind: "multiple-choice",
          questionId: "q1",
          targetBand: "A1",
          promptText: "¿Cómo te llamas?",
          options: [
            { optionId: "a", text: "Me llamo Sam", isCorrect: true },
            { optionId: "b", text: "Tengo tren", isCorrect: false }
          ]
        },
        {
          kind: "free-text",
          questionId: "q2",
          targetBand: "A2",
          promptText: "Describe tu trabajo.",
          expectedLemmas: ["trabajar"]
        },
        {
          kind: "yes-no",
          questionId: "q3",
          targetBand: "A1",
          promptText: "¿Te gusta el queso?",
          correctAnswer: "yes",
          yesLabel: "sí",
          noLabel: "no"
        },
        {
          kind: "fill-in-blank",
          questionId: "q4",
          targetBand: "A1",
          promptText: "Completa la frase.",
          sentenceTemplate: "Me ___ Sam",
          acceptableAnswers: ["llamo"],
          acceptableLemmas: ["llamar"]
        }
      ]
    };
    const response: PlacementQuestionnaireResponse = {
      questionnaireId: "placement-es-v1",
      submittedAtMs: 1,
      answers: {
        q1: { kind: "multiple-choice", optionId: "a" },
        q2: { kind: "free-text", text: "Trabajo en la estacion." },
        q3: { kind: "yes-no", answer: "yes" },
        q4: { kind: "fill-in-blank", text: "llamo" },
        q5: { kind: "skipped" }
      }
    };
    const scoreResult: PlacementScoreResult = {
      cefrBand: "A2",
      confidence: 0.8,
      perBandScores: {
        A1: { correct: 2, total: 2 },
        A2: { correct: 1, total: 1 },
        B1: { correct: 0, total: 0 },
        B2: { correct: 0, total: 0 },
        C1: { correct: 0, total: 0 },
        C2: { correct: 0, total: 0 }
      },
      lemmasSeededFromFreeText: [{ lemmaId: "trabajar", lang: "es" }],
      skippedCount: 1,
      totalCount: 5,
      scoredAtMs: 2,
      questionnaireVersion: "placement-es-v1"
    };

    expect(verdict.withinEnvelope).toBe(false);
    expect(teacherContext.probeFloorState.softFloorReached).toBe(true);
    expect(atlas.getAtlasVersion("es")).toBe("atlas-1");
    expect(priorProvider.getCefrInitialPosterior("A2").A2.alpha).toBe(1);
    expectTypeOf(teacherPolicy.invoke(teacherContext)).toEqualTypeOf<
      Promise<PedagogicalDirective>
    >();
    expectTypeOf(lexicon.profile).toEqualTypeOf<RuntimeCompileProfile>();
    expect(describePlacementQuestion(questionnaire.questions[0]!)).toBe("a,b");
    expect(describePlacementAnswer(response.answers.q5!)).toBe("skipped");
    expect(scoreResult.perBandScores.A2.correct).toBe(1);
    expect(mapObservationKind("produced-typed").receptiveGrade).toBe("Easy");
  });

  it("keeps helper unions and import-surface aliases exact", () => {
    expectTypeOf<ProducedObservationKind>().toEqualTypeOf<
      | "produced-typed"
      | "produced-chosen"
      | "produced-unprompted"
      | "produced-incorrect"
    >();
    expectTypeOf<CompiledSceneLexicon["profile"]>().toEqualTypeOf<RuntimeCompileProfile>();
    expectTypeOf<PlacementScoreResult["perBandScores"]>().toEqualTypeOf<
      Record<CEFRBand, { correct: number; total: number }>
    >();
    expectTypeOf<ProbeTriggerReason>().toEqualTypeOf<
      | "director-discretion"
      | "soft-floor"
      | "hard-floor-turns"
      | "hard-floor-lemma-age"
      | "director-deferred-override"
    >();
    expectTypeOf<FSRSGrade>().toEqualTypeOf<"Again" | "Hard" | "Good" | "Easy">();
  });
});

// Missing required directive fields must fail.
// @ts-expect-error missing rationale
const invalidDirective: PedagogicalDirective = {
  targetVocab: { introduce: [], reinforce: [], avoid: [] },
  supportPosture: "supported",
  targetLanguageRatio: 0.5,
  interactionStyle: "natural_dialogue",
  glossingStrategy: "inline",
  sentenceComplexityCap: "free",
  comprehensionCheck: {
    trigger: false,
    probeStyle: "none",
    targetLemmas: []
  },
  directiveLifetime: { maxTurns: 1, invalidateOn: [] },
  citedSignals: [],
  confidenceBand: "high",
  isFallbackDirective: false
};
void invalidDirective;

// Optional comprehensionCheckInFlight can be omitted.
const noProbeConstraint: SugarlangConstraint = {
  targetVocab: { introduce: [], reinforce: [], avoid: [] },
  supportPosture: "supported",
  targetLanguageRatio: 0.5,
  interactionStyle: "natural_dialogue",
  glossingStrategy: "inline",
  sentenceComplexityCap: "free",
  targetLanguage: "es",
  learnerCefr: "A1",
  rawPrescription: {
    introduce: [],
    reinforce: [],
    avoid: [],
    budget: { newItemsAllowed: 0 },
    rationale: {
      candidateSetSize: 0,
      envelopeSurvivorCount: 0,
      priorityScores: [],
      reasons: []
    }
  }
};
void noProbeConstraint;

// Pending provisional fields must remain required.
// @ts-expect-error missing evidenceAmount
const invalidPendingProvisional: TeacherContext["pendingProvisionalLemmas"][number] = {
  lemmaRef: { lemmaId: "hola", lang: "es" },
  turnsPending: 1
};
void invalidPendingProvisional;

// CefrPosterior must include every CEFR band.
// @ts-expect-error missing C2
const invalidPosterior: CefrPosterior = {
  A1: { alpha: 1, beta: 1 },
  A2: { alpha: 1, beta: 1 },
  B1: { alpha: 1, beta: 1 },
  B2: { alpha: 1, beta: 1 },
  C1: { alpha: 1, beta: 1 }
};
void invalidPosterior;

// LemmaCard requires productiveStrength.
// @ts-expect-error missing productiveStrength
const invalidLemmaCard: LemmaCard = {
  lemmaId: "hola",
  difficulty: 1,
  stability: 1,
  retrievability: 1,
  lastReviewedAt: null,
  reviewCount: 0,
  lapseCount: 0,
  cefrPriorBand: "A1",
  priorWeight: 1,
  lastProducedAtMs: null,
  provisionalEvidence: 0,
  provisionalEvidenceFirstSeenTurn: null
};
void invalidLemmaCard;

// LemmaCard requires provisionalEvidence.
// @ts-expect-error missing provisionalEvidence
const invalidProvisionalCard: LemmaCard = {
  lemmaId: "hola",
  difficulty: 1,
  stability: 1,
  retrievability: 1,
  lastReviewedAt: null,
  reviewCount: 0,
  lapseCount: 0,
  cefrPriorBand: "A1",
  priorWeight: 1,
  productiveStrength: 0,
  lastProducedAtMs: null,
  provisionalEvidenceFirstSeenTurn: null
};
void invalidProvisionalCard;

// Hovered observation may omit dwellMs.
mapObservationKind("hovered");

// Quest-essential lemmas are required on the compiled scene lexicon.
// @ts-expect-error missing questEssentialLemmas
const invalidLexicon: CompiledSceneLexicon = {
  sceneId: "scene-1",
  contentHash: "hash",
  pipelineVersion: "pipeline",
  atlasVersion: "atlas",
  profile: "runtime-preview",
  lemmas: {},
  properNouns: [],
  anchors: []
};
void invalidLexicon;

const lexiconWithoutChunks: CompiledSceneLexicon = {
  sceneId: "scene-2",
  contentHash: "hash-2",
  pipelineVersion: "pipeline",
  atlasVersion: "atlas",
  profile: "runtime-preview",
  lemmas: {},
  properNouns: [],
  anchors: [],
  questEssentialLemmas: []
};
void lexiconWithoutChunks;

const lexiconWithEmptyChunks: CompiledSceneLexicon = {
  ...lexiconWithoutChunks,
  chunks: []
};
void lexiconWithEmptyChunks;

const lexiconWithChunks: CompiledSceneLexicon = {
  ...lexiconWithoutChunks,
  chunks: [
    {
      chunkId: "chunk-1",
      normalizedForm: "de_vez_en_cuando",
      surfaceForms: ["de vez en cuando"],
      cefrBand: "A2",
      constituentLemmas: ["de", "vez", "cuando"],
      extractedByModel: "claude-sonnet-4-6",
      extractedAtMs: 1,
      extractorPromptVersion: "v1",
      source: "llm-extracted"
    }
  ]
};
void lexiconWithChunks;

// Quest-essential lemma sourceObjectiveNodeId stays required and structurally distinct from SceneLemmaInfo.
// @ts-expect-error missing sourceObjectiveNodeId
const invalidActiveQuestLemma: ActiveQuestEssentialLemma = {
  lemmaRef: { lemmaId: "billete", lang: "es" },
  sourceObjectiveDisplayName: "Ask for a ticket",
  sourceQuestId: "quest-1",
  supportLanguageGloss: "ticket",
  cefrBand: "B1"
};
void invalidActiveQuestLemma;

if (false) {
  const activeQuestLemma = null as unknown as ActiveQuestEssentialLemma;
  // @ts-expect-error ActiveQuestEssentialLemma is not assignable to SceneLemmaInfo
  const sceneLemmaFromActive: SceneLemmaInfo = activeQuestLemma;
  void sceneLemmaFromActive;
}

// Questionnaire score records must include all CEFR bands.
if (false) {
  const requirePerBandScores = (_scores: PlacementScoreResult["perBandScores"]) =>
    _scores;
  // @ts-expect-error missing C2
  const invalidPerBandScores = requirePerBandScores({
    A1: { correct: 1, total: 1 },
    A2: { correct: 0, total: 0 },
    B1: { correct: 0, total: 0 },
    B2: { correct: 0, total: 0 },
    C1: { correct: 0, total: 0 }
  });
  void invalidPerBandScores;
}
