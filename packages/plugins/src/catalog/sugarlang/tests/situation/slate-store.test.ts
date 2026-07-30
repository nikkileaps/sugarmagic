/**
 * packages/plugins/src/catalog/sugarlang/tests/situation/slate-store.test.ts
 *
 * Purpose: Pins the slate store -- readable with no conversation in scope, and
 *   "nothing decided" distinguishable from "decided for a different situation".
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/situation/slate-store.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { SlateStore, situationKey, composeSituation } from "../../runtime/situation";
import type { Slate } from "../../runtime/situation";

function slate(key: string): Slate {
  return {
    situationKey: key,
    items: [
      { kind: "vocabulary", id: "queso", action: "introduce" },
      { kind: "competency", id: "greet", action: "reinforce" }
    ],
    issuedAtMs: 1000
  };
}

describe("SlateStore", () => {
  it("reads with NO conversation in scope", () => {
    // The reason this store exists rather than reusing DirectiveCache: item
    // views render before any conversation exists, so a conversation-keyed
    // lookup cannot serve realization at all.
    const store = new SlateStore();
    const key = situationKey(composeSituation({ sceneId: "scene-dock" }));
    store.write(slate(key));

    const result = store.read(key);
    expect(result.status).toBe("current");
    if (result.status !== "current") throw new Error("expected current");
    expect(result.slate.items).toHaveLength(2);
  });

  it("distinguishes nothing-decided from decided-for-another-situation", () => {
    // A bare `Slate | null` makes these identical. "The Teacher has not run" and
    // "the Teacher ran and the world moved" call for different handling, and
    // only one of them is worth telling an author about.
    const store = new SlateStore();
    expect(store.read("scene:dock").status).toBe("none");

    store.write(slate("scene:dock|quest:q1/stage-1"));
    const stale = store.read("scene:dock|quest:q1/stage-2");

    expect(stale.status).toBe("stale");
    if (stale.status !== "stale") throw new Error("expected stale");
    expect(stale.decidedForKey).toBe("scene:dock|quest:q1/stage-1");
  });

  it("carries competency teachables, not only lemmas", () => {
    // Pin: a slate that could only hold lemma refs would rebuild the dead end
    // where competency teaching gets filtered out and silently dropped.
    const store = new SlateStore();
    store.write(slate("k"));

    const result = store.read("k");
    if (result.status !== "current") throw new Error("expected current");
    expect(result.slate.items.map((item) => item.kind).sort()).toEqual([
      "competency",
      "vocabulary"
    ]);
  });

  it("holds one slate; a new decision replaces the old", () => {
    const store = new SlateStore();
    store.write(slate("first"));
    store.write(slate("second"));

    expect(store.read("first").status).toBe("stale");
    expect(store.read("second").status).toBe("current");
  });

  it("clears back to none", () => {
    const store = new SlateStore();
    store.write(slate("k"));
    store.clear();

    expect(store.read("k").status).toBe("none");
  });
});
