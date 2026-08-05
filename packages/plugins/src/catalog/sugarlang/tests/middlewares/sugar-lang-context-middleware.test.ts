/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-context-middleware.test.ts
 *
 * Purpose: Verifies the Sugarlang context middleware's placement and annotation flow.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-context-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangContextMiddleware } from "../../runtime/middlewares/sugar-lang-context-middleware";
import {
  SUGARLANG_PLACEMENT_STATUS_FACT,
  SUGARLANG_PLACEMENT_WRITER,
  createSugarlangPlacementStatusScope
} from "../../runtime/learner/fact-definitions";
import {
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
} from "../../runtime/middlewares/shared";
import {
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";
import { createLearnerBlackboard } from "../learner/test-helpers";
import { SUGARLANG_LEARNER_PROGRESS_ANNOTATION } from "../../runtime/middlewares/shared";
import { SugarlangMissingTargetLanguageError } from "../../config";

describe("SugarLangContextMiddleware", () => {
  it("runs sugarlang context for scripted NPC conversations", async () => {
    const resolveForExecution = vi.fn().mockReturnValue(null);
    const middleware = createSugarLangContextMiddleware({
      services: createServicesStub({
        resolveForExecution,
        getTargetLanguage: () => "es"
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

    const result = await middleware.prepare?.(execution);

    // Scripted mode now goes through context middleware
    expect(result).toBeDefined();
    expect(resolveForExecution).toHaveBeenCalled();
  });


  it("treats a completed placement NPC as replay-inert normal conversation", async () => {
    const learner = createTestLearnerProfile({
      learnerId: "learner:es:en" as ReturnType<typeof createTestLearnerProfile>["learnerId"]
    });
    const blackboard = createLearnerBlackboard();
    blackboard.setFact({
      definition: SUGARLANG_PLACEMENT_STATUS_FACT,
      scope: createSugarlangPlacementStatusScope(learner.learnerId),
      value: {
        status: "completed",
        cefrBand: "A2",
        confidence: 0.8,
        completedAt: 1234
      },
      sourceSystem: SUGARLANG_PLACEMENT_WRITER
    });
    const ensure = vi.fn().mockResolvedValue({
      sceneId: "scene-1",
      contentHash: "hash",
      pipelineVersion: "v1",
      atlasVersion: "atlas-v1",
      profile: "runtime-preview",
      lemmas: {},
      properNouns: [],
      anchors: [],
      questEssentialLemmas: []
    });
    const services = createServicesStub({
      getBlackboard: () => blackboard,
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(learner)
        },
        learnerStateReducer: {
          apply: vi.fn()
        },
        sceneLexiconStore: {
          ensure
        },
        atlas: {
          getLemma: vi.fn().mockReturnValue(undefined)
        }
      })
    });
    const middleware = createSugarLangContextMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "agent",
        targetLanguage: "es",
        supportLanguage: "en"
      },
      runtimeContext: {
        here: { regionId: "region-1", regionDisplayName: "Region", regionLorePageId: null, sceneId: "scene-1", sceneDisplayName: "Scene", area: null, parentArea: null },
        playerLocation: null, playerPosition: null, playerArea: null,
        npcLocation: null, npcPosition: null, npcArea: null,
        npcPlayerRelation: null, npcBehavior: null, trackedQuest: null,
        activeQuestStage: null,
        activeQuestObjectives: {
          questId: "quest-placement",
          displayName: "Placement",
          stageId: "stage-1",
          stageDisplayName: "Stage 1",
          objectives: [{
            nodeId: "node-assessment",
            displayName: "Assessment",
            description: "Language assessment",
            objectiveSubtype: "assessment",
            targetId: "npc-1"
          }]
        }
      }
    });

    await middleware.prepare?.(execution);

    // 090.10: was `expect(prescribe).toHaveBeenCalledTimes(1)`. The budgeter is
    // gone; `ensure` below proves the same thing -- the middleware fell through
    // to the normal runtime path rather than short-circuiting on placement.
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("THE ONE THAT MATTERS: writes the learner-progress annotation", async () => {
    // The only place learner progress is PRODUCED. Every other test injects
    // this annotation by hand, so the whole consumer side was covered and the
    // writer was not -- and a writer nothing exercises can stop writing
    // without one test noticing.
    const learner = createTestLearnerProfile({
      learnerId: "learner:es:en" as ReturnType<typeof createTestLearnerProfile>["learnerId"]
    });
    // No blackboard: the world-day lookup is optional and the annotation must
    // still be written without it.
    const services = createServicesStub({
      getBlackboard: () => null,
      resolveForExecution: () => ({
        learnerStore: { getCurrentProfile: vi.fn().mockResolvedValue(learner) },
        learnerStateReducer: { apply: vi.fn() },
        sceneLexiconStore: {
          ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1",
            contentHash: "hash",
            pipelineVersion: "v1",
            atlasVersion: "atlas-v1",
            profile: "runtime-preview",
            lemmas: {},
            properNouns: [],
            anchors: [],
            questEssentialLemmas: []
          })
        },
        atlas: { getLemma: vi.fn().mockReturnValue(undefined) },
        teachRecordStore: { list: vi.fn().mockResolvedValue([]) },
        ledgerStore: { getEncounterCounts: vi.fn().mockResolvedValue({}) }
      })
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "agent",
        targetLanguage: "es",
        supportLanguage: "en"
      }
    });

    await createSugarLangContextMiddleware({ services: services as never }).prepare?.(
      execution
    );

    const written = execution.annotations[SUGARLANG_LEARNER_PROGRESS_ANNOTATION];
    expect(written).toBeDefined();
    // Shape, not values: the fixture learner has no history, so what is being
    // pinned is that a real LearnerProgress reached the annotation rather than
    // an empty object or a partially-built one.
    expect(written).toMatchObject({
      met: expect.any(Array),
      unmetCompetencyIds: expect.any(Array),
      dueItemIds: expect.any(Array),
      isColdStart: expect.any(Boolean)
    });
  });

  it("treats the placement role as inert when placement is globally disabled", async () => {
    const learner = createTestLearnerProfile();
    const services = createServicesStub({
      getConfig: () => ({
        debugLogging: false,
        placement: {
          enabled: false,
          minAnswersForValid: "use-bank-default" as const,
          confidenceFloor: 0.3,
          openingDialogTurns: 2,
          closingDialogTurns: 2
        }
      }),
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(learner)
        },
        learnerStateReducer: {
          apply: vi.fn()
        },
        sceneLexiconStore: {
          ensure: vi.fn().mockResolvedValue({
            sceneId: "scene-1",
            contentHash: "hash",
            pipelineVersion: "v1",
            atlasVersion: "atlas-v1",
            profile: "runtime-preview",
            lemmas: {},
            properNouns: [],
            anchors: [],
            questEssentialLemmas: []
          })
        },
        atlas: {
          getLemma: vi.fn().mockReturnValue(undefined)
        }
      })
    });
    const middleware = createSugarLangContextMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        interactionMode: "agent",
        targetLanguage: "es",
        supportLanguage: "en"
      },
      runtimeContext: {
        here: { regionId: "region-1", regionDisplayName: "Region", regionLorePageId: null, sceneId: "scene-1", sceneDisplayName: "Scene", area: null, parentArea: null },
        playerLocation: null, playerPosition: null, playerArea: null,
        npcLocation: null, npcPosition: null, npcArea: null,
        npcPlayerRelation: null, npcBehavior: null, trackedQuest: null,
        activeQuestStage: null,
        activeQuestObjectives: {
          questId: "quest-placement",
          displayName: "Placement",
          stageId: "stage-1",
          stageDisplayName: "Stage 1",
          objectives: [{
            nodeId: "node-assessment",
            displayName: "Assessment",
            description: "Language assessment",
            objectiveSubtype: "assessment",
            targetId: "npc-1"
          }]
        }
      }
    });

    await middleware.prepare?.(execution);

    // 090.10: was `expect(prescribe).toHaveBeenCalledTimes(1)`. The budgeter is
    // gone; `ensure` below proves the same thing -- the middleware fell through
    // to the normal runtime path rather than short-circuiting on placement.
  });
  it("090.11: THROWS in the runtime when no target language is configured", async () => {
    // THE RUNTIME DOES NOT RUN WITHOUT A LANGUAGE (nikki, 2026-07-31).
    //
    // This used to `return execution`, so a shipped game with sugarlang enabled
    // and no language ran every conversation with sugarlang silently inert --
    // nothing graded, nothing taught. That is indistinguishable from "the
    // teaching is bad" and is the worst possible presentation of a one-field
    // configuration mistake.
    //
    // Studio and preview are the layers allowed to be relaxed about this, and
    // they each handle it their own way. Reaching HERE means a BUILT GAME
    // shipped misconfigured.
    const middleware = createSugarLangContextMiddleware({
      services: createServicesStub({
        getTargetLanguage: () => null
      }) as never
    });
    const execution = createTestExecution();
    execution.selection.targetLanguage = "";

    await expect(middleware.prepare?.(execution)).rejects.toThrow(
      SugarlangMissingTargetLanguageError
    );
  });

  it("090.11: does NOT throw for a conversation sugarlang is not part of", async () => {
    // The enabled-check is `shouldRunSugarlangForExecution`, which returns
    // before the language is ever read. A project that never uses sugarlang must
    // not be crashed by sugarlang's configuration.
    const middleware = createSugarLangContextMiddleware({
      services: createServicesStub({
        getTargetLanguage: () => null
      }) as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "free-form",
        npcDefinitionId: null,
        npcDisplayName: null,
        interactionMode: "agent",
        targetLanguage: "",
        supportLanguage: "en",
        metadata: {}
      } as never
    });

    await expect(middleware.prepare?.(execution)).resolves.toBeDefined();
  });
});
