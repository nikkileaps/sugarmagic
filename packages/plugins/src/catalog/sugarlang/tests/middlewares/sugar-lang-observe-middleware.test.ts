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
  SUGARLANG_HOVER_LEMMA_ANNOTATION,
  SUGARLANG_LAST_TURN_COMPREHENSION_CHECK_STATE,
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
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("exponent:buenos_dias");
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
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("exponent:buenos_dias");
  });

  it("090.11: a competency on the slate highlights the exponent the NPC actually said", async () => {
    // THE GAP THIS CLOSES. `vocabularyRefs()` dropped every competency when the
    // highlight was built, so an NPC could perform `greet` with "Buenos dias"
    // and nothing was lit -- the learner saw no indication that the phrase was
    // the thing being taught.
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply: vi.fn().mockResolvedValue(undefined) },
        sceneLexiconStore: makeSceneLexiconStoreWith([BUENOS_DIAS_CHUNK])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      targetVocab: {
        introduce: [{ kind: "competency", competencyId: "greet", lang: "es" }],
        reinforce: [],
        avoid: []
      }
    });

    const turn = await middleware.finalize?.(
      execution,
      createTestTurn("Buenos dias, viajero.")
    );

    const highlight = turn?.annotations?.["dialogueHighlight"] as
      | { focusTerms: string[]; glosses?: Record<string, string> }
      | undefined;

    // ONE term carrying the whole phrase -- not "buenos" and "dias" separately.
    expect(highlight?.focusTerms).toContain("Buenos dias");
    expect(highlight?.focusTerms.some((term) => term.toLowerCase() === "dias")).toBe(
      false
    );
    // The hover explains the ACT, because that is what is being taught.
    //
    // Keyed LOWERCASE even though the line capitalises it. This assertion used
    // to read `glosses["Buenos dias"]`, which passed while the tooltip was
    // broken in play: the reader looks up the hovered text, and a hover arrives
    // lowercased, so a key carrying the line's casing was never found.
    expect(highlight?.glosses?.["buenos dias"]).toBe("good morning");
    expect(highlight?.glosses?.["Buenos dias"]).toBeUndefined();
  });

  it("090.11: a slated competency whose exponent is ABSENT is not listed", async () => {
    // MATCHED AGAINST THE TEXT, NOT LISTED FROM THE INVENTORY. `introduce-self`
    // has several exponents (me llamo, mi nombre es, mucho gusto) and this line
    // uses none of them. Naming a phrase that is not on screen would offer the
    // learner a term they cannot find, and would make the realization trace
    // claim the line taught something it did not.
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply: vi.fn().mockResolvedValue(undefined) },
        sceneLexiconStore: makeSceneLexiconStoreWith([])
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      targetVocab: {
        introduce: [{ kind: "competency", competencyId: "introduce-self", lang: "es" }],
        reinforce: [],
        avoid: []
      }
    });

    const turn = await middleware.finalize?.(
      execution,
      createTestTurn("El barco llega manana.")
    );

    const highlight = turn?.annotations?.["dialogueHighlight"] as
      | { focusTerms: string[] }
      | undefined;

    for (const exponent of ["me llamo", "mi nombre es", "mucho gusto"]) {
      expect(highlight?.focusTerms ?? []).not.toContain(exponent);
    }
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
    expect(chunkObs![0].observationEvent!.lemma.lemmaId).toBe("exponent:buenos_dias");
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
    expect(result?.annotations?.["dialogueTeachLine"]).toBeDefined();
    expect((result?.annotations?.["dialogueTeachLine"] as { label: string }).label).toBe("Greet");
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
    expect(result?.annotations?.["dialogueTeachLine"]).toBeUndefined();
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
              "exponent:buenos_dias": {
                lemmaId: "exponent:buenos_dias",
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
    expect(result?.annotations?.["dialogueTeachLine"]).toBeUndefined();
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
        "exponent:buenos_dias": {
          lemmaId: "exponent:buenos_dias",
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
    expect(pending.map((p) => p.lemmaRef.lemmaId)).not.toContain("exponent:buenos_dias");
    expect(pending.map((p) => p.lemmaRef.lemmaId)).toContain("hola");
  });
});

