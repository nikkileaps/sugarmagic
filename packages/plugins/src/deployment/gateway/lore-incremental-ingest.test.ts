/**
 * packages/plugins/src/deployment/gateway/lore-incremental-ingest.test.ts
 *
 * Purpose: Pins what an incremental ingest decides to do. Getting this wrong
 *   either re-uploads everything (merely slow) or skips a changed chunk
 *   (silently stale), and only one of those is visible.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  chunkContentHash,
  indexedChunksByAddress,
  planIncrementalIngest
} from "./core";

function chunk(chunkId: string, embeddingText: string) {
  return {
    chunkId,
    pageId: chunkId.split("#")[0]!,
    sectionSlug: chunkId.split("#")[1] ?? "s",
    sectionHeading: "Heading",
    title: "Title",
    relativePath: "a.md",
    embeddingText
  } as never;
}

/** A vector-store file as the ingest attaches one. */
function indexedFile(id: string, chunkId: string, hash: string) {
  return {
    id,
    attributes: {
      page_id: chunkId.split("#")[0]!,
      chunk_id: chunkId,
      content_hash: hash
    }
  };
}

describe("what the content hash is taken over", () => {
  it("THE ONE THAT MATTERS: editing the text changes the hash", () => {
    // This is the whole mechanism. If the hash does not move when the words
    // move, an ingest reports success in seconds and serves stale lore forever.
    const before = chunkContentHash(chunk("a#0", "A wordlark is made of steam."));
    const after = chunkContentHash(chunk("a#0", "A wordlark is made of mist."));
    expect(after).not.toBe(before);
  });

  it("is taken over the text ONLY, not the id or the metadata", () => {
    // Same words at a different address must hash the same, or every rename
    // would re-embed unchanged prose.
    const a = chunk("a#0", "identical prose");
    const b = chunk("totally#different", "identical prose");
    expect(chunkContentHash(a)).toBe(chunkContentHash(b));
  });

  it("is stable across calls", () => {
    const c = chunk("a#0", "A wordlark is made of steam.");
    expect(chunkContentHash(c)).toBe(chunkContentHash(c));
  });
});

describe("planning an incremental ingest", () => {
  const text = "A wordlark is made of steam.";
  const hash = chunkContentHash(chunk("a#0", text));

  it("THE ONE THAT MATTERS: an edited chunk is re-uploaded", () => {
    const plan = planIncrementalIngest(
      [chunk("a#0", "EDITED text")],
      indexedChunksByAddress([indexedFile("file-1", "a#0", hash)])
    );

    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0]!.staleFileId).toBe("file-1");
    expect(plan.unchanged).toHaveLength(0);
  });

  it("an unchanged chunk is skipped entirely", () => {
    const plan = planIncrementalIngest(
      [chunk("a#0", text)],
      indexedChunksByAddress([indexedFile("file-1", "a#0", hash)])
    );

    expect(plan.unchanged).toHaveLength(1);
    expect(plan.upload).toHaveLength(0);
    expect(plan.replace).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it("a wiki with nothing changed asks for no work at all", () => {
    const chunks = [chunk("a#0", "one"), chunk("a#1", "two"), chunk("b#0", "three")];
    const plan = planIncrementalIngest(
      chunks,
      indexedChunksByAddress(
        chunks.map((c, i) => indexedFile("file-" + i, (c as never as {chunkId: string}).chunkId, chunkContentHash(c)))
      )
    );

    expect(plan.upload).toHaveLength(0);
    expect(plan.replace).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(3);
  });

  it("a new chunk uploads with no stale file to remove", () => {
    const plan = planIncrementalIngest([chunk("new#0", "fresh")], new Map());
    expect(plan.upload).toHaveLength(1);
    expect(plan.replace).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it("a chunk gone from source is removed", () => {
    // A deleted page or a renamed heading. Its address is no longer produced,
    // so the indexed copy has to go or it stays retrievable forever.
    const plan = planIncrementalIngest(
      [],
      indexedChunksByAddress([indexedFile("file-gone", "deleted#0", hash)])
    );
    expect(plan.remove).toEqual(["file-gone"]);
  });

  it("NEVER removes a file that is not lore", () => {
    // The sweep owns those. A probe leftover has no page_id and no chunk_id, so
    // it must be invisible here -- otherwise two mechanisms delete the same
    // files by different rules.
    const indexed = indexedChunksByAddress([
      { id: "file-probe" },
      { id: "file-probe-2", attributes: null },
      indexedFile("file-real", "a#0", hash)
    ]);

    expect(indexed.size).toBe(1);
    const plan = planIncrementalIngest([], indexed);
    expect(plan.remove).toEqual(["file-real"]);
  });

  it("re-uploads a file indexed before content hashes existed", () => {
    // Migration, without a version flag or a backfill: no hash never matches a
    // real one, so it re-uploads once and then settles.
    const plan = planIncrementalIngest(
      [chunk("a#0", text)],
      indexedChunksByAddress([{
        id: "file-old",
        attributes: { page_id: "a", chunk_id: "a#0" }
      }])
    );

    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0]!.staleFileId).toBe("file-old");
  });
});
