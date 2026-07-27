/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/live-render-cache.test.ts
 *
 * Purpose: Unit tests for LiveRenderCache and buildTeachablesKey.
 *
 * Implements: Epic 086 Story 086.5
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  LiveRenderCache,
  buildTeachablesKey,
  type LiveRenderCacheKey,
  type LiveRenderCacheEntry
} from "../../runtime/compile/live-render-cache";

function makeKey(overrides: Partial<LiveRenderCacheKey> = {}): LiveRenderCacheKey {
  return {
    nodeId: "node-1",
    dialogueDefinitionId: "dialogue-orrin",
    lang: "es",
    band: "B1",
    posture: "target-dominant",
    teachablesKey: "hola,viajero",
    ...overrides
  };
}

function makeEntry(text = "Hola, viajero."): LiveRenderCacheEntry {
  return {
    text,
    verdict: {
      envelopePasses: true,
      ratioPasses: true,
      voiceRetentionScore: 1.0,
      fidelityPasses: true,
      overallPasses: true
    },
    cachedAtMs: Date.now()
  };
}

describe("LiveRenderCache", () => {
  it("returns null on a miss", () => {
    const cache = new LiveRenderCache();
    expect(cache.get(makeKey())).toBeNull();
  });

  it("get/set round-trip returns the stored entry", () => {
    const cache = new LiveRenderCache();
    const key = makeKey();
    const entry = makeEntry("Bienvenido a la estacion.");
    cache.set(key, entry);
    expect(cache.get(key)).toBe(entry);
  });

  it("cache hit returns the exact same entry object", () => {
    const cache = new LiveRenderCache();
    const key = makeKey();
    const entry = makeEntry();
    cache.set(key, entry);
    const retrieved = cache.get(key);
    // Same reference (not a copy) -- the cache stores by reference.
    expect(retrieved).toBe(entry);
  });

  it("different keys do not collide", () => {
    const cache = new LiveRenderCache();
    const keyA = makeKey({ nodeId: "node-1" });
    const keyB = makeKey({ nodeId: "node-2" });
    const entryA = makeEntry("Hola.");
    const entryB = makeEntry("Adios.");
    cache.set(keyA, entryA);
    cache.set(keyB, entryB);
    expect(cache.get(keyA)).toBe(entryA);
    expect(cache.get(keyB)).toBe(entryB);
  });

  it("overwriting a key replaces the entry", () => {
    const cache = new LiveRenderCache();
    const key = makeKey();
    const first = makeEntry("Primera version.");
    const second = makeEntry("Segunda version.");
    cache.set(key, first);
    cache.set(key, second);
    expect(cache.get(key)).toBe(second);
  });

  it("size() reflects the number of distinct entries", () => {
    const cache = new LiveRenderCache();
    expect(cache.size()).toBe(0);
    cache.set(makeKey({ nodeId: "node-1" }), makeEntry());
    expect(cache.size()).toBe(1);
    cache.set(makeKey({ nodeId: "node-2" }), makeEntry());
    expect(cache.size()).toBe(2);
    // Overwriting the same key does not increase size.
    cache.set(makeKey({ nodeId: "node-1" }), makeEntry("Updated."));
    expect(cache.size()).toBe(2);
  });

  it("clear() empties the cache and size returns 0", () => {
    const cache = new LiveRenderCache();
    cache.set(makeKey({ nodeId: "node-1" }), makeEntry());
    cache.set(makeKey({ nodeId: "node-2" }), makeEntry());
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get(makeKey({ nodeId: "node-1" }))).toBeNull();
  });

  it("keys that differ only in one field are distinct", () => {
    const cache = new LiveRenderCache();
    const base = makeKey();
    const byBand = makeKey({ band: "A2" });
    const byLang = makeKey({ lang: "it" });
    const byPosture = makeKey({ posture: "anchored" });
    cache.set(base, makeEntry("Base."));
    cache.set(byBand, makeEntry("A2."));
    cache.set(byLang, makeEntry("Italian."));
    cache.set(byPosture, makeEntry("Anchored."));
    expect(cache.size()).toBe(4);
    expect(cache.get(base)?.text).toBe("Base.");
    expect(cache.get(byBand)?.text).toBe("A2.");
    expect(cache.get(byLang)?.text).toBe("Italian.");
    expect(cache.get(byPosture)?.text).toBe("Anchored.");
  });
});

describe("buildTeachablesKey", () => {
  it("returns an empty string for an empty list", () => {
    expect(buildTeachablesKey([])).toBe("");
  });

  it("returns the single lemmaId for a one-element list", () => {
    expect(buildTeachablesKey([{ lemmaId: "hola" }])).toBe("hola");
  });

  it("sorts lemmaIds before joining (stable key regardless of input order)", () => {
    const forward = buildTeachablesKey([
      { lemmaId: "hola" },
      { lemmaId: "adios" },
      { lemmaId: "gracias" }
    ]);
    const reversed = buildTeachablesKey([
      { lemmaId: "gracias" },
      { lemmaId: "hola" },
      { lemmaId: "adios" }
    ]);
    expect(forward).toBe(reversed);
    expect(forward).toBe("adios,gracias,hola");
  });

  it("two different lists with the same lemmaIds produce the same key", () => {
    const a = buildTeachablesKey([{ lemmaId: "z" }, { lemmaId: "a" }]);
    const b = buildTeachablesKey([{ lemmaId: "a" }, { lemmaId: "z" }]);
    expect(a).toBe(b);
  });

  it("two lists with different lemmaIds produce different keys", () => {
    const a = buildTeachablesKey([{ lemmaId: "hola" }]);
    const b = buildTeachablesKey([{ lemmaId: "adios" }]);
    expect(a).not.toBe(b);
  });
});
