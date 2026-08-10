/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/warm-region-teacher.test.ts
 *
 * Purpose: The region warmer runs rarely, warms once per world state, and
 *   re-warms when the world moves (sugarmagic-latency-00m).
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createRegionTeacherWarmer } from "../../runtime/teacher/warm-region-teacher";

function setup(keys: string[]) {
  let index = 0;
  const warm = vi.fn(async (_npcIds: readonly string[]) => "warmed");
  const warmer = createRegionTeacherWarmer({
    listWarmableNpcIds: () => ["npc-a", "npc-b"],
    buildWarmContext: async () => {
      const situationKey = keys[Math.min(index, keys.length - 1)]!;
      index += 1;
      return { situationKey, warmAll: warm };
    }
  });
  return { warmer, warm };
}

/** Lets the fire-and-forget chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("the region teacher warmer", () => {
  it("does not run on every frame", async () => {
    const { warmer, warm } = setup(["k1"]);
    // 16ms frames: a second of gameplay must not trigger 60 checks.
    for (let i = 0; i < 60; i++) warmer.tick(16);
    await settle();
    // EXACTLY one. `toBeLessThanOrEqual(1)` passed at zero, so a warmer that
    // never warmed at all would have satisfied its own throttle test.
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("THE ONE THAT MATTERS: warms every NPC in the region once", async () => {
    const { warmer, warm } = setup(["k1"]);
    warmer.tick(2000);
    await settle();
    // ONE call, handed every id at once -- not one call per NPC.
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0]![0]).toEqual(["npc-a", "npc-b"]);
  });

  it("does not re-warm while the world is unchanged", async () => {
    const { warmer, warm } = setup(["k1"]);
    warmer.tick(2000);
    await settle();
    warmer.tick(2000);
    await settle();
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("RE-WARMS when the world moves -- which is also how a pre-restore warm self-corrects", async () => {
    // Plugin init runs before the save restore, so the first key can be
    // computed against default "morning" and a null quest. The key moving is
    // what corrects it.
    const { warmer, warm } = setup(["pre-restore", "after-restore"]);
    warmer.tick(2000);
    await settle();
    warmer.tick(2000);
    await settle();
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a re-warm -- for a conversation that may have advanced a quest", async () => {
    const { warmer, warm } = setup(["k1"]);
    warmer.tick(2000);
    await settle();
    warmer.invalidate();
    warmer.tick(2000);
    await settle();
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("never overlaps two runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const warm = vi.fn(async (_npcIds: readonly string[]) => {
      await gate;
      return "warmed";
    });
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    warmer.tick(2000);
    await settle();
    warmer.tick(2000);
    await settle();

    expect(warm).toHaveBeenCalledTimes(1);
    release();
  });

  it("stops after dispose, so a region unload cannot write into a dead blackboard", async () => {
    const { warmer, warm } = setup(["k1"]);
    warmer.dispose();
    warmer.tick(2000);
    await settle();
    expect(warm).not.toHaveBeenCalled();
  });

  it("does nothing when the world is not ready to be asked", async () => {
    const warm = vi.fn(async (_npcIds: readonly string[]) => "warmed");
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => null
    });
    warmer.tick(2000);
    await settle();
    expect(warm).not.toHaveBeenCalled();
  });
});

describe("mini-review: a failed warm is retried -- A BOUNDED number of times", () => {
  it("does not remember a world state whose warm failed", async () => {
    // Marking it regardless meant a gateway outage was recorded as "done" and
    // never retried until the world moved -- which, on a region fixed for the
    // session, can be the rest of the session.
    const warm = vi.fn(async (_npcIds: readonly string[]) => "failed");
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    warmer.tick(2000);
    await settle();
    warmer.tick(2000);
    await settle();

    expect(warm).toHaveBeenCalledTimes(2);
  });

  it("does remember one that succeeded", async () => {
    const warm = vi.fn(async (_npcIds: readonly string[]) => "warmed");
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    warmer.tick(2000);
    await settle();
    warmer.tick(2000);
    await settle();

    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("THE PROD INCIDENT: a warm that keeps failing STOPS, it does not bill for ever", async () => {
    // Shipped behaviour: a failed warm never recorded its key, so the next
    // check saw the same unwarmed state and called again -- every 2 seconds,
    // for ever, each one a paid Teacher call. In prod the gateway answered
    // 401 and it billed until the browser was closed.
    const warm = vi.fn(async (_npcIds: readonly string[]) => "failed");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    // Five minutes of a broken gateway.
    for (let i = 0; i < 150; i++) {
      warmer.tick(2000);
      await settle();
    }

    expect(warm).toHaveBeenCalledTimes(3);
    // Loud once, not once per tick -- a log spammed 150 times is a second bug.
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it("a warm that THROWS is bounded too, not just one that returns 'failed'", async () => {
    // The budget is spent before the call for exactly this reason: a throwing
    // path that never reached the outcome check would retry for ever.
    const warm = vi.fn(async (_npcIds: readonly string[]) => {
      throw new Error("gateway 401");
    });
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    for (let i = 0; i < 50; i++) {
      warmer.tick(2000);
      await settle();
    }

    expect(warm).toHaveBeenCalledTimes(3);
  });

  it("a world that MOVES gets a fresh budget -- giving up is per world state", async () => {
    // Bounding globally would mean one bad patch permanently disabled warming
    // for the session. The thing that failed is one situation.
    const warm = vi.fn(async (_npcIds: readonly string[]) => "failed");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let key = "k1";
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: key, warmAll: warm })
    });

    for (let i = 0; i < 20; i++) {
      warmer.tick(2000);
      await settle();
    }
    expect(warm).toHaveBeenCalledTimes(3);

    key = "k2";
    for (let i = 0; i < 20; i++) {
      warmer.tick(2000);
      await settle();
    }
    expect(warm).toHaveBeenCalledTimes(6);
    errors.mockRestore();
  });

  it("invalidate() clears a spent budget, so a forced re-warm really re-warms", async () => {
    let outcome = "failed";
    const warm = vi.fn(async (_npcIds: readonly string[]) => outcome);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warmer = createRegionTeacherWarmer({
      listWarmableNpcIds: () => ["npc-a"],
      buildWarmContext: async () => ({ situationKey: "k1", warmAll: warm })
    });

    for (let i = 0; i < 20; i++) {
      warmer.tick(2000);
      await settle();
    }
    expect(warm).toHaveBeenCalledTimes(3);

    // The gateway comes back and something forces a re-warm.
    outcome = "warmed";
    warmer.invalidate();
    warmer.tick(2000);
    await settle();

    expect(warm).toHaveBeenCalledTimes(4);
    errors.mockRestore();
  });
});
