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

import { describe, expect, it, vi } from "vitest";
import {
  ClaudeTeacherPolicy,
  TeacherInvocationError
} from "../../runtime/teacher/policies/llm-teacher-policy";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { FallbackTeacherPolicy } from "../../runtime/teacher/policies/fallback-teacher-policy";
import { SugarLangTeacher } from "../../runtime/teacher/sugar-lang-teacher";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import type { TeacherContext } from "../../runtime/types";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";

function createFacade() {
  return { cache: new DirectiveCache() };
}

describe("SugarLangTeacher", () => {
  it("short-circuits on cache hit", async () => {
    const { cache } = createFacade();
    cache.set(createDirectiveFixture());
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
    expect(cache.get()).toEqual(llmDirective);
  });

  it("falls back and caches when the LLM policy fails", async () => {
    const { cache } = createFacade();
    const llmPolicy = {
      invoke: vi.fn(async () => {
        throw new TeacherInvocationError("hard floor violated", "teacher-deferred-override");
      })
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });

    // The hard floor has to be reached by LEMMA AGE here, not by turn count.
    // The entry is shared by every NPC, so it is planned without the count of
    // turns since this conversation's last probe -- see sharedPlanContext. A
    // lemma pending since turn 3 with the session at turn 30 is 27 turns old,
    // past the 25-turn floor, and that floor reads the learner's own cards.
    const base = createTeacherContext();
    const directive = await teacher.invoke({
      ...base,
      learner: {
        ...base.learner,
        currentSession: { ...base.learner.currentSession!, turns: 30 }
      }
    });

    expect(directive.isFallbackDirective).toBe(true);
    expect(directive.comprehensionCheck.triggerReason).toBe(
      "teacher-deferred-override"
    );
    expect(cache.get()?.isFallbackDirective).toBe(true);
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

  it("plans the shared entry without the NPC that asked for it", async () => {
    // What comes back is written into the one entry every NPC reads, so it may
    // not be shaped by whichever conversation happened to miss the cache. The
    // turn keeps its own NPC -- only the plan call is narrowed.
    const { cache } = createFacade();
    const llmPolicy = {
      invoke: vi.fn(async (_context: TeacherContext) => createDirectiveFixture())
    };
    const teacher = new SugarLangTeacher({
      llmPolicy,
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });
    const base = createTeacherContext();

    await teacher.invoke({
      ...base,
      situation: {
        ...base.situation!,
        npc: {
          npcDefinitionId: "npc-finnick",
          displayName: "Finnick Thorn",
          lorePageId: null
        },
        recentTurns: [
          { turnId: "t1", speaker: "player", text: "hello" },
          { turnId: "t2", speaker: "npc", text: "hola" }
        ],
        turnsSinceLastProbe: 9
      }
    });

    const planned = llmPolicy.invoke.mock.calls[0]![0];
    expect(planned.situation?.npc).toBeUndefined();
    expect(planned.situation?.recentTurns).toBeUndefined();
    expect(planned.situation?.turnsSinceLastProbe).toBeUndefined();
    // The rest of the situation is untouched -- this narrows, it does not
    // rebuild.
    expect(planned.situation?.sceneId).toBe(base.situation?.sceneId);
  });

  it("refuses to serve a directive after dispose", async () => {
    // A region unloaded. A Teacher call started before it can still land ~10s
    // later, and its result must not become the next region's teaching.
    const { cache } = createFacade();
    const teacher = new SugarLangTeacher({
      llmPolicy: { invoke: vi.fn(async () => createDirectiveFixture()) },
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache
    });
    cache.set(createDirectiveFixture());

    teacher.dispose();

    expect(cache.peek()).toBeNull();
  });

  it("reports one decision per turn, whichever way the cache went", async () => {
    // ONE EVENT, ALL OUTCOMES. A rate needs numerator and denominator on the
    // same event -- the event this replaced fired only on hits, so it could
    // never show a regression.
    const telemetry = new MemoryTelemetrySink();
    const cache = new DirectiveCache();
    const teacher = new SugarLangTeacher({
      llmPolicy: { invoke: vi.fn(async () => createDirectiveFixture()) },
      fallbackPolicy: new FallbackTeacherPolicy(),
      cache,
      telemetry
    });
    const base = createTeacherContext();
    const here = { ...base, situationKey: "scene:dock|quest:q1|time:morning" };

    // Nothing cached: the turn waits.
    await teacher.invoke(here);
    // Now cached for these keys: the turn hits.
    await teacher.invoke(here);
    // The world moved: served stale.
    await teacher.invoke({
      ...here,
      situationKey: "scene:dock|quest:q2|time:evening"
    });

    const decisions = (await telemetry.query({
      eventKinds: ["directive-cache.decision"]
    })) as unknown as Array<{
      outcome: string;
      staleness: string | null;
      movedSegments: string[];
      teacherMs: number;
    }>;

    expect(decisions.map((entry) => entry.outcome)).toEqual([
      "blocking-miss",
      "hit",
      "stale-served"
    ]);
    expect(decisions[2]!.staleness).toBe("situation_change");
    // NAMES, NOT VALUES -- values are uuids and would not group across a fleet.
    expect(decisions[2]!.movedSegments.sort()).toEqual(["quest", "time"]);
    // A hit did not wait; the cold turn did.
    expect(decisions[1]!.teacherMs).toBe(0);
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
