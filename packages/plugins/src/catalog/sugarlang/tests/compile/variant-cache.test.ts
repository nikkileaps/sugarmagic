/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/variant-cache.test.ts
 *
 * Purpose: Verifies the variant cache implementations (Memory and IndexedDB).
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/variant-cache.
 *   - Mirrors intent-cache.test.ts so variant metadata follows the same discipline.
 *
 * Implements: Epic 086 Story 086.3 -- bake-time variant generation
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  IndexedDBVariantCache,
  MemoryVariantCache,
  type VariantCacheEntry
} from "../../runtime/compile/variant-cache";
import type { BakedLineVariant } from "../../runtime/contracts/baked-variant";

function createVariant(
  nodeId = "node-1",
  overrides: Partial<BakedLineVariant> = {}
): BakedLineVariant {
  return {
    nodeId,
    dialogueDefinitionId: "dialogue-1",
    lang: "es",
    band: "B1",
    text: "Hola viajero, bienvenido.",
    verdict: {
      envelopePasses: true,
      ratioPasses: true,
      voiceRetentionScore: 1,
      fidelityPasses: true,
      overallPasses: true
    },
    reviewFlag: false,
    generatedAtMs: 1000,
    generatedByModel: "scripted-variant-bake",
    contentHash: "hash-abc",
    promptVersion: "086.3.0",
    ...overrides
  };
}

function createEntry(
  nodeId = "node-1",
  overrides: Partial<VariantCacheEntry> = {}
): VariantCacheEntry {
  return {
    key: {
      lang: "es",
      band: "B1",
      contentHash: "hash-abc",
      variantPromptVersion: "086.3.0"
    },
    variant: createVariant(nodeId),
    ...overrides
  };
}

describe("MemoryVariantCache", () => {
  it("round-trips cache entries", async () => {
    const cache = new MemoryVariantCache();
    const entry = createEntry();

    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
    expect(await cache.has(entry.key)).toBe(true);
  });

  it("returns null for a missing key", async () => {
    const cache = new MemoryVariantCache();
    expect(
      await cache.get({
        lang: "es",
        band: "B1",
        contentHash: "missing",
        variantPromptVersion: "086.3.0"
      })
    ).toBeNull();
    expect(
      await cache.has({
        lang: "es",
        band: "B1",
        contentHash: "missing",
        variantPromptVersion: "086.3.0"
      })
    ).toBe(false);
  });

  it("invalidates by contentHash", async () => {
    const cache = new MemoryVariantCache();
    const entry = createEntry();
    await cache.set(entry);
    await cache.invalidate(entry.key.contentHash);
    expect(await cache.get(entry.key)).toBeNull();
  });

  it("full invalidate clears all entries", async () => {
    const cache = new MemoryVariantCache();
    await cache.set(
      createEntry("node-1", {
        key: { lang: "es", band: "B1", contentHash: "h1", variantPromptVersion: "086.3.0" },
        variant: createVariant("node-1", { contentHash: "h1" })
      })
    );
    await cache.set(
      createEntry("node-2", {
        key: { lang: "es", band: "B2", contentHash: "h2", variantPromptVersion: "086.3.0" },
        variant: createVariant("node-2", { band: "B2", contentHash: "h2" })
      })
    );
    await cache.invalidate();
    expect(await cache.listEntries()).toHaveLength(0);
  });

  it("listEntries returns metadata for all entries", async () => {
    const cache = new MemoryVariantCache();
    const entry = createEntry();
    await cache.set(entry);
    const entries = await cache.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.nodeId).toBe("node-1");
    expect(entries[0]?.dialogueDefinitionId).toBe("dialogue-1");
  });

  it("distinguishes entries by band", async () => {
    const cache = new MemoryVariantCache();
    const b1Entry = createEntry("node-1", {
      key: { lang: "es", band: "B1", contentHash: "hash-abc", variantPromptVersion: "086.3.0" },
      variant: createVariant("node-1", { band: "B1" })
    });
    const b2Entry = createEntry("node-1", {
      key: { lang: "es", band: "B2", contentHash: "hash-abc", variantPromptVersion: "086.3.0" },
      variant: createVariant("node-1", { band: "B2" })
    });
    await cache.set(b1Entry);
    await cache.set(b2Entry);

    expect((await cache.get(b1Entry.key))?.variant.band).toBe("B1");
    expect((await cache.get(b2Entry.key))?.variant.band).toBe("B2");
    expect(await cache.listEntries()).toHaveLength(2);
  });
});

describe("IndexedDBVariantCache", () => {
  it("round-trips cache entries via IndexedDB", async () => {
    const cache = new IndexedDBVariantCache({ workspaceId: "test-workspace" });
    const entry = createEntry();

    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
    expect(await cache.has(entry.key)).toBe(true);
  });

  it("returns null for a missing key", async () => {
    const cache = new IndexedDBVariantCache({ workspaceId: "test-workspace-2" });
    expect(
      await cache.get({
        lang: "es",
        band: "B1",
        contentHash: "missing",
        variantPromptVersion: "086.3.0"
      })
    ).toBeNull();
  });

  it("invalidates by contentHash", async () => {
    const cache = new IndexedDBVariantCache({ workspaceId: "test-workspace-3" });
    const entry = createEntry();
    await cache.set(entry);
    await cache.invalidate(entry.key.contentHash);
    expect(await cache.get(entry.key)).toBeNull();
  });

  it("falls back to memory when IndexedDB is unavailable", async () => {
    const cache = new IndexedDBVariantCache({
      workspaceId: "no-idb",
      indexedDbFactory: null
    });
    const entry = createEntry();
    await cache.set(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
  });
});
