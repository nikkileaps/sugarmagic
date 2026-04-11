/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-teacher-middleware.test.ts
 *
 * Purpose: Verifies the Sugarlang teacher middleware's constraint assembly and pre-placement bypass.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/middlewares/sugar-lang-teacher-middleware.
 *   - Uses shared middleware test fixtures from ./test-helpers.
 *
 * Implements: Epic 10 Story 10.2
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangTeacherMiddleware } from "../../runtime/middlewares/sugar-lang-teacher-middleware";
import {
  SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION,
  SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_DIRECTIVE_ANNOTATION,
  SUGARLANG_PREPLACEMENT_LINE_ANNOTATION,
  SUGARLANG_PRESCRIPTION_ANNOTATION
} from "../../runtime/middlewares/shared";
import {
  createEmptyPrescription,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";

describe("SugarLangTeacherMiddleware", () => {
  it("assembles a synthetic constraint for the pre-placement opening dialog without invoking the teacher", async () => {
    const invokeTeacher = vi.fn();
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile())
        },
        teacher: {
          invoke: invokeTeacher
        }
      })
    });
    const middleware = createSugarLangTeacherMiddleware({
      services: services as never
    });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_PREPLACEMENT_LINE_ANNOTATION] = {
      text: "Let's start in English.",
      lang: "en",
      lineId: "opening:line-1"
    };

    await middleware.prepare?.(execution);

    expect(invokeTeacher).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION]).toMatchObject({
      citedSignals: ["pre-placement-opening-dialog"],
      isFallbackDirective: false
    });
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      targetLanguage: "es",
      prePlacementOpeningLine: {
        text: "Let's start in English.",
        lang: "en",
        lineId: "opening:line-1"
      }
    });
  });

  it("does not pass quest-essential lemmas into the teacher for a generic opening turn", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue({
      targetVocab: {
        introduce: [],
        reinforce: [],
        avoid: []
      },
      supportPosture: "anchored",
      targetLanguageRatio: 0.2,
      interactionStyle: "listening_first",
      glossingStrategy: "none",
      sentenceComplexityCap: "single-clause",
      comprehensionCheck: {
        trigger: false,
        probeStyle: "none",
        targetLemmas: []
      },
      directiveLifetime: {
        maxTurns: 1,
        invalidateOn: []
      },
      citedSignals: ["test"],
      rationale: "test",
      confidenceBand: "high",
      isFallbackDirective: false
    });
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
        teacher: {
          invoke: invokeTeacher
        }
      })
    });
    const middleware = createSugarLangTeacherMiddleware({
      services: services as never
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
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION] = [
      {
        lemmaRef: { lemmaId: "maleta", lang: "es" },
        sourceObjectiveNodeId: "objective-1",
        sourceObjectiveDisplayName: "Find suitcase",
        sourceQuestId: "quest-1",
        cefrBand: "A2",
        supportLanguageGloss: "suitcase"
      }
    ];

    await middleware.prepare?.(execution);

    expect(invokeTeacher).toHaveBeenCalledTimes(1);
    expect(invokeTeacher.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        activeQuestEssentialLemmas: []
      })
    );
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).not.toMatchObject({
      questEssentialLemmas: expect.anything()
    });
  });

  it("passes quest-essential lemmas into the teacher when the player's input is objective-focused", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue({
      targetVocab: {
        introduce: [],
        reinforce: [],
        avoid: []
      },
      supportPosture: "anchored",
      targetLanguageRatio: 0.2,
      interactionStyle: "listening_first",
      glossingStrategy: "parenthetical",
      sentenceComplexityCap: "single-clause",
      comprehensionCheck: {
        trigger: false,
        probeStyle: "none",
        targetLemmas: []
      },
      directiveLifetime: {
        maxTurns: 1,
        invalidateOn: []
      },
      citedSignals: ["test"],
      rationale: "test",
      confidenceBand: "high",
      isFallbackDirective: false
    });
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
        teacher: {
          invoke: invokeTeacher
        }
      })
    });
    const middleware = createSugarLangTeacherMiddleware({
      services: services as never
    });
    const baseExecution = createTestExecution();
    const execution = createTestExecution({
      input: {
        kind: "free_text",
        text: "Can you help me find my suitcase?"
      },
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
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_ACTIVE_QUEST_ESSENTIAL_ANNOTATION] = [
      {
        lemmaRef: { lemmaId: "maleta", lang: "es" },
        sourceObjectiveNodeId: "objective-1",
        sourceObjectiveDisplayName: "Find suitcase",
        sourceQuestId: "quest-1",
        cefrBand: "A2",
        supportLanguageGloss: "suitcase"
      }
    ];

    await middleware.prepare?.(execution);

    expect(invokeTeacher).toHaveBeenCalledTimes(1);
    expect(invokeTeacher.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        activeQuestEssentialLemmas: [
          expect.objectContaining({
            lemmaRef: { lemmaId: "maleta", lang: "es" }
          })
        ]
      })
    );
  });
});
