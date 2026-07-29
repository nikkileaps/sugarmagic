/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-observe-middleware.test.ts
 *
 * Purpose: Verifies probe-response handling and reducer routing in the Sugarlang observe middleware.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-observe-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.5
 *
 * Status: active
 */

import { PLAYER_SPEAKER, PLAYER_VO_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it, vi } from "vitest";
import { createSugarLangObserveMiddleware } from "../../runtime/middlewares/sugar-lang-observe-middleware";
import {
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE,
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  computePendingProvisionalLemmas
} from "../../runtime/middlewares/shared";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

// Minimal scene lexicon with a single chunk (buenos_dias) for chunk-observation tests.
const BUENOS_DIAS_CHUNK = {
  chunkId: "buenos_dias",
  normalizedForm: "buenos_dias",
  surfaceForms: ["buenos dias", "buenos días"],
  cefrBand: "A1" as const,
  constituentLemmas: ["bueno", "dia"],
  extractedByModel: "test",
  extractedAtMs: 1,
  extractorPromptVersion: "1",
  source: "llm-extracted" as const
};

function makeSceneLexiconStoreWith(chunks: typeof BUENOS_DIAS_CHUNK[]) {
  return {
    ensure: vi.fn().mockResolvedValue({
      sceneId: "scene-1",
      contentHash: "hash-1",
      chunks
    }),
    get: () => undefined
  };
}

