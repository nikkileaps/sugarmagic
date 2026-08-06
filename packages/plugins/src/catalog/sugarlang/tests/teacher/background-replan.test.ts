/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/background-replan.test.ts
 *
 * Purpose: The Teacher runs off the critical path when -- and only when -- the
 *   staleness is safe to answer a turn late (sugarmagic-latency-7gp.1).
 *
 * Status: active
 */

import {
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  createRuntimeBlackboard,
  beginTurnTimeline,
  endTurnTimeline
} from "@sugarmagic/runtime-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { SugarLangTeacher } from "../../runtime/teacher/sugar-lang-teacher";
import { isDeferrableStaleness } from "../../runtime/teacher/staleness-policy";
import { TeacherInvocationError } from "../../runtime/teacher/policies/llm-teacher-policy";
import { SUGARLANG_BLACKBOARD_FACT_DEFINITIONS } from "../../runtime/learner/fact-definitions";
import { createDirectiveFixture, createTeacherContext } from "./test-helpers";
import type { PedagogicalDirective } from "../../runtime/types";

const CONVERSATION = "conversation-1";
const SITUATION_KEY = "situation-here";

/**
 * The shared fixture does not set `situationKey`, but the teacher middleware
 * always does (it composes one from the situation). Without it the world axis
 * is never checked and every staleness reads as a learner change -- which is
 * exactly the mistake that made the world-change test pass a stale plan.
 */
function contextHere(overrides: Record<string, unknown> = {}) {
  return createTeacherContext({
    conversationId: CONVERSATION,
    situationKey: SITUATION_KEY,
    ...overrides
  });
}

/** A re-plan that never settles until the test releases it. */
function deferredPolicy(directive: PedagogicalDirective) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.fn(async () => {
    await gate;
    return directive;
  });
  return { invoke, release, gate };
}

function createTeacher(llmInvoke: (...args: never[]) => Promise<PedagogicalDirective>) {
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
    ]
  });
  const cache = new DirectiveCache({ blackboard, now: () => 1000 });
  const teacher = new SugarLangTeacher({
    llmPolicy: { invoke: llmInvoke } as never,
    fallbackPolicy: {
      invoke: vi.fn(async () => createDirectiveFixture({ isFallbackDirective: true }))
    } as never,
    cache
  });
  return { teacher, cache, blackboard };
}

/** Lets a scheduled background promise chain run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe("the staleness policy", () => {
  it("defers the learner axis and blocks every world axis", () => {
    expect(isDeferrableStaleness("learner_change")).toBe(true);
    expect(isDeferrableStaleness("max_turns_exceeded")).toBe(true);

    // Serving a stale plan after the world moved would have the NPC teaching
    // dock words in a forest. These must keep the player waiting.
    expect(isDeferrableStaleness("situation_change")).toBe(false);
    expect(isDeferrableStaleness("quest_stage_change")).toBe(false);
    expect(isDeferrableStaleness("location_change")).toBe(false);
    expect(isDeferrableStaleness("player_code_switch")).toBe(false);
    expect(isDeferrableStaleness("manual")).toBe(false);
  });
});

describe("running the Teacher off the critical path", () => {
  beforeEach(() => {
    beginTurnTimeline("test");
  });
  afterEach(() => {
    endTurnTimeline();
    vi.restoreAllMocks();
  });

  it("THE ONE THAT MATTERS: a learner change serves the outgoing plan without waiting", async () => {
    // Before this story the player sat through an ~11s re-plan here. Now the
    // turn returns the plan already in hand and the replacement is written
    // while they read and type.
    const outgoing = createDirectiveFixture({ rationale: "the outgoing plan" });
    const replacement = createDirectiveFixture({ rationale: "the replacement" });
    const { invoke, release } = deferredPolicy(replacement);
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    // The re-plan is still in flight, so if invoke() were awaited this would
    // never resolve.
    const served = await teacher.invoke(context);

    expect(served.rationale).toBe("the outgoing plan");
    expect(invoke).toHaveBeenCalledTimes(1);

    release();
    await settle();
    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("the replacement");
  });

  it("a world change STILL blocks: the player waits for the right place", async () => {
    const outgoing = createDirectiveFixture({ rationale: "planned for elsewhere" });
    const replacement = createDirectiveFixture({ rationale: "planned for here" });
    const invoke = vi.fn(async () => replacement);
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: "a-DIFFERENT-situation",
      learnerKey: "same"
    });

    const served = await teacher.invoke(context);

    expect(served.rationale).toBe("planned for here");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("THE DANGEROUS ONE: a re-plan landing after the world moved is discarded", async () => {
    // The player walked into a new scene while a learner-change re-plan was in
    // flight. That result was planned for where they WERE. Writing it would
    // reintroduce the exact bug the blocking split exists to prevent.
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const stalePlan = createDirectiveFixture({ rationale: "planned for the OLD place" });
    const { invoke, release } = deferredPolicy(stalePlan);
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    await teacher.invoke(context); // serves stale, schedules the re-plan

    // Meanwhile the world moves and something writes the correct plan for it.
    const correctForNewPlace = createDirectiveFixture({ rationale: "correct for the NEW place" });
    cache.set(CONVERSATION, correctForNewPlace, {
      situationKey: "the-new-situation",
      learnerKey: "learner-key-NOW"
    });

    release();
    await settle();

    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("correct for the NEW place");
  });

  it("two turns inside one re-plan window spend exactly one Teacher call", async () => {
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    await teacher.invoke(context);
    await teacher.invoke(context);
    await teacher.invoke(context);

    expect(invoke).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it("a failed re-plan leaves the outgoing plan in place and does not throw", async () => {
    // Fire-and-forget means nothing is awaiting this. An unhandled rejection
    // would surface as a crash unrelated to any turn.
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const invoke = vi.fn(async () => {
      throw new TeacherInvocationError("gateway down");
    });
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    const served = await teacher.invoke(context);
    await settle();

    expect(served.rationale).toBe("outgoing");
    // NOT swapped for a fallback directive: a fallback is a different quality
    // of teaching, and the real outgoing plan beats it.
    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("outgoing");
  });

  it("does not resurrect a directive for a conversation that ended", async () => {
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(CONVERSATION, outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    await teacher.invoke(context);
    cache.invalidate(CONVERSATION, "manual"); // the conversation ends

    release();
    await settle();

    expect(cache.inspect(CONVERSATION)).toBeNull();
  });
});
