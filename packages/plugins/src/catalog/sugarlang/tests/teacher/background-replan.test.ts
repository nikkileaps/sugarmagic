/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/background-replan.test.ts
 *
 * Purpose: The Teacher runs off the critical path when -- and only when -- the
 *   staleness is safe to answer a turn late (sugarmagic-latency-7gp.1).
 *
 * Status: active
 */

import { beginTurnTimeline, endTurnTimeline } from "@sugarmagic/runtime-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { SugarLangTeacher } from "../../runtime/teacher/sugar-lang-teacher";
import { TeacherInvocationError } from "../../runtime/teacher/policies/llm-teacher-policy";
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
  const cache = new DirectiveCache();
  const teacher = new SugarLangTeacher({
    llmPolicy: { invoke: llmInvoke } as never,
    fallbackPolicy: {
      invoke: vi.fn(async () => createDirectiveFixture({ isFallbackDirective: true }))
    } as never,
    cache
  });
  return { teacher, cache };
}

/** Lets a scheduled background promise chain run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

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
    cache.set(outgoing, {
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
    expect(cache.inspect()?.directive.rationale).toBe("the replacement");
  });

  it("a WORLD change is served stale too, and re-planned behind the turn", async () => {
    // This used to block. The player waited ~11s so the plan would be about
    // where they are -- and the cost of not waiting is only that the Teacher
    // picks what to teach from a slightly old read of the world for a turn or
    // three. The directive never reaches the player; it biases word choice.
    const outgoing = createDirectiveFixture({ rationale: "planned for elsewhere" });
    const replacement = createDirectiveFixture({ rationale: "planned for here" });
    const { invoke, release } = deferredPolicy(replacement);
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(outgoing, {
      situationKey: "a-DIFFERENT-situation",
      learnerKey: "same"
    });

    // The re-plan never settles before this resolves. If the turn waited for
    // it, this would hang rather than fail.
    const served = await teacher.invoke(context);

    expect(served.rationale).toBe("planned for elsewhere");
    expect(invoke).toHaveBeenCalledTimes(1);

    release();
    await settle();

    // AND IT LANDS. Serving stale is only half the design -- if the
    // replacement is not written back, every later turn serves the same
    // outdated directive and spends another Teacher call to discard.
    expect(cache.inspect()?.directive.rationale).toBe("planned for here");
    expect(cache.inspect()?.plannedFor.situationKey).toBe(SITUATION_KEY);

    // A second turn now hits instead of re-planning again.
    const secondTurn = await teacher.invoke(context);
    expect(secondTurn.rationale).toBe("planned for here");
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
    cache.set(outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    await teacher.invoke(context); // serves stale, schedules the re-plan

    // Meanwhile the world moves and something writes the correct plan for it.
    const correctForNewPlace = createDirectiveFixture({ rationale: "correct for the NEW place" });
    cache.set(correctForNewPlace, {
      situationKey: "the-new-situation",
      learnerKey: "learner-key-NOW"
    });

    release();
    await settle();

    expect(cache.inspect()?.directive.rationale).toBe("correct for the NEW place");
  });

  it("two turns inside one re-plan window spend exactly one Teacher call", async () => {
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(outgoing, {
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
    cache.set(outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    const served = await teacher.invoke(context);
    await settle();

    expect(served.rationale).toBe("outgoing");
    // NOT swapped for a fallback directive: a fallback is a different quality
    // of teaching, and the real outgoing plan beats it.
    expect(cache.inspect()?.directive.rationale).toBe("outgoing");
  });

  it("does not resurrect a directive for a conversation that ended", async () => {
    const outgoing = createDirectiveFixture({ rationale: "outgoing" });
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);

    const context = contextHere();
    cache.set(outgoing, {
      situationKey: SITUATION_KEY,
      learnerKey: "learner-key-BEFORE"
    });

    await teacher.invoke(context);
    cache.invalidate(); // the conversation ends

    release();
    await settle();

    expect(cache.inspect()).toBeNull();
  });
});

describe("how long a stale directive may be served", () => {
  beforeEach(() => {
    beginTurnTimeline("test");
  });
  afterEach(() => {
    endTurnTimeline();
    vi.restoreAllMocks();
  });

  /** A stale entry the next turn will be offered. */
  function seedStale(cache: DirectiveCache, rationale = "outgoing"): void {
    cache.set(createDirectiveFixture({ rationale }), {
      situationKey: "an-OLD-situation",
      learnerKey: "old"
    });
  }

  it("THE BOUND: blocks once three re-plans in a row have FAILED", async () => {
    // Without this, a gateway that stays down means every turn for the rest of
    // the session is taught from a plan for somewhere the player has left --
    // which is the failure the old blocking rule existed to prevent.
    const invoke = vi.fn(async () => {
      throw new TeacherInvocationError("gateway down");
    });
    const { teacher, cache } = createTeacher(invoke as never);

    for (let turn = 1; turn <= 3; turn++) {
      seedStale(cache);
      const served = await teacher.invoke(contextHere());
      await settle();
      expect(served.rationale).toBe("outgoing");
    }
    expect(invoke).toHaveBeenCalledTimes(3);

    // The fourth turn stops serving stale. It calls, that call fails too, and
    // the player gets the deterministic fallback rather than an old plan.
    seedStale(cache);
    const blocked = await teacher.invoke(contextHere());

    expect(blocked.isFallbackDirective).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("THE SAD CASE: a blocked turn that also fails serves the fallback, and caches it", async () => {
    // The Teacher is still down when the bound trips. The stale plan is gone,
    // so the turn gets deterministic teaching -- and that fallback is cached
    // for the CURRENT world, which is what stops the next few turns from each
    // paying for another failing call.
    const invoke = vi.fn(async () => {
      throw new TeacherInvocationError("gateway down");
    });
    const { teacher, cache } = createTeacher(invoke as never);

    for (let turn = 1; turn <= 3; turn++) {
      seedStale(cache);
      await teacher.invoke(contextHere());
      await settle();
    }

    seedStale(cache);
    const blocked = await teacher.invoke(contextHere());
    expect(blocked.isFallbackDirective).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);

    // The fallback is now the entry, planned for where the player IS, so the
    // turns after it are hits rather than four more failing calls.
    const next = await teacher.invoke(contextHere());
    expect(next.isFallbackDirective).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("LATENCY IS NOT FAILURE: turns inside ONE slow re-plan never trip it", async () => {
    // A fast player can send three turns inside an ~11s call. Counting those as
    // failures would turn a healthy slow re-plan into the blocking wait this
    // story exists to remove.
    const { invoke, release } = deferredPolicy(
      createDirectiveFixture({ rationale: "the replacement" })
    );
    const { teacher, cache } = createTeacher(invoke as never);
    seedStale(cache);

    for (let turn = 1; turn <= 4; turn++) {
      const served = await teacher.invoke(contextHere());
      expect(served.rationale).toBe("outgoing");
    }
    // ONE call for all four turns, and none of them waited for it.
    expect(invoke).toHaveBeenCalledTimes(1);

    release();
    await settle();
  });

  it("a re-plan that succeeds clears the count", async () => {
    let attempt = 0;
    const invoke = vi.fn(async () => {
      attempt += 1;
      if (attempt <= 2) throw new TeacherInvocationError("blip");
      return createDirectiveFixture({ rationale: "recovered" });
    });
    const { teacher, cache } = createTeacher(invoke as never);

    // Two failures, then one that works.
    for (let turn = 1; turn <= 3; turn++) {
      seedStale(cache);
      await teacher.invoke(contextHere());
      await settle();
    }

    // Back to zero, so the next stale turn is served rather than blocked --
    // proven by it not calling again.
    seedStale(cache);
    const served = await teacher.invoke(contextHere());
    await settle();

    expect(served.rationale).toBe("outgoing");
    expect(invoke).toHaveBeenCalledTimes(4);
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

    expect(await teacher.warmRegion(context)).toBe("warmed");
    expect(cache.inspect()?.directive.rationale).toBe("warmed");
  });

  it("does not spend a call on a slot that is already fresh", async () => {
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(createDirectiveFixture({ rationale: "already here" }), {
      situationKey: SITUATION_NOW,
      learnerKey: "matching"
    });

    // learnerKey differs from the fixture's real one, so this is learner-stale
    // at worst -- which is served instantly anyway. Either way: no call.
    const outcome = await teacher.warmRegion(context);

    expect(outcome).toBe("fresh");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("REFILLS a world-stale slot, because that one would block the next turn", async () => {
    const planned = createDirectiveFixture({ rationale: "refilled" });
    const invoke = vi.fn(async () => planned);
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(createDirectiveFixture({ rationale: "for elsewhere" }), {
      situationKey: "a-DIFFERENT-situation",
      learnerKey: "whatever"
    });

    expect(await teacher.warmRegion(context)).toBe("warmed");
    expect(cache.inspect()?.directive.rationale).toBe("refilled");
  });

  it("NEVER AGES A REAL DIRECTIVE -- it must not go through invoke()", async () => {
    // invoke() on a hit calls spendTurn, charging the player a turn they never
    // took. That is the bug `peek` was split out of `get` to prevent.
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache, context } = warmSetup(invoke as never);
    cache.set(createDirectiveFixture(), {
      situationKey: SITUATION_NOW,
      learnerKey: "x"
    });
    // WATCH THE AGEING CALL ITSELF. The previous version compared the directive
    // object before and after, which is identical whether or not the turn
    // counter moved -- it asserted nothing and passed with the bug present.
    const spendTurn = vi.spyOn(cache, "spendTurn");

    await teacher.warmRegion(context);

    expect(spendTurn).not.toHaveBeenCalled();
  });

  it("THE DANGEROUS RACE: does not clobber a directive a real turn just wrote", async () => {
    // The player walked up mid-warm and their turn did its own blocking call
    // with the actual NPC and conversation history. That directive is better;
    // `set` would overwrite it and reset its turn counter.
    const { invoke, release } = deferredPolicy(
      createDirectiveFixture({ rationale: "the warm one" })
    );
    const { teacher, cache, context } = warmSetup(invoke as never);

    const warming = teacher.warmRegion(context);
    cache.set(createDirectiveFixture({ rationale: "the real one" }), {
      situationKey: SITUATION_NOW,
      learnerKey: "from-the-real-turn"
    });
    release();

    expect(await warming).toBe("skipped");
    expect(cache.inspect()?.directive.rationale).toBe("the real one");
  });

  it("one call in flight per situation", async () => {
    const { invoke, release } = deferredPolicy(createDirectiveFixture());
    const { teacher, context } = warmSetup(invoke as never);

    const first = teacher.warmRegion(context);
    expect(await teacher.warmRegion(context)).toBe("in-flight");

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

    expect(await teacher.warmRegion(context)).toBe("failed");
    expect(cache.inspect()).toBeNull();
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

    const warming = teacher.warmRegion(context);
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

    await teacher.warmRegion(context);
    const served = await teacher.invoke(context);

    expect(served.rationale).toBe("the turn's own");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("mini-review fixes: cost and the join (sugarmagic-latency-00m)", () => {
  it("THE COST BUG: warming a region of NPCs spends ONE Teacher call, not N", async () => {
    // One entry serves everyone standing in the region, so warming is one call
    // and one write. An early version looped per NPC while the cache was scoped
    // per conversation: a region with 5 NPCs fired 5 full ~9s Teacher calls,
    // repeating on every time-of-day and quest change.
    const invoke = vi.fn(async () => createDirectiveFixture({ rationale: "one plan" }));
    const { teacher, cache } = createTeacher(invoke as never);
    const context = contextHere();

    const outcome = await teacher.warmRegion(context);

    expect(outcome).toBe("warmed");
    expect(invoke).toHaveBeenCalledTimes(1);
    // ...and it is what any NPC's first turn reads.
    expect(cache.inspect()?.directive.rationale).toBe("one plan");
  });

  it("spends nothing when the entry is already fresh", async () => {
    const invoke = vi.fn(async () => createDirectiveFixture());
    const { teacher, cache } = createTeacher(invoke as never);
    const context = contextHere();
    cache.set(createDirectiveFixture({ rationale: "already here" }), {
      situationKey: SITUATION_KEY,
      learnerKey: "whatever"
    });

    expect(await teacher.warmRegion(context)).toBe("fresh");
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

    const warming = teacher.warmRegion(
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

describe("mini-review round 2: the warm write is a compare-and-set", () => {
  it("THE INVERTED GUARD: does not overwrite a directive written for a NEWER world", async () => {
    // The old check asked `inspect(id, warmKeys).staleness !== "situation_change"`.
    // When a real turn wrote a directive for a NEWER situation, inspecting with
    // the older warm keys reports exactly situation_change -- so the guard read
    // "slot is free" and clobbered the better directive. This is the case the
    // guard was named for and the one it got backwards.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const invoke = vi.fn(async () => {
      await gate;
      return createDirectiveFixture({ rationale: "the stale warm" });
    });
    const { teacher, cache } = createTeacher(invoke as never);

    const warming = teacher.warmRegion(contextHere());

    // The world moves and a real turn writes a directive for the new one.
    cache.set(createDirectiveFixture({ rationale: "newer, for the new world" }), {
      situationKey: "the-NEW-situation",
      learnerKey: "from-the-real-turn"
    });

    release();
    expect(await warming).toBe("skipped");
    expect(cache.inspect()?.directive.rationale).toBe("newer, for the new world");
  });

  it("still refills a slot nothing else claimed", async () => {
    // The guard must not over-correct into never writing.
    const invoke = vi.fn(async () => createDirectiveFixture({ rationale: "refilled" }));
    const { teacher, cache } = createTeacher(invoke as never);
    cache.set(createDirectiveFixture({ rationale: "for elsewhere" }), {
      situationKey: "an-OLD-situation",
      learnerKey: "x"
    });

    expect(await teacher.warmRegion(contextHere())).toBe("warmed");
    expect(cache.inspect()?.directive.rationale).toBe("refilled");
  });
});
