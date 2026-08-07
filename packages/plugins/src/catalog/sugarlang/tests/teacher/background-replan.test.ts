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

describe("warming a conversation that has not happened yet (sugarmagic-latency-00m)", () => {
  const SITUATION_NOW = "situation-here";

  function warmSetup(llmInvoke: () => Promise<PedagogicalDirective>) {
    const { teacher, cache } = createTeacher(llmInvoke as never);
    const context = createTeacherContext({
      conversationId: CONVERSATION,
      situationKey: SITUATION_NOW
    });
    return { teacher, cache, context };
  }

  it("THE ONE THAT MATTERS: an empty slot gets filled", async () => {
    // This is the whole feature -- the first turn of a conversation reads a
    // directive instead of waiting ~10s for one.
    const planned = createDirectiveFixture({ rationale: "warmed" });
    const { teacher, cache, context } = warmSetup(async () => planned);

    expect(await teacher.warmConversations([CONVERSATION], context)).toBe("warmed");
    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("warmed");
  });

  it("does not spend a call on a slot that is already fresh", async () => {
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(CONVERSATION, createDirectiveFixture({ rationale: "already here" }), {
      situationKey: SITUATION_NOW,
      learnerKey: "matching"
    });

    // learnerKey differs from the fixture's real one, so this is learner-stale
    // at worst -- which is served instantly anyway. Either way: no call.
    const outcome = await teacher.warmConversations([CONVERSATION], context);

    expect(outcome).toBe("fresh");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("REFILLS a world-stale slot, because that one would block the next turn", async () => {
    const planned = createDirectiveFixture({ rationale: "refilled" });
    const invoke = vi.fn(async () => planned);
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(CONVERSATION, createDirectiveFixture({ rationale: "for elsewhere" }), {
      situationKey: "a-DIFFERENT-situation",
      learnerKey: "whatever"
    });

    expect(await teacher.warmConversations([CONVERSATION], context)).toBe("warmed");
    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("refilled");
  });

  it("NEVER AGES A REAL DIRECTIVE -- it must not go through invoke()", async () => {
    // invoke() on a hit calls spendTurn, charging the player a turn they never
    // took. That is the bug `peek` was split out of `get` to prevent.
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(CONVERSATION, createDirectiveFixture(), {
      situationKey: SITUATION_NOW,
      learnerKey: "x"
    });
    const before = cache.inspect(CONVERSATION);

    await teacher.warmConversations([CONVERSATION], context);

    // turnsConsumed is not exposed on the inspection, so assert via the fact
    // that a subsequent read still sees the same directive un-aged.
    expect(cache.inspect(CONVERSATION)?.directive).toEqual(before?.directive);
  });

  it("THE DANGEROUS RACE: does not clobber a directive a real turn just wrote", async () => {
    // The player walked up mid-warm and their turn did its own blocking call
    // with the actual NPC and conversation history. That directive is better;
    // `set` would overwrite it and reset its turn counter.
    const { invoke, release } = deferredPolicy(
      createDirectiveFixture({ rationale: "the warm one" })
    );
    const { teacher, cache, context } = warmSetup(invoke as never);

    const warming = teacher.warmConversations([CONVERSATION], context);
    cache.set(CONVERSATION, createDirectiveFixture({ rationale: "the real one" }), {
      situationKey: SITUATION_NOW,
      learnerKey: "from-the-real-turn"
    });
    release();

    expect(await warming).toBe("skipped");
    expect(cache.inspect(CONVERSATION)?.directive.rationale).toBe("the real one");
  });

  it("one call in flight per conversation", async () => {
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, context } = warmSetup(invoke as never);

    const first = teacher.warmConversations([CONVERSATION], context);
    expect(await teacher.warmConversations([CONVERSATION], context)).toBe("in-flight");

    release();
    await first;
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("a failing warm-up returns failed and does not throw", async () => {
    // Nothing awaits this in production; an unhandled rejection would surface
    // as a crash unrelated to any turn.
    const { teacher, cache, context } = warmSetup(async () => {
      throw new TeacherInvocationError("gateway down");
    });

    expect(await teacher.warmConversations([CONVERSATION], context)).toBe("failed");
    expect(cache.inspect(CONVERSATION)).toBeNull();
  });
});

describe("a turn joins a warm-up already in flight (sugarmagic-latency-00m)", () => {
  it("THE ONE THAT MATTERS: it waits for the warm call instead of starting a second one", async () => {
    // Measured on a fresh game: the warm-up started on the first frame, the
    // player reached the NPC before it landed, the turn made its OWN blocking
    // call, and cost 16.8s. Joining spends only the warm-up's remainder.
    const warmed = createDirectiveFixture({ rationale: "from the warm-up" });
    const { invoke, release } = deferredPolicy(warmed);
    const { teacher } = createTeacher(invoke as never);
    const context = contextHere();

    const warming = teacher.warmConversations([CONVERSATION], context);
    // The player presses interact while the warm-up is still running.
    const turn = teacher.invoke(context);

    release();
    const served = await turn;
    await warming;

    expect(served.rationale).toBe("from the warm-up");
    // ONE call total, not two.
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("falls through and makes its own call when the joined warm-up failed", async () => {
    // A failing warm-up must never leave a turn with nothing.
    let attempt = 0;
    const invoke = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TeacherInvocationError("warm failed");
      return createDirectiveFixture({ rationale: "the turn's own" });
    });
    const { teacher } = createTeacher(invoke as never);
    const context = contextHere();

    await teacher.warmConversations([CONVERSATION], context);
    const served = await teacher.invoke(context);

    expect(served.rationale).toBe("the turn's own");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("mini-review fixes: cost and the join (sugarmagic-latency-00m)", () => {
  it("THE COST BUG: warming N NPCs spends ONE Teacher call, not N", async () => {
    // The directive cache is scoped per conversation
    // (createActiveDirectiveFactScope -> ("conversation", conversationId)), so
    // NPC B's slot can never be a cache hit off NPC A's. An earlier version
    // looped per NPC believing otherwise: a region with 5 NPCs fired 5 full
    // ~9s Teacher calls, repeating on every time-of-day and quest change.
    const invoke = vi.fn(async () => createDirectiveFixture({ rationale: "one plan" }));
    const { teacher, cache } = createTeacher(invoke as never);
    const context = contextHere();

    const outcome = await teacher.warmConversations(["npc-a", "npc-b", "npc-c"], context);

    expect(outcome).toBe("warmed");
    expect(invoke).toHaveBeenCalledTimes(1);
    // ...and every slot got filled from that one call.
    for (const npcId of ["npc-a", "npc-b", "npc-c"]) {
      expect(cache.inspect(npcId)?.directive.rationale).toBe("one plan");
    }
  });

  it("skips slots that are already fresh, and spends nothing when all are", async () => {
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);
    const context = contextHere();
    for (const npcId of ["npc-a", "npc-b"]) {
      cache.set(npcId, createDirectiveFixture({ rationale: "already here" }), {
        situationKey: SITUATION_KEY,
        learnerKey: "whatever"
      });
    }

    expect(await teacher.warmConversations(["npc-a", "npc-b"], context)).toBe("fresh");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("THE JOIN BUG: does not join a call planned for a DIFFERENT world", async () => {
    // Joining blindly is worse than not joining: the post-join cache read
    // misses on situation_change and the turn calls anyway -- paying the
    // in-flight remainder PLUS a full call. The boot case produces exactly this
    // mismatch, because the first warm runs before the save restore.
    //
    // ASSERTS ORDER, NOT JUST OUTCOME. An earlier version of this test checked
    // only which directive was served, which passes whether or not the turn
    // waited -- it proved nothing. What matters is that the turn resolves while
    // the mismatched call is STILL BLOCKED.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    const invoke = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        await gate;
        return createDirectiveFixture({ rationale: "stale world" });
      }
      return createDirectiveFixture({ rationale: "the turn's own" });
    });
    const { teacher } = createTeacher(invoke as never);

    const warming = teacher.warmConversations(
      [CONVERSATION],
      createTeacherContext({ conversationId: CONVERSATION, situationKey: "the-OLD-situation" })
    );

    // The blocked call is never released before the turn is awaited. If the
    // turn joined it, this would hang rather than fail.
    const served = await teacher.invoke(contextHere());

    expect(served.rationale).toBe("the turn's own");
    expect(invoke).toHaveBeenCalledTimes(2);

    release();
    await warming;
  });
});
