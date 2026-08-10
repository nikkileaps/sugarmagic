/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/shipped-variants.test.ts
 *
 * Purpose: A deployed game plays the graded text it shipped with
 *   (Plan 092.4).
 *
 * WHAT WAS WRONG
 *   Both places that reach for a variant asked Studio's workspace database,
 *   and a deployed origin has no such database. So every scripted line and
 *   every item description rendered the AUTHORED text at every band, while the
 *   graded version sat unread in a file the player had already downloaded.
 *   Nothing failed; it just never taught.
 *
 * Status: active
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVariantsFromArtifact } from "../../runtime/compile/artifact-loader";
import {
  getShippedVariantCache,
  resetShippedVariantCacheForTests,
  seedShippedVariantCache
} from "../../runtime/compile/shipped-variant-cache";
import { SUGARLANG_VARIANT_ASSET_PATH } from "../../runtime/compile/artifact-paths";

const STAMPED_URL = "/assets/sugarlang/variants.json?v=abc123";
const sources = { [SUGARLANG_VARIANT_ASSET_PATH]: STAMPED_URL };

function entry(text: string, band = "A1", contentHash = "node-1|hello|{}") {
  return {
    key: { lang: "es", band, contentHash, variantPromptVersion: "086.3.0" },
    variant: {
      band,
      contentHash,
      lang: "es",
      nodeId: "node-1",
      dialogueDefinitionId: "d1",
      text,
      promptVersion: "086.3.0",
      generatedAtMs: 1,
      generatedByModel: "manual",
      reviewFlag: false
    }
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const fetchReturning = (body: unknown) =>
  vi.fn().mockResolvedValue(jsonResponse(body));

afterEach(() => resetShippedVariantCacheForTests());

describe("092.4 - the shipped variants load", () => {
  it("THE ONE THAT MATTERS: reads the graded text out of the shipped file", async () => {
    const variants = await loadVariantsFromArtifact(
      sources,
      fetchReturning({ variants: [entry("Hola, buenas tardes.")] })
    );
    expect(variants).toHaveLength(1);
    expect(variants[0]!.variant.text).toBe("Hola, buenas tardes.");
  });

  it("uses the VERSION-STAMPED url, never a hand-built path", async () => {
    // `/assets/*` is served immutable for a year; a hard-coded path would be
    // cached across deploys and never pick up a rebake.
    const fetchImpl = fetchReturning({ variants: [] });
    await loadVariantsFromArtifact(sources, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(STAMPED_URL);
  });

  it("a game that shipped nothing graded is a quiet empty, not a crash", async () => {
    const fetchImpl = vi.fn();
    expect(await loadVariantsFromArtifact({}, fetchImpl)).toEqual([]);
    expect(await loadVariantsFromArtifact(undefined, fetchImpl)).toEqual([]);
    // Nothing to fetch means it must not guess a url.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a 404 or an unreadable file does not stop the game booting", async () => {
    expect(
      await loadVariantsFromArtifact(
        sources,
        vi.fn().mockResolvedValue(jsonResponse(null, false, 404))
      )
    ).toEqual([]);
    expect(
      await loadVariantsFromArtifact(
        sources,
        vi.fn().mockRejectedValue(new Error("offline"))
      )
    ).toEqual([]);
  });

  it("drops a malformed entry and keeps its well-formed neighbours", async () => {
    // Hand-edited by design, so one bad record must not cost the rest.
    const variants = await loadVariantsFromArtifact(
      sources,
      fetchReturning({
        variants: [
          entry("keep me"),
          { key: {}, variant: { text: "no key" } },
          { key: { lang: "es" }, variant: {} },
          null
        ]
      })
    );
    expect(variants.map((v) => v.variant.text)).toEqual(["keep me"]);
  });

  it("an entry with empty text is dropped -- rendering nothing is worse than English", async () => {
    const variants = await loadVariantsFromArtifact(
      sources,
      fetchReturning({ variants: [entry("")] })
    );
    expect(variants).toEqual([]);
  });
});

describe("092.4 - the shipped cache serves lookups", () => {
  it("THE ONE THAT MATTERS: a line looked up by its key gets the graded text", async () => {
    await seedShippedVariantCache(
      sources,
      fetchReturning({ variants: [entry("Hola, buenas tardes.")] })
    );
    const cache = getShippedVariantCache();
    const hit = await cache!.get({
      lang: "es",
      band: "A1",
      contentHash: "node-1|hello|{}",
      variantPromptVersion: "086.3.0"
    } as never);
    expect(hit?.variant.text).toBe("Hola, buenas tardes.");
  });

  it("is undefined before seeding, so a caller can tell shipped-none from no-match", async () => {
    // An empty cache and no cache look identical at a lookup, and only one of
    // them is worth reporting.
    expect(getShippedVariantCache()).toBeUndefined();
  });

  it("NOTHING IS EVICTED, however many shipped", async () => {
    // The memory cache defaults to 400 entries and drops the least recently
    // used silently. A hundred lines across six bands is six hundred: a line
    // would render graded text one moment and English the next with nothing in
    // the log. A shipped set is fixed and known, so it is sized to fit.
    const many = Array.from({ length: 600 }, (_, i) =>
      entry(`texto ${i}`, "A1", `node-${i}|linea ${i}|{}`)
    );
    const count = await seedShippedVariantCache(sources, fetchReturning({ variants: many }));
    expect(count).toBe(600);

    const cache = getShippedVariantCache();
    // The FIRST one seeded is the one an LRU would have dropped.
    const first = await cache!.get({
      lang: "es",
      band: "A1",
      contentHash: "node-0|linea 0|{}",
      variantPromptVersion: "086.3.0"
    } as never);
    expect(first?.variant.text).toBe("texto 0");
    expect(await cache!.listEntries()).toHaveLength(600);
  });

  it("a miss is a miss, not a stale neighbour", async () => {
    // A wrong hit here would render another line's text in this line's place.
    await seedShippedVariantCache(sources, fetchReturning({ variants: [entry("uno")] }));
    const cache = getShippedVariantCache();
    expect(
      await cache!.get({
        lang: "es",
        band: "B2",
        contentHash: "node-1|hello|{}",
        variantPromptVersion: "086.3.0"
      } as never)
    ).toBeNull();
  });
});
