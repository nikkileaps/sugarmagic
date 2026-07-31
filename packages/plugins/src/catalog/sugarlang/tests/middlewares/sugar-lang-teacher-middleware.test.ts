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
  SUGARLANG_SCHEDULE_ANNOTATION
} from "../../runtime/middlewares/shared";
import type { TeachSchedule } from "../../runtime/scheduler/teach-schedule";
import {
  createServicesStub,
  createTestExecution,
  createTestLearnerProfile
} from "./test-helpers";

describe("SugarLangTeacherMiddleware", () => {
  // 090.10: was "the prescription guard must sit BELOW the scripted-mode block"
  // (Story 071.5). There is no prescription and no guard any more, but the
  // property that mattered survives and is what this still pins: scripted
  // dialogue gets a constraint without the teacher LLM being called.
  it("scripted mode builds a constraint with an empty slate, teacher not invoked", async () => {
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

    await middleware.prepare?.(execution);

    expect(invokeTeacher).not.toHaveBeenCalled();
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      targetVocab: {
        introduce: [],
        reinforce: [],
        avoid: []
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

  // 090.10: this used to pin the PRESCRIPTION gate -- "no prescription, no
  // constraint". That gate is deleted; the Teacher must run for every
  // agentified turn. What still legitimately stops the middleware is having no
  // SCENE to be in, which is what this now pins.
  it("non-scripted mode with no scene returns without writing a constraint", async () => {
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
    // 090.4: activeQuestEssentialLemmas is no longer a TeacherContext field at
    // all (see the sibling test above); what this test actually protects is
    // that the VERIFIER's constraint channel stays empty for a non-focused turn.
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).not.toMatchObject({
      questEssentialLemmas: expect.anything()
    });
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
    // 090.4: quest-essential stopped being a channel INTO the Teacher --
    // services.teacher.invoke no longer takes activeQuestEssentialLemmas at
    // all; the Teacher derives its own quest-essential set from the situation
    // instead (see resolveQuestEssentialLemmaRefs). The annotation-fed set
    // asserted here still drives the VERIFIER's enforcement channel, which is
    // this constraint field.
    expect(execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION]).toMatchObject({
      questEssentialLemmas: [
        expect.objectContaining({
          lemmaRef: { lemmaId: "maleta", lang: "es" }
        })
      ]
    });
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

/**
 * 090.4: these tests used to pass a bare `vi.fn()` because the 087.6 branch meant
 * the teacher was never called. It is called now, so the fake has to return
 * something -- an undefined directive throws at the constraint assembly.
 */
function teacherDirectiveFixture() {
  return {
    targetVocab: { introduce: [], reinforce: [], avoid: [] },
    supportPosture: "supported" as const,
    targetLanguageRatio: 0.65,
    interactionStyle: "natural_dialogue" as const,
    glossingStrategy: "hover-only" as const,
    sentenceComplexityCap: "two-clause" as const,
    comprehensionCheck: { trigger: false, probeStyle: "none" as const, targetLemmas: [] },
    directiveLifetime: { maxTurns: 20, invalidateOn: [] },
    citedSignals: ["test"],
    rationale: "test",
    confidenceBand: "high" as const,
    isFallbackDirective: false
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

describe("SugarLangTeacherMiddleware -- the Teacher is on the path", () => {
  it("INVOKES the teacher even when a schedule is present", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue(teacherDirectiveFixture());
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule();

    await middleware.prepare?.(execution);

    // 090.4 INVERTED THIS ASSERTION. It used to read
    // `expect(invokeTeacher).not.toHaveBeenCalled()` -- the 087.6 branch built
    // the directive straight from `prescription` whenever a schedule existed and
    // the learner was not cold-start, which is nearly always. The thing named
    // "teacher middleware" never called the teacher.
    //
    // The branch is deleted. A schedule no longer suppresses judgment; it paces
    // it. This is the single assertion that the Teacher is back on the path.
    expect(invokeTeacher).toHaveBeenCalledTimes(1);
  });

  // 090.4 DELETED "schedule-driven directive has maxTurns=1". `maxTurns: 1` was
  // a property of the deterministic bypass -- free to recompute every turn
  // because it cost nothing. With the Teacher back on the path the lifetime
  // comes from the directive itself, and the situation key (090.3b) is what
  // decides when to re-plan. A per-turn recompute is now the thing to avoid,
  // not the thing to assert.

  it("publishes retrieveBiasTerms in the sugarlang contribution when schedule has active lemmas", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue(teacherDirectiveFixture());
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
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
    execution.annotations[SUGARLANG_SCHEDULE_ANNOTATION] = makeSchedule({ isColdStart: true });

    await middleware.prepare?.(execution);

    expect(invokeTeacher).toHaveBeenCalledTimes(1);
  });

  it("excludes fluency teachables from retrieveBiasTerms", async () => {
    const invokeTeacher = vi.fn().mockResolvedValue(teacherDirectiveFixture());
    const services = createServicesStub(makeScheduleServices(invokeTeacher));
    const middleware = createSugarLangTeacherMiddleware({ services: services as never });
    const execution = createTestExecution();
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
