/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/intent-cache.test.ts
 *
 * Purpose: Verifies the intent cache implementations (Memory and IndexedDB).
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/intent-cache.
 *   - Mirrors chunk-cache.test.ts so intent metadata follows the same discipline.
 *
 * Implements: Epic 086 Story 086.1 -- line-intent model
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  IndexedDBIntentCache,
  MemoryIntentCache,
  type LineIntentCacheEntry
} from "../../runtime/compile/intent-cache";

function createEntry(
  nodeId = "node-1",
  overrides: Partial<LineIntentCacheEntry> = {}
): LineIntentCacheEntry {
  return {
    key: {
      contentHash: "hash-abc",
      intentPromptVersion: "086.1.0"
    },
    nodeId,
    dialogueDefinitionId: "dialogue-1",
    artifact: {
      nodeId,
      dialogueDefinitionId: "dialogue-1",
      anchorText: "Hello traveler.",
      mustConveyFacts: ["The traveler is greeted"],
      beat: "welcoming opener",
      voiceNote: "warm, unhurried",
      derived: true,
      reviewFlag: false,
      extractedAtMs: 1000,
      extractedByModel: "claude-sonnet-4-6"
    },
    ...overrides
  };
}

describe("MemoryIntentCache", () => {
  it("round-trips cache entries", async () => {
    const cache = new MemoryIntentCache();
    const entry = createEntry();

    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
    expect(await cache.has(entry.key)).toBe(true);
  });

  it("returns null for a missing key", async () => {
    const cache = new MemoryIntentCache();
    expect(
      await cache.get({ contentHash: "missing", intentPromptVersion: "086.1.0" })
    ).toBeNull();
    expect(
      await cache.has({ contentHash: "missing", intentPromptVersion: "086.1.0" })
    ).toBe(false);
  });

  it("invalidates by contentHash", async () => {
    const cache = new MemoryIntentCache();
    const entry = createEntry();
    await cache.set(entry);
    await cache.invalidate(entry.key.contentHash);
    expect(await cache.get(entry.key)).toBeNull();
  });

  it("full invalidate clears all entries", async () => {
    const cache = new MemoryIntentCache();
    await cache.set(createEntry("node-1", { key: { contentHash: "h1", intentPromptVersion: "086.1.0" } }));
    await cache.set(createEntry("node-2", { key: { contentHash: "h2", intentPromptVersion: "086.1.0" } }));
    await cache.invalidate();
    expect(await cache.listEntries()).toHaveLength(0);
  });

  it("listEntries returns metadata for all entries", async () => {
    const cache = new MemoryIntentCache();
    const entry = createEntry();
    await cache.set(entry);
    const entries = await cache.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.nodeId).toBe("node-1");
    expect(entries[0]?.dialogueDefinitionId).toBe("dialogue-1");
  });
});

describe("IndexedDBIntentCache", () => {
  it("round-trips cache entries via IndexedDB", async () => {
    const cache = new IndexedDBIntentCache({ workspaceId: "test-workspace" });
    const entry = createEntry();

    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
    expect(await cache.has(entry.key)).toBe(true);
  });

  it("returns null for a missing key", async () => {
    const cache = new IndexedDBIntentCache({ workspaceId: "test-workspace-2" });
    expect(
      await cache.get({ contentHash: "missing", intentPromptVersion: "086.1.0" })
    ).toBeNull();
  });

  it("invalidates by contentHash", async () => {
    const cache = new IndexedDBIntentCache({ workspaceId: "test-workspace-3" });
    const entry = createEntry();
    await cache.set(entry);
    await cache.invalidate(entry.key.contentHash);
    expect(await cache.get(entry.key)).toBeNull();
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    const cache = new IndexedDBIntentCache({
      workspaceId: "no-idb",
      indexedDbFactory: null
    });
    const entry = createEntry();
    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
  });
});
