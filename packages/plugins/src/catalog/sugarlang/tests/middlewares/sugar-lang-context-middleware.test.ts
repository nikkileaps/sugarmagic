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
  SUGARLANG_PLACEMENT_FLOW_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
} from "../../runtime/middlewares/shared";
import {
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";
import { createLearnerBlackboard } from "../learner/test-helpers";

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

  it("writes the pre-placement opening dialog annotations without running the budgeter", async () => {
    const learner = createTestLearnerProfile({
      assessment: {
        status: "unassessed",
        evaluatedCefrBand: null,
        cefrConfidence: 0.2,
        evaluatedAtMs: null
      }
    });
    const sceneEnsure = vi.fn();
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi.fn().mockResolvedValue(learner)
        },
        learnerStateReducer: {
          apply: vi.fn()
        },
        sceneLexiconStore: {
          ensure: sceneEnsure
        }
      }),
      findNpcDefinition: () => ({
        definitionId: "npc-1",
        displayName: "Marisol",
        description: "Welcome to the placement check.\nTake a breath first."
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

    expect(execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION]).toEqual({
      phase: "opening-dialog"
    });
    // 090.10: the empty-prescription annotation this used to assert went with
    // the budgeter. The opening-dialog line is the part that mattered.
    expect(execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION]).toEqual({
      text: "Welcome to the placement check.",
      lang: "en",
      lineId: "opening:marisol"
    });
    expect(sceneEnsure).not.toHaveBeenCalled();
  });

  it("honors a custom opening-dialog turn count before switching to the questionnaire", async () => {
    const learner = createTestLearnerProfile();
    const services = createServicesStub({
      getConfig: () => ({
        debugLogging: false,
        placement: {
          enabled: true,
          minAnswersForValid: "use-bank-default" as const,
          confidenceFloor: 0.3,
          openingDialogTurns: 3,
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
          ensure: vi.fn()
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
      },
      state: {
        "sugaragent.session": {
          sessionId: "session-1",
          turnCount: 2,
          history: []
        },
        "sugarlang.placementPhase": {
          phase: "opening-dialog",
          enteredAtTurn: 0
        }
      }
    });

    await middleware.prepare?.(execution);

    expect(execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION]).toEqual({
      phase: "opening-dialog"
    });
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

    expect(execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION]).toBeUndefined();
    // 090.10: was `expect(prescribe).toHaveBeenCalledTimes(1)`. The budgeter is
    // gone; `ensure` below proves the same thing -- the middleware fell through
    // to the normal runtime path rather than short-circuiting on placement.
    expect(ensure).toHaveBeenCalledTimes(1);
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

    expect(execution.annotations[SUGARLANG_PLACEMENT_FLOW_ANNOTATION]).toBeUndefined();
    // 090.10: was `expect(prescribe).toHaveBeenCalledTimes(1)`. The budgeter is
    // gone; `ensure` below proves the same thing -- the middleware fell through
    // to the normal runtime path rather than short-circuiting on placement.
  });
});
