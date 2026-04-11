/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/sugar-lang-teacher.test.ts
 *
 * Purpose: Verifies the teacher facade's cache, LLM policy, fallback, and calibration wiring.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/sugar-lang-teacher with mock policies and a real cache.
 *   - Treats the facade as the canonical entry point for downstream middleware.
 *
 * Implements: Epic 9 Story 9.7
 *
 * Status: active
 */

import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createRuntimeBlackboard
} from "@sugarmagic/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeTeacherPolicy,
  TeacherInvocationError
} from "../../runtime/teacher/policies/llm-teacher-policy";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { FallbackTeacherPolicy } from "../../runtime/teacher/policies/fallback-teacher-policy";
import { SugarLangTeacher } from "../../runtime/teacher/sugar-lang-teacher";
import { SUGARLANG_BLACKBOARD_FACT_DEFINITIONS } from "../../runtime/learner/fact-definitions";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";

function createFacade() {
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
    ]
  });
  const cache = new DirectiveCache({ blackboard, now: () => 1000 });
  return { blackboard, cache };
}

describe("SugarLangTeacher", () => {
  it("short-circuits on cache hit", async () => {
    const { cache } = createFacade();
    cache.set("conversation-1", createDirectiveFixture());
    const llmPolicy = {
      invoke: vi.fn(async () => createDirectiveFixture())
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });

    const directive = await teacher.invoke(createTeacherContext());
    expect(llmPolicy.invoke).not.toHaveBeenCalled();
    expect(directive.isFallbackDirective).toBe(false);
  });

  it("returns and caches a successful LLM directive", async () => {
    const { cache } = createFacade();
    const llmDirective = createDirectiveFixture({
      rationale: "LLM success."
    });
    const llmPolicy = {
      invoke: vi.fn(async () => llmDirective)
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });

    const directive = await teacher.invoke(createTeacherContext());
    expect(directive.rationale).toBe("LLM success.");
    expect(cache.get("conversation-1")).toEqual(llmDirective);
  });

  it("falls back and caches when the LLM policy fails", async () => {
    const { cache } = createFacade();
    const llmPolicy = {
      invoke: vi.fn(async () => {
        throw new TeacherInvocationError("hard floor violated", "director-deferred-override");
      })
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });

    const directive = await teacher.invoke(
      createTeacherContext({
        probeFloorState: {
          turnsSinceLastProbe: 30,
          totalPendingLemmas: 3,
          softFloorReached: true,
          hardFloorReached: true,
          hardFloorReason: "turns-since-probe"
        }
      })
    );

    expect(directive.isFallbackDirective).toBe(true);
    expect(directive.comprehensionCheck.triggerReason).toBe(
      "director-deferred-override"
    );
    expect(cache.get("conversation-1")?.isFallbackDirective).toBe(true);
  });

  it("flows calibration state through before Claude invocation", async () => {
    const { cache } = createFacade();
    const llmPolicy = {
      invoke: vi.fn(async (context) => {
        expect(context.calibrationActive).toBe(true);
        return createDirectiveFixture();
      })
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });
    const context = createTeacherContext();
    context.learner.assessment.cefrConfidence = 0.4;
    context.learner.currentSession!.turns = 3;

    await teacher.invoke(context);
    expect(llmPolicy.invoke).toHaveBeenCalledTimes(1);
  });

  it("supports an end-to-end mocked LLM policy path", async () => {
    const { cache } = createFacade();
    const llmPolicy = new ClaudeTeacherPolicy({
      client: {
        generateStructuredDirective: vi.fn(async () => ({
          text: JSON.stringify(createDirectiveFixture())
        }))
      }
    });
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });

    const directive = await teacher.invoke(createTeacherContext());
    expect(directive.isFallbackDirective).toBe(false);
  });
});
