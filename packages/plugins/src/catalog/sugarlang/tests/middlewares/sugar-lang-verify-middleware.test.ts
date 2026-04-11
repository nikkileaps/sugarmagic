/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-verify-middleware.test.ts
 *
 * Purpose: Verifies repair and fallback behavior in the Sugarlang verify middleware.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-verify-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.4
 *
 * Status: active
 */

import { PLAYER_VO_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it, vi } from "vitest";
import { createSugarLangVerifyMiddleware } from "../../runtime/middlewares/sugar-lang-verify-middleware";
import { SUGARLANG_CONSTRAINT_ANNOTATION } from "../../runtime/middlewares/shared";
import {
  createBaseConstraint,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile,
  createTestTurn
} from "./test-helpers";

describe("SugarLangVerifyMiddleware", () => {
  it("temporarily bypasses verification when verify is disabled in Sugarlang config", async () => {
    const classifierCheck = vi.fn();
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        getConfig: () => ({
          targetLanguage: "es",
          supportLanguage: "en",
          debugLogging: true,
          verifyEnabled: false,
          chunkExtraction: {
            enabled: true
          },
          placement: {
            enabled: true,
            minAnswersForValid: "use-bank-default" as const,
            confidenceFloor: 0.3,
            openingDialogTurns: 2,
            closingDialogTurns: 2
          }
        }),
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi.fn()
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient: {
            generate: vi.fn()
          }
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = createTestTurn("texto complicado");

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
  });

  it("bypasses verification for scripted NPC conversations", async () => {
    const classifierCheck = vi.fn();
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "scripted",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = createTestTurn("texto complicado");

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("bypasses verification for player voice-over turns", async () => {
    const classifierCheck = vi.fn();
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        getPlayerDefinitionId: () => "player-1",
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn()
          },
          classifier: {
            check: classifierCheck
          },
          llmClient
        })
      }) as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();
    const turn = {
      ...createTestTurn("I can't believe I'm here."),
      speakerId: PLAYER_VO_SPEAKER.speakerId,
      speakerLabel: PLAYER_VO_SPEAKER.displayName
    };

    const result = await middleware.finalize?.(execution, turn);

    expect(result).toEqual(turn);
    expect(classifierCheck).not.toHaveBeenCalled();
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("repairs an out-of-envelope turn and returns the repaired text", async () => {
    const classifierCheck = vi
      .fn()
      .mockReturnValueOnce({
        withinEnvelope: false,
        profile: {
          totalTokens: 1,
          knownTokens: 0,
          inBandTokens: 0,
          unknownTokens: 1,
          bandHistogram: {
            A1: 0,
            A2: 0,
            B1: 1,
            B2: 0,
            C1: 0,
            C2: 0
          },
          outOfEnvelopeLemmas: [{ lemmaId: "complicado", lang: "es" }],
          ceilingExceededLemmas: [{ lemmaId: "complicado", lang: "es" }],
          questEssentialLemmasMatched: [],
          coverageRatio: 0.5
        },
        worstViolation: {
          lemmaRef: { lemmaId: "complicado", lang: "es" },
          surfaceForm: "complicado",
          cefrBand: "B1",
          reason: "too hard"
        },
        rule: "test",
        violations: [
          {
            lemmaRef: { lemmaId: "complicado", lang: "es" },
            surfaceForm: "complicado",
            cefrBand: "B1",
            reason: "too hard"
          }
        ],
        exemptionsApplied: []
      })
      .mockReturnValueOnce({
        withinEnvelope: true,
        profile: {
          totalTokens: 1,
          knownTokens: 1,
          inBandTokens: 1,
          unknownTokens: 0,
          bandHistogram: {
            A1: 1,
            A2: 0,
            B1: 0,
            B2: 0,
            C1: 0,
            C2: 0
          },
          outOfEnvelopeLemmas: [],
          ceilingExceededLemmas: [],
          questEssentialLemmasMatched: [],
          coverageRatio: 1
        },
        worstViolation: null,
        rule: "test",
        violations: [],
        exemptionsApplied: []
      });
    const llmClient = {
      generate: vi.fn().mockResolvedValue({ text: "texto simple", requestId: null })
    };
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        sceneLexiconStore: {
          ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1",
            contentHash: "hash",
            pipelineVersion: "v1",
            atlasVersion: "v1",
            profile: "runtime-preview",
            lemmas: {},
            properNouns: [],
            anchors: [],
            questEssentialLemmas: []
          })
        },
        classifier: {
          check: classifierCheck
        },
        llmClient
      })
    });
    const middleware = createSugarLangVerifyMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      rawPrescription: {
        introduce: [],
        reinforce: [],
        avoid: [{ lemmaId: "complicado", lang: "es" }],
        budget: { newItemsAllowed: 0 },
        rationale: {
          candidateSetSize: 0,
          envelopeSurvivorCount: 0,
          priorityScores: [],
          reasons: []
        }
      }
    });

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("texto complicado")
    );

    expect(llmClient.generate).toHaveBeenCalledTimes(1);
    expect(result?.text).toBe("texto simple");
  });

  it("does not attempt autoSimplify when the failure has no actionable lemma violations", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              sceneId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: false,
              profile: {
                totalTokens: 4,
                knownTokens: 1,
                inBandTokens: 1,
                unknownTokens: 3,
                bandHistogram: {
                  A1: 1,
                  A2: 0,
                  B1: 0,
                  B2: 0,
                  C1: 0,
                  C2: 0
                },
                outOfEnvelopeLemmas: [],
                ceilingExceededLemmas: [],
                questEssentialLemmasMatched: [],
                coverageRatio: 0.25
              },
              worstViolation: null,
              rule: "test",
              violations: [],
              exemptionsApplied: []
            })
          },
          llmClient
        })
      }) as never,
      logger
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint();

    const result = await middleware.finalize?.(execution, createTestTurn("zzzz hola qqqq"));

    expect(result?.text).toBe("zzzz hola qqqq");
    expect(llmClient.generate).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not trigger quest-essential repair on a generic opening turn that is not quest-focused", async () => {
    const llmClient = {
      generate: vi.fn()
    };
    const middleware = createSugarLangVerifyMiddleware({
      services: createServicesStub({
        resolveForExecution: () => ({
          learnerStore: {
            getCurrentProfile: vi
              .fn()
              .mockResolvedValue(createTestLearnerProfile())
          },
          sceneLexiconStore: {
            ensure: vi.fn().mockResolvedValue({
              sceneId: "scene-1",
              contentHash: "hash",
              pipelineVersion: "v1",
              atlasVersion: "v1",
              profile: "runtime-preview",
              lemmas: {},
              properNouns: [],
              anchors: [],
              questEssentialLemmas: []
            })
          },
          classifier: {
            check: vi.fn().mockReturnValue({
              withinEnvelope: true,
              profile: {
                totalTokens: 7,
                knownTokens: 7,
                inBandTokens: 7,
                unknownTokens: 0,
                bandHistogram: {
                  A1: 7,
                  A2: 0,
                  B1: 0,
                  B2: 0,
                  C1: 0,
                  C2: 0
                },
                outOfEnvelopeLemmas: [],
                ceilingExceededLemmas: [],
                questEssentialLemmasMatched: [],
                coverageRatio: 1
              },
              worstViolation: null,
              rule: "test",
              violations: [],
              exemptionsApplied: []
            })
          },
          llmClient
        })
      }) as never
    });
    const baseExecution = createTestExecution();
    const execution = createTestExecution({
      input: null,
      runtimeContext: {
        ...baseExecution.runtimeContext!,
        activeQuestObjectives: {
          questId: "quest-1",
          displayName: "Lost Luggage",
          stageId: "stage-1",
          stageDisplayName: "Find the suitcase",
          objectives: [
            {
              nodeId: "objective-1",
              displayName: "Find suitcase",
              description: "Ask about the suitcase."
            }
          ]
        }
      }
    });
    execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = createBaseConstraint({
      questEssentialLemmas: [
        {
          lemmaRef: { lemmaId: "maleta", lang: "es" },
          sourceObjectiveDisplayName: "Find suitcase",
          supportLanguageGloss: "suitcase"
        }
      ]
    });

    const result = await middleware.finalize?.(
      execution,
      createTestTurn("Hello. What can I help you with today?")
    );

    expect(result?.text).toBe("Hello. What can I help you with today?");
    expect(llmClient.generate).not.toHaveBeenCalled();
  });
});