describe("hover observations are guarded by the dictionary", () => {
  // A LemmaCard is a persisted flashcard, and its key is either an atlas lemma
  // or a chunk id (`exponent:<id>`). The hover term is whatever the presentation
  // layer highlighted, and it reaches the reducer as `lemmaId` unchecked -- so
  // without a guard a competency exponent surface writes a card under a key in
  // neither space. 45 of the 56 shipped competency surfaces are not lemmas.

  function setup(hoverTerm: string, knownLemmas: string[]) {
    const apply = vi.fn().mockResolvedValue(undefined);
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
        },
        learnerStateReducer: { apply },
        atlas: {
          getLemma: (lemmaId: string) =>
            knownLemmas.includes(lemmaId)
              ? { lemmaId, lang: "es", cefrPriorBand: "A1" }
              : undefined
        }
      })
    });
    const middleware = createSugarLangObserveMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    execution.annotations[SUGARLANG_HOVER_LEMMA_ANNOTATION] = {
      lemmaId: hoverTerm,
      lang: "es",
      dwellMs: 900
    };
    return { middleware, execution, apply };
  }

  const hoverEvents = (apply: ReturnType<typeof vi.fn>) =>
    (
      apply.mock.calls as Array<
        [{ type: string; observationEvent?: { observation: { kind: string } } }]
      >
    ).filter(([e]) => e.observationEvent?.observation.kind.startsWith("hovered"));

  it("records a hover on a word the dictionary knows", async () => {
    const { middleware, execution, apply } = setup("queso", ["queso"]);
    await middleware.finalize?.(execution, createTestTurn("Hay queso aqui."));
    expect(hoverEvents(apply)).toHaveLength(1);
  });

  it("IGNORES a hover on a competency surface, which is not a lemma", async () => {
    // `buenos dias` is a competency exponent. Before the guard this wrote
    // profile.lemmaCards["buenos dias"] -- a key nothing reads back.
    const { middleware, execution, apply } = setup("buenos dias", ["queso"]);
    await middleware.finalize?.(execution, createTestTurn("Buenos dias!"));
    expect(hoverEvents(apply)).toHaveLength(0);
  });

  it("records a hover on a chunk id, which is the other valid key space", async () => {
    const { middleware, execution, apply } = setup("exponent:buenos_dias", []);
    await middleware.finalize?.(execution, createTestTurn("Buenos dias!"));
    expect(hoverEvents(apply)).toHaveLength(1);
  });

  it("grades a hover on a competency BEING INTRODUCED as an introduction", async () => {
    // It used to grade every competency hover as a review -- "hovered", which
    // is FSRS "Hard" with a negative productive delta. The introduce check only
    // looked at vocabulary refs, and a competency card is keyed `exponent:<id>`,
    // so it could never match. A learner reaching for the competency the
    // Teacher was introducing got marked down for engaging with it.
    const { middleware, execution, apply } = setup("exponent:buenos_dias", []);
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      targetVocab: {
        introduce: [{ kind: "competency", competencyId: "greet", lang: "es" }],
        reinforce: [],
        avoid: []
      }
    });
    await middleware.finalize?.(execution, createTestTurn("Buenos dias!"));
    const kinds = (
      apply.mock.calls as Array<
        [{ observationEvent?: { observation: { kind: string } } }]
      >
    )
      .map(([e]) => e.observationEvent?.observation.kind)
      .filter((kind): kind is string => typeof kind === "string");
    expect(kinds).toContain("hovered-introduce");
    expect(kinds).not.toContain("hovered");
  });

  it("still grades a competency NOT being introduced as a review", async () => {
    const { middleware, execution, apply } = setup("exponent:buenos_dias", []);
    await middleware.finalize?.(execution, createTestTurn("Buenos dias!"));
    const kinds = (
      apply.mock.calls as Array<
        [{ observationEvent?: { observation: { kind: string } } }]
      >
    ).map(([e]) => e.observationEvent?.observation.kind);
    expect(kinds).toContain("hovered");
  });
});

describe("English words must not bank credit on Spanish cards (sugarmagic-latency-ipx)", () => {
  // THE BUG THIS CLOSES. The credit path admits any lemma the learner already
  // has a card for. Cards get created legitimately -- the Teacher teaches
  // `haber` -- and from then on typing the English word "he" recorded
  // `produced-unprompted` on it: FSRS grade "Easy" plus the largest strength
  // delta in the system. 23 of the 24 measured collision surfaces resolve to
  // A1/A2 lemmas, including he->haber, come->comer, ten->tener, dice->decir.
  // So the core verbs were the ones most likely to be silently marked mastered.

  function setup(playerText: string, cardLemmaIds: string[]) {
    const apply = vi.fn().mockResolvedValue(undefined);
    const lemmaCards = Object.fromEntries(
      cardLemmaIds.map((lemmaId) => [
        lemmaId,
        {
          lemmaId,
          lang: "es",
          cefrPriorBand: "A1",
          stability: 1,
          difficulty: 5,
          retrievability: 0.8,
          reviewCount: 3,
          lastReviewedAt: 1,
          productiveStrength: 0.2
        }
      ])
    );
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile({ lemmaCards } as never))
        },
        learnerStateReducer: { apply },
        atlas: {
          getLemma: (lemmaId: string) => ({ lemmaId, lang: "es", cefrPriorBand: "A1" })
        }
      })
    });
    const middleware = createSugarLangObserveMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    execution.input = { kind: "free_text", text: playerText } as never;
    return { middleware, execution, apply };
  }

  const producedFor = (apply: ReturnType<typeof vi.fn>, lemmaId: string) =>
    (
      apply.mock.calls as Array<
        [{ observationEvent?: { lemma?: { lemmaId: string }; observation: { kind: string } } }]
      >
    ).filter(
      ([e]) =>
        e.observationEvent?.lemma?.lemmaId === lemmaId &&
        e.observationEvent.observation.kind.startsWith("produced")
    );

  it("THE ONE THAT MATTERS: typing English 'he' banks nothing on haber", async () => {
    const { middleware, execution, apply } = setup("he said the nets were heavy", ["haber"]);
    await middleware.finalize?.(execution, createTestTurn("Aye."));
    expect(producedFor(apply, "haber")).toHaveLength(0);
  });

  it("a whole English sentence banks nothing on any core verb", async () => {
    // "he can come" would have credited haber, comer -- three of the most
    // important A1 verbs -- at maximum strength, from ordinary English.
    const { middleware, execution, apply } = setup("he can come and use ten of them", [
      "haber",
      "comer",
      "usar",
      "tener"
    ]);
    await middleware.finalize?.(execution, createTestTurn("Aye."));

    for (const lemmaId of ["haber", "comer", "usar", "tener"]) {
      expect(producedFor(apply, lemmaId)).toHaveLength(0);
    }
  });

  it("REAL Spanish still earns its credit -- the guard is not a blanket mute", async () => {
    // The failure mode to avoid is over-correcting into crediting nothing.
    const { middleware, execution, apply } = setup("quiero queso por favor", ["queso"]);
    await middleware.finalize?.(execution, createTestTurn("Aqui tienes."));
    expect(producedFor(apply, "queso").length).toBeGreaterThan(0);
  });
});