describe("SugarLangObserveMiddleware", () => {
  it("bypasses observation for player voice-over turns", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const middleware = createSugarLangObserveMiddleware({
      services: createServicesStub({
        getPlayerDefinitionId: () => "player-1",
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          learnerStateReducer: {
            apply
          }
        })
      }) as never
    });
    const execution = createTestExecution({
      input: {
        kind: "free_text",
        text: "carta"
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = {
      ...createTestTurn("I can't believe I'm here."),
      speakerId: PLAYER_VO_SPEAKER.speakerId,
      speakerLabel: PLAYER_VO_SPEAKER.displayName
    };

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(apply).not.toHaveBeenCalled();
  });

  it("commits provisional evidence when the player answers a stored probe with the target lemma", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: {
          apply
        }
      })
    });
    const middleware = createSugarLangObserveMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      input: {
        kind: "free_text",
        text: "carta"
      }
    });
    execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE] = {
      targetLemmas: [{ lemmaId: "carta", lang: "es" }],
      probeStyle: "recognition",
      characterVoiceReminder: "Stay in character.",
      triggerReason: "soft-floor"
    };
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Aqui tienes la carta."));

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "commit-provisional-evidence",
        targetLemmas: [{ lemmaId: "carta", lang: "es" }]
      })
    );
    expect(
      execution.state[SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE]
    ).toBeUndefined();
  });

  it("applies placement completion and emits quest proposals on questionnaire submission", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: {
          apply
        }
      })
    });
    const middleware = createSugarLangObserveMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      input: {
        kind: "quest_form",
        response: {
          questionnaireId: "es-placement-v1",
          submittedAtMs: 1234,
          answers: {}
        }
      }
    });
    execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION] = {
      phase: "closing-dialog",
      questionnaireVersion: "es-placement-v1",
      scoreResult: {
        cefrBand: "A2",
        confidence: 0.72,
        perBandScores: {
          A1: { correct: 2, total: 2 },
          A2: { correct: 2, total: 2 },
          B1: { correct: 0, total: 0 },
          B2: { correct: 0, total: 0 },
          C1: { correct: 0, total: 0 },
          C2: { correct: 0, total: 0 }
        },
        lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }],
        skippedCount: 1,
        totalCount: 6,
        scoredAtMs: 1234,
        questionnaireVersion: "es-placement-v1"
      }
    };

    const finalized = await middleware.finalize?.(
      execution,
      createTestTurn("Perfecto. Ya tengo tu formulario.")
    );

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "placement-completion",
        cefrBand: "A2",
        lemmasSeededFromFreeText: [{ lemmaId: "viajar", lang: "es" }]
      })
    );
    expect(finalized?.proposedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "set-conversation-flag",
          key: "sugarlang.placement.status",
          value: "completed"
        }),
        expect.objectContaining({
          kind: "notify-quest-event",
          eventName: "sugarlang.placement.completed"
        })
      ])
    );
  });

  it("085.3: emits chunk-encountered when NPC turn text contains a chunk", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Buenos dias viajero!"));

    const chunkObs = (apply.mock.calls as Array<[{ type: string; observationEvent?: { lemma: { lemmaId: string }; observation: { kind: string } } }]>).find(
      ([event]) =>
        event.type === "observation" &&
        event.observationEvent?.observation.kind === "chunk-encountered"
    );
    expect(chunkObs).toBeDefined();
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("chunk:buenos_dias");
  });

  it("085.3: emits chunk-produced when player free-text input contains a chunk", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution({
      input: { kind: "free_text", text: "buenos dias!" }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Hola! Como estas?"));

    const chunkObs = (apply.mock.calls as Array<[{ type: string; observationEvent?: { lemma: { lemmaId: string }; observation: { kind: string } } }]>).find(
      ([event]) =>
        event.type === "observation" &&
        event.observationEvent?.observation.kind === "chunk-produced"
    );
    expect(chunkObs).toBeDefined();
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("chunk:buenos_dias");
  });

  it("085.3: emits chunk-produced for player-spoken scripted line containing a chunk", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      getPlayerDefinitionId: () => "player-1",
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution({
      // scripted input kind -- not free_text
      input: null
    });
    execution.selection = { ...execution.selection, conversationKind: "scripted-dialogue" as never };
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    // A player-spoken scripted line that contains the chunk.
    const playerTurn = {
      ...createTestTurn("Buenos dias a todos!"),
      speakerId: PLAYER_SPEAKER.speakerId,
      speakerLabel: PLAYER_SPEAKER.displayName
    };

    await middleware.finalize?.(execution, playerTurn);

    const chunkObs = (apply.mock.calls as Array<[{ type: string; observationEvent?: { lemma: { lemmaId: string }; observation: { kind: string } } }]>).find(
      ([event]) =>
        event.type === "observation" &&
        event.observationEvent?.observation.kind === "chunk-produced"
    );
    expect(chunkObs).toBeDefined();
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("chunk:buenos_dias");
  });

  it("085.3: detects inventory chunks even when scene.chunks is absent", async () => {
    // Chunk detection uses the hand-curated competency inventory, not scene.chunks.
    // An NPC greeting is detected regardless of what the authoring pipeline extracted.
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    await middleware.finalize?.(execution, createTestTurn("Buenos dias viajero!"));

    const chunkObs = (apply.mock.calls as Array<[{ type: string; observationEvent?: { observation: { kind: string } } }]>).find(
      ([event]) =>
        event.type === "observation" &&
        (event.observationEvent?.observation.kind === "chunk-encountered" ||
          event.observationEvent?.observation.kind === "chunk-produced")
    );
    expect(chunkObs).toBeDefined();
  });

  it("085.5: first NPC chunk-encountered writes a teach-record and teach-line annotation", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const writeRecord = vi.fn().mockResolvedValue(undefined);
    const teachRecordStore = {
      has: vi.fn().mockResolvedValue(false), // no prior record
      write: writeRecord,
      list: vi.fn().mockResolvedValue([])
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          // lemmaCards is empty so the chunk card is new
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile({ lemmaCards: {} }))
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK]),
        teachRecordStore
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("Buenos dias viajero!"));

    // Teach-record should have been written for the "greet" function.
    expect(writeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        competencyId: "greet",
        realizingChunkId: "buenos_dias"
      })
    );
    // Teach-line annotation should be present on the result turn.
    expect(result?.annotations?.["sugarlang.teachLine"]).toBeDefined();
    expect((result?.annotations?.["sugarlang.teachLine"] as { label: string }).label).toBe("Greet");
  });

  it("085.5: re-encounter of a chunk with an existing teach-record writes no second record or annotation", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const writeRecord = vi.fn().mockResolvedValue(undefined);
    const teachRecordStore = {
      has: vi.fn().mockResolvedValue(true), // record already exists
      write: writeRecord,
      list: vi.fn().mockResolvedValue([])
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile({ lemmaCards: {} }))
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK]),
        teachRecordStore
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("Buenos dias viajero!"));

    expect(writeRecord).not.toHaveBeenCalled();
    expect(result?.annotations?.["sugarlang.teachLine"]).toBeUndefined();
  });

  it("085.5: no teach-record when chunk card already exists (not a first teach)", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const writeRecord = vi.fn().mockResolvedValue(undefined);
    const teachRecordStore = {
      has: vi.fn().mockResolvedValue(false),
      write: writeRecord,
      list: vi.fn().mockResolvedValue([])
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          // chunk card already exists in lemmaCards
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile({
            lemmaCards: {
              "chunk:buenos_dias": {
                lemmaId: "chunk:buenos_dias",
                difficulty: 0.3,
                stability: 1,
                retrievability: 0.9,
                lastReviewedAt: 1,
                reviewCount: 1,
                lapseCount: 0,
                cefrPriorBand: "A1",
                priorWeight: 1,
                productiveStrength: 0,
                lastProducedAtMs: null,
                provisionalEvidence: 0,
                provisionalEvidenceFirstSeenTurn: null
              }
            }
          }))
        },
        learnerStateReducer: { apply },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK]),
        teachRecordStore
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("Buenos dias viajero!"));

    // Card was not new, so no teach-record or annotation even if store has no record.
    expect(writeRecord).not.toHaveBeenCalled();
    expect(result?.annotations?.["sugarlang.teachLine"]).toBeUndefined();
  });

  it("085.3: chunk cards filtered from computePendingProvisionalLemmas probe floor", () => {
    const profile = createTestLearnerProfile({
      lemmaCards: {
        hola: {
          lemmaId: "hola",
          difficulty: 0.3,
          stability: 1,
          retrievability: 0.9,
          lastReviewedAt: 1,
          reviewCount: 1,
          lapseCount: 0,
          cefrPriorBand: "A1",
          priorWeight: 1,
          productiveStrength: 0,
          lastProducedAtMs: null,
          provisionalEvidence: 2,
          provisionalEvidenceFirstSeenTurn: 1
        },
        "chunk:buenos_dias": {
          lemmaId: "chunk:buenos_dias",
          difficulty: 0.3,
          stability: 1,
          retrievability: 0.9,
          lastReviewedAt: 1,
          reviewCount: 1,
          lapseCount: 0,
          cefrPriorBand: "A1",
          priorWeight: 1,
          productiveStrength: 0.2,
          lastProducedAtMs: null,
          provisionalEvidence: 0,
          provisionalEvidenceFirstSeenTurn: null
        }
      }
    });

    const pending = computePendingProvisionalLemmas(profile);

    // Only the real lemma (hola) appears; the chunk card is excluded.
    expect(pending.map((p) => p.lemmaRef.lemmaId)).not.toContain("chunk:buenos_dias");
    expect(pending.map((p) => p.lemmaRef.lemmaId)).toContain("hola");
  });
});
