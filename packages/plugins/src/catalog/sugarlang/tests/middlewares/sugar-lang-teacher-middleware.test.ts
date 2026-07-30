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
  SUGARLANG_PRESCRIPTION_ANNOTATION,
  SUGARLANG_SCHEDULE_ANNOTATION
} from "../../runtime/middlewares/shared";
import type { TeachSchedule } from "../../runtime/scheduler/teach-schedule";
import {
  createEmptyPrescription,
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";

describe("SugarLangTeacherMiddleware", () => {
  // Story 071.5 — the prescription guard must sit BELOW the scripted-mode
  // block. Prescription-less scripted dialogue still needs a constraint so
  // the scripted middleware can adapt the authored text; hoisting the guard
  // back above the block silently reintroduces the bypass.
  it("scripted mode without a prescription still builds a constraint (empty targetVocab, synthetic rawPrescription), teacher not invoked", async () => {
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
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });
    // Deliberately no SUGARLANG_PRESCRIPTION_ANNOTATION.

    await middleware.prepare?.(execution);

    expect(invokeTeacher).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      targetVocab: {
        introduce: [],
        reinforce: [],
        avoid: []
      },
      rawPrescription: {
        rationale: {
          summary: "scripted-mode-no-prescription"
        }
      }
    });
  });

  it("gives an A1 scripted line 30% target language, from the shared table", async () => {
    // 090.8b. This is the pin that was missing: the scripted branch carried its
    // own 0.2/0.5/0.8 table for months, disagreeing with band-envelope's
    // 0.3/0.65/0.85, and NO test noticed when the fold changed it -- because the
    // only 0.2s in this file are mock teacher RETURN values, which assert
    // nothing about what the scripted branch produces.
    //
    // Asserting the constraint the middleware writes, not the table it reads:
    // a test on the table would have passed throughout the divergence.
    const services = createServicesStub({
      resolveForExecution: () => ({
        learnerStore: {
          getCurrentProfile: vi
            .fn()
            .mockResolvedValue(createTestLearnerProfile({ estimatedCefrBand: "A1" }))
        },
        teacher: { invoke: vi.fn() }
      })
    });
    const middleware = createSugarLangTeacherMiddleware({
      services: services as never
    });
    const execution = createTestExecution({
      selection: {
        conversationKind: "scripted-dialogue",
        npcDefinitionId: "npc-1",
        npcDisplayName: "Marisol",
        targetLanguage: "es",
        supportLanguage: "en",
        metadata: {}
      }
    });

    await middleware.prepare?.(execution);

    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      supportPosture: "anchored",
      targetLanguageRatio: 0.3
    });
  });

  it("non-scripted mode without a prescription returns without writing a constraint", async () => {
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
    // Deliberately no SUGARLANG_PRESCRIPTION_ANNOTATION.

    await middleware.prepare?.(execution);

    expect(invokeTeacher).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toBeUndefined();
  });

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

// 087.6: schedule-driven realization -- teacher skipped when schedule is present.
const SUGARAGENT_CONTRIB_SUGARLANG_KEY = "sugaragent.contrib/sugarlang";

function makeSchedule(overrides: Partial<TeachSchedule> = {}): TeachSchedule {
  return {
    teachables: [
      { id: "comer", kind: "vocabulary", priority: 0.9, teachReason: "due", affinityNpcIds: [] },
      { id: "hablar", kind: "vocabulary", priority: 0.7, teachReason: "introduction", affinityNpcIds: [] }
    ],
    isColdStart: false,
    sceneId: "scene-1",
    conversationId: "conv-1",
    sceneComprehensionRate: 0.65,
    stretchAllowanceActive: false,
    strainSuppressed: false,
    ...overrides
  };
}

