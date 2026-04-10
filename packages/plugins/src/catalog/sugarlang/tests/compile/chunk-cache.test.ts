/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/chunk-cache.test.ts
 *
 * Purpose: Verifies the chunk cache implementations, including drift telemetry.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/chunk-cache and the shared telemetry sink.
 *   - Mirrors the Epic 6 compile-cache tests so chunk metadata follows the same discipline.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness / Epic 14 Story 14.2
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  IndexedDBChunkCache,
  MemoryChunkCache,
  type ChunkCacheEntry
} from "../../runtime/compile/chunk-cache";
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";

function createEntry(
  contentHash: string,
  chunkId = "de_vez_en_cuando"
): ChunkCacheEntry {
  return {
    key: {
      contentHash,
      lang: "es",
      extractorPromptVersion: "1"
    },
    sceneId: "scene-1",
    extractedAtMs: 10,
    extractedByModel: "claude-sonnet-4-6",
    chunks: [
      {
        chunkId,
        normalizedForm: chunkId,
        surfaceForms: [chunkId.replace(/_/g, " ")],
        cefrBand: "A2",
        constituentLemmas: ["vez", "cuando"],
        extractedByModel: "claude-sonnet-4-6",
        extractedAtMs: 10,
        extractorPromptVersion: "1",
        source: "llm-extracted"
      }
    ]
  };
}

describe("MemoryChunkCache", () => {
  it("round-trips cache entries and emits drift telemetry on changes", async () => {
    const telemetry = new MemoryTelemetrySink();
    const cache = new MemoryChunkCache({
      telemetry
    });
    const first = createEntry("hash-1");
    const second = createEntry("hash-1", "por_si_acaso");

    await cache.set(first);
    expect(await cache.get(first.key)).toEqual(first);
    expect(await cache.has(first.key)).toBe(true);

    await cache.set(second);
    const events = await telemetry.query({
      eventKinds: ["chunk.extraction-drift-detected"]
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: "chunk.extraction-drift-detected",
        contentHash: "hash-1",
        changedChunks: ["de_vez_en_cuando", "por_si_acaso"]
      })
    );
  });

  it("does not emit drift when the replacement is byte-identical", async () => {
    const telemetry = new MemoryTelemetrySink();
    const cache = new MemoryChunkCache({
      telemetry
    });
    const entry = createEntry("hash-1");

    await cache.set(entry);
    await cache.set(entry);

    const events = await telemetry.query({
      eventKinds: ["chunk.extraction-drift-detected"]
    });
    expect(events).toEqual([]);
  });
});

describe("IndexedDBChunkCache", () => {
  it("persists entries by workspace and falls back cleanly when IndexedDB is unavailable", async () => {
    const entry = createEntry("hash-1");
    const first = new IndexedDBChunkCache({
      workspaceId: "workspace-a"
    });
    await first.set(entry);

    const second = new IndexedDBChunkCache({
      workspaceId: "workspace-a"
    });
    const isolated = new IndexedDBChunkCache({
      workspaceId: "workspace-b"
    });

    expect(await second.get(entry.key)).toEqual(entry);
    expect(await isolated.get(entry.key)).toBeNull();

    const warn = vi.fn();
    const fallback = new IndexedDBChunkCache({
      workspaceId: "workspace-fallback",
      indexedDbFactory: null,
      logger: { warn }
    });
    await fallback.set(entry);
    expect(await fallback.get(entry.key)).toEqual(entry);
    expect(warn).toHaveBeenCalled();
  });
});
