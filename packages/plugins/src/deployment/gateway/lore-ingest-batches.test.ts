/**
 * packages/plugins/src/deployment/gateway/lore-ingest-batches.test.ts
 *
 * Purpose: Pins the two properties the batched ingest exists for -- bounded
 *   concurrency, and per-file attributes surviving the batch attach.
 *
 * Status: active
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachChunkBatch, chunkAttributes, mapWithConcurrency } from "./core";
import { isLoreVectorStoreFile } from "./core";

function chunk(id: string) {
  return {
    chunkId: id,
    pageId: "lore.entities.creatures.wordlark",
    sectionSlug: "wordlark",
    sectionHeading: "Wordlark",
    title: "Wordlark",
    relativePath: "entities/creatures/wordlark.md",
    embeddingText: "A wordlark is a magical bird made out of steam."
  } as never;
}

describe("uploading many chunks at once", () => {
  it("THE ONE THAT MATTERS: runs concurrently, up to the limit and no further", async () => {
    // BOTH BOUNDS, because either alone is unfalsifiable. `peak <= 8` passes
    // for a sequential implementation (peak 1), which is what the first version
    // of this test asserted and therefore proved nothing.
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return item * 2;
      }
    );

    expect(peak).toBe(8);
    expect(results).toHaveLength(50);
    expect(results[49]).toBe(98);
  });

  it("stops the other workers once one fails", async () => {
    // Promise.all rejects on the first throw, but the other runners keep
    // looping unless something tells them to stop -- and they keep writing
    // ingest progress, overwriting the "failed" state with cheerful
    // "uploaded N / M" messages. The run then reads as still going after it has
    // already lost.
    let started = 0;

    await expect(
      mapWithConcurrency(Array.from({ length: 200 }, (_, i) => i), 4, async (item) => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (item === 2) throw new Error("upload failed");
        return item;
      })
    ).rejects.toThrow("upload failed");

    // Whatever was already in flight finishes; nothing new is picked up. The
    // exact number is timing-dependent, so this pins the property that matters:
    // it stopped, rather than draining all 200.
    expect(started).toBeLessThan(50);
  });

  it("preserves order regardless of completion order", async () => {
    // The results are zipped back against their chunks to build the batch
    // attach, so a reordered result array would attach the wrong attributes to
    // the wrong file.
    const results = await mapWithConcurrency([5, 1, 4, 2, 3], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results).toEqual([5, 1, 4, 2, 3]);
  });

  it("surfaces a worker failure rather than resolving short", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("upload failed");
        return n;
      })
    ).rejects.toThrow("upload failed");
  });
});

describe("what a batched chunk is attached with", () => {
  it("THE ONE THAT MATTERS: a batched chunk still reads as lore", () => {
    // The batch API's `files` and `file_ids` parameters are mutually exclusive,
    // and only `files` carries per-file attributes. Using `file_ids` would
    // attach every chunk with no page_id -- so the sweep would delete the
    // entire wiki on the next health check, and retrieval would lose its
    // metadata.
    const attributes = chunkAttributes(chunk("wordlark#0"));
    expect(isLoreVectorStoreFile({ id: "file-1", attributes })).toBe(true);
  });

  it("carries the fields retrieval reads back off a hit", () => {
    const attributes = chunkAttributes(chunk("wordlark#0"));
    expect(attributes).toMatchObject({
      page_id: "lore.entities.creatures.wordlark",
      chunk_id: "wordlark#0",
      section_slug: "wordlark",
      section_heading: "Wordlark",
      title: "Wordlark",
      relative_path: "entities/creatures/wordlark.md"
    });
  });
});

describe("waiting for a batch to index", () => {
  const realFetch = globalThis.fetch;

  /** Answers the create with an id, then replays `statuses` on each poll. */
  function stubBatch(statuses: Array<Record<string, unknown>>) {
    let poll = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: { method?: string }) => {
      const isCreate = (init?.method ?? "GET") === "POST";
      const body = isCreate
        ? { id: "batch-1" }
        : statuses[Math.min(poll++, statuses.length - 1)]!;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => body,
        text: async () => JSON.stringify(body)
      };
    }) as never;
  }

  beforeEach(() => {
    process.env.SUGARMAGIC_OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("THE ONE THAT MATTERS: a completed batch with failed files is not a success", async () => {
    // A batch is `completed` when every file has been PROCESSED, not when every
    // file succeeded. openai-node's poll helper says so outright: "this will
    // return even if one of the files failed to process, you need to check
    // batch.file_counts.failed_count to handle this case."
    //
    // Reading `completed` as success is how an ingest reports 98/98 while
    // chunks are silently missing from the store -- and they keep their
    // page_id, so the sweep does not surface them either.
    stubBatch([
      { status: "completed", file_counts: { completed: 95, failed: 3, total: 98 } }
    ]);

    await expect(
      attachChunkBatch("vs_test", [{ fileId: "file-1", chunk: chunk("a#0") }])
    ).rejects.toThrow(/3 failed/);
  });

  it("returns the indexed count, not the number handed in", async () => {
    // The caller adds this to its running total. Adding the slice length
    // instead is the same bug one level up.
    stubBatch([
      { status: "completed", file_counts: { completed: 2, failed: 0, total: 2 } }
    ]);

    const indexed = await attachChunkBatch("vs_test", [
      { fileId: "file-1", chunk: chunk("a#0") },
      { fileId: "file-2", chunk: chunk("a#1") }
    ]);
    expect(indexed).toBe(2);
  });

  it("keeps polling while the batch is in progress", async () => {
    stubBatch([
      { status: "in_progress", file_counts: { completed: 0, failed: 0, total: 1 } },
      { status: "in_progress", file_counts: { completed: 0, failed: 0, total: 1 } },
      { status: "completed", file_counts: { completed: 1, failed: 0, total: 1 } }
    ]);

    const seen: number[] = [];
    const indexed = await attachChunkBatch(
      "vs_test",
      [{ fileId: "file-1", chunk: chunk("a#0") }],
      (done) => seen.push(done)
    );

    expect(indexed).toBe(1);
    expect(seen).toEqual([0, 0, 1]);
  }, 20000);

  it("a failed or cancelled batch throws with its counts", async () => {
    stubBatch([
      { status: "failed", file_counts: { completed: 1, failed: 1, total: 2 } }
    ]);

    await expect(
      attachChunkBatch("vs_test", [
        { fileId: "file-1", chunk: chunk("a#0") },
        { fileId: "file-2", chunk: chunk("a#1") }
      ])
    ).rejects.toThrow(/failed.*1 indexed, 1 failed of 2/);
  });
});
