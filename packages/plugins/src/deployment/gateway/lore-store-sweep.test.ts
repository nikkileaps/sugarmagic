/**
 * packages/plugins/src/deployment/gateway/lore-store-sweep.test.ts
 *
 * Purpose: Pins which vector-store files count as lore, because the answer
 *   decides what gets deleted.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { isLoreVectorStoreFile } from "./core";

/** A file as the lore ingest attaches it (`uploadChunkToVectorStore`). */
function loreFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-lore-1",
    attributes: {
      page_id: "lore.entities.creatures.wordlark",
      chunk_id: "wordlark#0",
      section_slug: "wordlark",
      section_heading: "Wordlark",
      title: "Wordlark",
      relative_path: "entities/creatures/wordlark.md"
    },
    ...overrides
  };
}

/** A file as the health probe attaches it -- `{ file_id }` and nothing else. */
function probeFile() {
  return { id: "file-probe-1" };
}

describe("which vector-store files belong to lore", () => {
  it("THE ONE THAT MATTERS: real lore is never swept", () => {
    // This predicate decides what gets DELETED. A false negative destroys
    // indexed lore and the only recovery is a full re-ingest.
    expect(isLoreVectorStoreFile(loreFile())).toBe(true);
  });

  it("an orphaned probe file is not lore", () => {
    // Four of these were handed to an NPC as the entire evidence block for a
    // turn on 2026-08-05. The probe attaches with no attributes at all.
    expect(isLoreVectorStoreFile(probeFile())).toBe(false);
  });

  it("keys on page_id, not on the filename", () => {
    // A filename check answers "is this the probe". The question worth asking
    // is "did this come from lore", which also catches whatever gets uploaded
    // by hand next -- the same reasoning as the relevance floor, which is
    // deliberately not a filename filter either.
    expect(isLoreVectorStoreFile({ id: "f", filename: "smprobe.md" })).toBe(false);
    expect(
      isLoreVectorStoreFile({ id: "f", filename: "smprobe.md", attributes: { page_id: "lore.x" } })
    ).toBe(true);
  });

  it("treats a malformed or empty page_id as not lore", () => {
    expect(isLoreVectorStoreFile({ id: "f", attributes: null })).toBe(false);
    expect(isLoreVectorStoreFile({ id: "f", attributes: {} })).toBe(false);
    expect(isLoreVectorStoreFile({ id: "f", attributes: { page_id: "" } })).toBe(false);
    expect(isLoreVectorStoreFile({ id: "f", attributes: { page_id: 42 } })).toBe(false);
  });

  it("does not require the other lore attributes", () => {
    // Only page_id is load-bearing. Requiring the full set would sweep a lore
    // file whose attach shape changed, which is the expensive direction to be
    // wrong in.
    expect(isLoreVectorStoreFile({ id: "f", attributes: { page_id: "lore.x" } })).toBe(true);
  });
});