function makeScheduleServices(invokeTeacher: ReturnType<typeof vi.fn>) {
  return {
    resolveForExecution: () => ({
      learnerStore: {
        getCurrentProfile: vi.fn().mockResolvedValue(createTestLearnerProfile())
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
      teacher: { invoke: invokeTeacher }
    })
  };
}

describe("SugarLangTeacherMiddleware -- 087.6 schedule-driven realization", () => {
  it("builds a constraint from the schedule without invoking the teacher LLM", async () => {
    const invokeTeacher = vi.fn();
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = {
      ...createEmptyPrescription(),
      introduce: [{ lemmaId: "comer", lang: "es" }],
      reinforce: [],
      avoid: []
    };
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule();

    await middleware.prepare?.(execution);

    expect(invokeTeacher).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      targetVocab: {
        introduce: [{ lemmaId: "comer", lang: "es" }],
        reinforce: [],
        avoid: []
      },
      // Envelope values come from the shared band-envelope table (A2 ->
      // supported -> 0.65, two-clause), NOT an inlined copy. If this test ever
      // needs different numbers than FallbackTeacherPolicy produces for the
      // same posture, the tables have diverged again.
      supportPosture: "supported",
      targetLanguageRatio: 0.65,
      interactionStyle: "natural_dialogue",
      sentenceComplexityCap: "two-clause"
    });
  });

  it("schedule-driven directive has maxTurns=1 (recomputed every turn)", async () => {
    const invokeTeacher = vi.fn();
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule();

    await middleware.prepare?.(execution);

    const directive = execution.annotations[SUGARLANG_DIRECTIVE_ANNOTATION] as { directiveLifetime: { maxTurns: number } };
    expect(directive.directiveLifetime.maxTurns).toBe(1);
  });

  it("publishes retrieveBiasTerms in the sugarlang contribution when schedule has active lemmas", async () => {
    const invokeTeacher = vi.fn();
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule();

    await middleware.prepare?.(execution);

    const contrib = execution.annotations[SUGARAGENT_CONTRIB_SUGARLANG_KEY] as { retrieveBiasTerms?: string[] };
    expect(contrib.retrieveBiasTerms).toEqual(["comer", "hablar"]);
  });

  it("does not publish retrieveBiasTerms when no schedule is present (zero-contribution invariant)", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue({
      targetVocab: { introduce: [], reinforce: [], avoid: [] },
      supportPosture: "anchored",
      targetLanguageRatio: 0.2,
      interactionStyle: "listening_first",
      glossingStrategy: "none",
      sentenceComplexityCap: "single-clause",
      comprehensionCheck: { trigger: false, probeStyle: "none", targetLemmas: [] },
      directiveLifetime: { maxTurns: 3, invalidateOn: [] },
      citedSignals: ["test"],
      rationale: "test",
      confidenceBand: "high",
      isFallbackDirective: false
    });
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    // No schedule annotation.

    await middleware.prepare?.(execution);

    const contrib = execution.annotations[SUGARAGENT_CONTRIB_SUGARLANG_KEY] as { retrieveBiasTerms?: string[] };
    expect(contrib.retrieveBiasTerms).toBeUndefined();
  });

  it("falls back to teacher LLM when no schedule annotation is present", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue({
      targetVocab: { introduce: [], reinforce: [], avoid: [] },
      supportPosture: "anchored",
      targetLanguageRatio: 0.2,
      interactionStyle: "listening_first",
      glossingStrategy: "none",
      sentenceComplexityCap: "single-clause",
      comprehensionCheck: { trigger: false, probeStyle: "none", targetLemmas: [] },
      directiveLifetime: { maxTurns: 3, invalidateOn: [] },
      citedSignals: ["fallback"],
      rationale: "fallback",
      confidenceBand: "medium",
      isFallbackDirective: true
    });
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    // No SUGARLANG_SCHEDULE_ANNOTATION.

    await middleware.prepare?.(execution);

    expect(invokeTeacher).toHaveBeenCalledTimes(1);
  });

  it("falls back to teacher LLM when schedule is a cold start (no cards yet)", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue({
      targetVocab: { introduce: [], reinforce: [], avoid: [] },
      supportPosture: "anchored",
      targetLanguageRatio: 0.2,
      interactionStyle: "listening_first",
      glossingStrategy: "none",
      sentenceComplexityCap: "single-clause",
      comprehensionCheck: { trigger: false, probeStyle: "none", targetLemmas: [] },
      directiveLifetime: { maxTurns: 3, invalidateOn: [] },
      citedSignals: ["fallback"],
      rationale: "fallback",
      confidenceBand: "medium",
      isFallbackDirective: true
    });
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule({ isColdStart: true });

    await middleware.prepare?.(execution);

    expect(invokeTeacher).toHaveBeenCalledTimes(1);
  });

  it("excludes fluency teachables from retrieveBiasTerms", async () => {
    const invokeTeacher = vi.fn();
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_PRESCRIPTION_ANNOTATION] = createEmptyPrescription();
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule({
      teachables: [
        { id: "comer", kind: "vocabulary", priority: 0.9, teachReason: "due", affinityNpcIds: [] },
        { id: "agua", kind: "vocabulary", priority: 0.5, teachReason: "fluency", affinityNpcIds: [] }
      ]
    });

    await middleware.prepare?.(execution);

    const contrib = execution.annotations[SUGARAGENT_CONTRIB_SUGARLANG_KEY] as { retrieveBiasTerms?: string[] };
    expect(contrib.retrieveBiasTerms).toEqual(["comer"]);
    expect(contrib.retrieveBiasTerms).not.toContain("agua");
  });
});
