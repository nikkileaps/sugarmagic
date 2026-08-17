/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/directive-cache.test.ts
 *
 * Purpose: Verifies the in-memory directive store -- what it serves, when it
 *   retires an entry, and what it refuses after teardown.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/teacher/directive-cache.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { DirectiveCache } from "../../runtime/teacher/directive-cache";
import { createDirectiveFixture } from "./test-helpers";

describe("DirectiveCache", () => {
  it("returns a directive while still within maxTurns", () => {
    const cache = new DirectiveCache();
    const directive = createDirectiveFixture();
    cache.set(directive);

    expect(cache.get()).toEqual(directive);
    expect(cache.get()).toEqual(directive);
  });

  it("expires after maxTurns is exceeded", () => {
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture());

    expect(cache.get()).not.toBeNull();
    expect(cache.get()).not.toBeNull();
    expect(cache.get()).not.toBeNull();
    expect(cache.get()).toBeNull();
  });

  it("retires a directive when the situation key moves", () => {
    // The situation is the axis. A decision made for a different situation is
    // WRONG, not merely old, so it goes however few turns it has consumed.
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture(), {
      situationKey: "scene:dock|quest:q1/stage-1"
    });

    expect(cache.get({ situationKey: "scene:dock|quest:q1/stage-1" })).not.toBeNull();
    expect(cache.get({ situationKey: "scene:dock|quest:q1/stage-2" })).toBeNull();
  });

  it("keeps a directive across turns while the situation is unchanged", () => {
    // The lifecycle claim: an unchanged situation does not re-slate. Four reads
    // on a maxTurns-3 fixture would otherwise have expired it; the key holds it
    // alive until the backstop, which is what the backstop is for.
    const cache = new DirectiveCache();
    const situationKey = "scene:dock|quest:q1/stage-1";
    cache.set(createDirectiveFixture(), { situationKey });

    expect(cache.peek({ situationKey })).not.toBeNull();
    expect(cache.peek({ situationKey })).not.toBeNull();
    expect(cache.peek({ situationKey })).not.toBeNull();
    expect(cache.peek({ situationKey })).not.toBeNull();
  });

  it("an unverifiable directive is not treated as matching", () => {
    // A directive written with no situation key cannot be checked. That must
    // not read as "still valid" -- it falls through to the turn backstop.
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture());

    expect(cache.get({ situationKey: "any-key" })).not.toBeNull();
    expect(cache.get({ situationKey: "any-key" })).not.toBeNull();
    expect(cache.get({ situationKey: "any-key" })).not.toBeNull();
    expect(cache.get({ situationKey: "any-key" })).toBeNull();
  });

  it("peek reads without spending a turn; get spends one", () => {
    // turnsConsumed used to increment inside the read, so merely LOOKING at a
    // directive spent a turn the player never took.
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture());

    cache.peek();
    cache.peek();
    cache.peek();
    cache.peek();
    expect(cache.peek()).not.toBeNull();

    cache.get();
    cache.get();
    cache.get();
    expect(cache.get()).toBeNull();
  });

  it("retires a directive when the LEARNER changes, independently of the situation", () => {
    // The whole point of two keys. The world is identical -- same scene, same
    // quest, same hour -- but the learner produced a word and its ItemProgress
    // flipped. That is a reason to re-decide, and with a single merged key it
    // would have been indistinguishable from the player walking somewhere.
    const cache = new DirectiveCache();
    const situationKey = "scene:dock|quest:q1/stage-1";
    cache.set(createDirectiveFixture(), {
      situationKey,
      learnerKey: "before-queso-landed"
    });

    expect(
      cache.peek({ situationKey, learnerKey: "before-queso-landed" })
    ).not.toBeNull();
    expect(cache.peek({ situationKey, learnerKey: "after-queso-landed" })).toBeNull();
  });

  it("reports the world reason when both axes moved", () => {
    // Order matters: a directive stale on both must be reported as the
    // blocking reason, never the deferrable one.
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture(), {
      situationKey: "scene:dock",
      learnerKey: "k1"
    });

    expect(
      cache.inspect({ situationKey: "scene:platform", learnerKey: "k2" })?.staleness
    ).toBe("situation_change");
  });

  it("serves ONE entry to every NPC that asks", () => {
    // The keys have no NPC axis, so there is one directive for the region --
    // this is what makes a single warm call enough for everyone standing in it.
    const cache = new DirectiveCache();
    const directive = createDirectiveFixture();
    const situationKey = "scene:dock|quest:q1/stage-1";
    cache.set(directive, { situationKey });

    expect(cache.peek({ situationKey })).toEqual(directive);
    expect(cache.peek({ situationKey })).toEqual(directive);
  });

  it("counts turns across every NPC the entry serves", () => {
    // The backstop measures the ENTRY's life, not one conversation's. Three
    // turns spread over three NPCs exhaust a maxTurns-3 directive exactly as
    // three turns with one NPC would.
    const cache = new DirectiveCache();
    const situationKey = "scene:dock";
    cache.set(createDirectiveFixture(), { situationKey });

    expect(cache.get({ situationKey })).not.toBeNull();
    expect(cache.get({ situationKey })).not.toBeNull();
    expect(cache.get({ situationKey })).not.toBeNull();
    expect(cache.get({ situationKey })).toBeNull();
  });

  it("supports manual invalidation", () => {
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture());
    cache.invalidate();

    expect(cache.get()).toBeNull();
  });

  it("drops what it holds when disposed", () => {
    const cache = new DirectiveCache();
    cache.set(createDirectiveFixture());
    cache.dispose();

    expect(cache.get()).toBeNull();
  });

  it("refuses a write that lands after dispose", () => {
    // A Teacher call takes ~10s, so one started before the region unloaded can
    // land after it. Its result must not become the next region's teaching.
    const cache = new DirectiveCache();
    cache.dispose();
    cache.set(createDirectiveFixture());

    expect(cache.peek()).toBeNull();
    expect(cache.inspect()).toBeNull();
  });
});
