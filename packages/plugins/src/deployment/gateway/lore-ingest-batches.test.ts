/**
 * packages/plugins/src/deployment/gateway/lore-ingest-batches.test.ts
 *
 * Purpose: Pins the two properties the batched ingest exists for -- bounded
 *   concurrency, and per-file attributes surviving the batch attach.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { chunkAttributes, mapWithConcurrency } from "./core";
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
  it("THE ONE THAT MATTERS: never exceeds the concurrency limit", () => {
    // 7,500 simultaneous uploads is a different way to fail than 7,500
    // sequential ones, not a better one.
    let inFlight = 0;
    let peak = 0;

    return mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item * 2;
      }
    ).then((results) => {
      expect(peak).toBeLessThanOrEqual(8);
      expect(results).toHaveLength(50);
    });
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
