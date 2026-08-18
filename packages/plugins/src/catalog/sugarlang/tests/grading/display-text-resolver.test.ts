/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/display-text-resolver.test.ts
 *
 * Purpose: Pins the TOTALITY of the display-text resolver -- that every failure
 * mode returns the authored text rather than throwing, empty, or wrong text.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/grading/display-text-resolver with a fake cache.
 *
 * Implements: Epic 086 Story 086.3 (runtime seam, 2026-07-28)
 *
 * Status: active
 *
 * WHY THIS FILE IS MOSTLY NEGATIVE CASES
 *
 * The feature's promise is "the game still works in plain English". Every test
 * below is one way that promise could break. The happy path is a single test;
 * the guarantee is the rest.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createDisplayTextResolver,
  toGradedTextSource
} from "../../runtime/grading/display-text-resolver";
import type { SugarlangVariantCache } from "../../runtime/compile/variant-cache";
import type { GradedTextRecord } from "../../runtime/contracts/graded-text";

const AUTHORED = "A leather book, its spine cracked.";
const GRADED = "Un libro de cuero con el lomo agrietado.";
const PROMPT_VERSION = "086.3.1";

const request = {
  subjectKind: "item-view",
  subjectId: "item-book",
  field: "body",
  text: AUTHORED
};

function record(overrides: Partial<GradedTextRecord> = {}): GradedTextRecord {
  return {
    source: { kind: "item-view", itemDefinitionId: "item-book", field: "body" },
    lang: "es",
    band: "B1",
    text: GRADED,
    verdict: {
      envelopePasses: true,
      ratioPasses: true,
      voiceRetentionScore: 1,
      fidelityPasses: true,
      overallPasses: true
    },
    reviewFlag: false,
    generatedAtMs: 0,
    generatedByModel: "test",
    contentHash: "hash",
    promptVersion: PROMPT_VERSION,
    ...overrides
  };
}

function cacheReturning(variant: GradedTextRecord | null): SugarlangVariantCache {
  return {
    get: vi.fn(async () => (variant ? { key: {} as never, variant } : null)),
    set: vi.fn(async () => undefined),
    has: vi.fn(async () => variant !== null),
    invalidate: vi.fn(async () => undefined),
    listEntries: vi.fn(async () => [])
  };
}

/** B1 is a VARIANT band. A1/A2 take the substitution path -- see that describe. */
function resolver(over: Partial<Parameters<typeof createDisplayTextResolver>[0]> = {}) {
  return createDisplayTextResolver({
    getVariantCache: () => cacheReturning(record()),
    getTargetLanguage: () => "es",
    getLearnerBand: async () => "B1",
    promptVersion: PROMPT_VERSION,
    ...over
  });
}

describe("display text resolver", () => {
  it("returns the graded text on a cache hit", async () => {
    expect(await resolver()(request)).toBe(GRADED);
  });

  it("returns authored text when there is no variant cache", async () => {
    // Published game with no studio workspace, or before any conversation has
    // bound. Not an error -- just nothing graded yet.
    expect(await resolver({ getVariantCache: () => undefined })(request)).toBe(AUTHORED);
  });

  it("returns authored text when no target language is configured", async () => {
    expect(await resolver({ getTargetLanguage: () => null })(request)).toBe(AUTHORED);
  });

  it("returns authored text when there is no learner yet", async () => {
    expect(await resolver({ getLearnerBand: async () => null })(request)).toBe(AUTHORED);
  });

  it("returns authored text on a cache miss", async () => {
    expect(await resolver({ getVariantCache: () => cacheReturning(null) })(request)).toBe(
      AUTHORED
    );
  });

  it("shows a flagged record; the flag is a Studio review aid, not a runtime veto", async () => {
    // Story #200: the envelope gate is calibrated for dialogue pacing and
    // legitimately fails full item translations. The author sees the failing
    // gates in the item variants panel and owns the call; whatever they
    // leave baked is what the player reads.
    expect(
      await resolver({
        getVariantCache: () => cacheReturning(record({ reviewFlag: true }))
      })(request)
    ).toBe(GRADED);
  });

  it("returns authored text rather than an empty graded string", async () => {
    expect(
      await resolver({ getVariantCache: () => cacheReturning(record({ text: "" })) })(
        request
      )
    ).toBe(AUTHORED);
  });

  it("never throws, whatever the cache does", async () => {
    const exploding: SugarlangVariantCache = {
      get: vi.fn(async () => {
        throw new Error("idb exploded");
      }),
      set: vi.fn(async () => undefined),
      has: vi.fn(async () => false),
      invalidate: vi.fn(async () => undefined),
      listEntries: vi.fn(async () => [])
    };
    await expect(resolver({ getVariantCache: () => exploding })(request)).resolves.toBe(
      AUTHORED
    );
  });

  it("stays inert for subject kinds it does not grade", async () => {
    const cache = cacheReturning(record());
    const text = await resolver({ getVariantCache: () => cache })({
      ...request,
      subjectKind: "quest-objective"
    });
    expect(text).toBe(AUTHORED);
    // And does not even look: a guessed hash would never hit anyway.
    expect(cache.get).not.toHaveBeenCalled();
  });

  it("stays inert for unknown fields of a kind it does grade", async () => {
    expect(await resolver()({ ...request, field: "consumeLabel" })).toBe(AUTHORED);
  });
});

describe("beginner bands read baked variants, like dialogue", () => {
  // WAS "A1/A2 substitution path" (nine tests, deleted 2026-08-02).
  //
  // It pinned the opposite behaviour: at anchored/supported posture the
  // resolver spliced bare target-language CITATION FORMS into the authored
  // English and never consulted the cache. That is the mechanism the scripted
  // dialogue path deleted on 2026-07-31, and for a verb a citation form is the
  // INFINITIVE -- which is how an unconjugated verb reached players.
  //
  // Item text now behaves exactly like dialogue: a baked variant for the band
  // if there is one, the authored English if there is not. Beginner bands are
  // bakeable because the item bake passes posture now (see ITEM_VARIANT_BANDS).

  it("reads a baked variant at A1", async () => {
    expect(
      await resolver({
        getLearnerBand: async () => "A1",
        getVariantCache: () => cacheReturning(record())
      })(request)
    ).toBe(GRADED);
  });

  it("reads a baked variant at A2", async () => {
    expect(
      await resolver({
        getLearnerBand: async () => "A2",
        getVariantCache: () => cacheReturning(record())
      })(request)
    ).toBe(GRADED);
  });

  it("CONSULTS the cache at A1 -- the old path deliberately did not", async () => {
    const cache = cacheReturning(record());
    await resolver({ getLearnerBand: async () => "A1", getVariantCache: () => cache })(
      request
    );
    expect(cache.get).toHaveBeenCalled();
  });

  it("serves the authored English at A1 when nothing is baked", async () => {
    // Untaught but CORRECT, and readable. The same rule the scripted path took:
    // better than a line half-rewritten by a mechanism that made no
    // pedagogical decision.
    expect(
      await resolver({
        getLearnerBand: async () => "A1",
        getVariantCache: () => cacheReturning(null)
      })(request)
    ).toBe(AUTHORED);
  });

  it("never emits a bare citation form into the authored text", async () => {
    // The regression guard for this whole story. `libro` must not appear unless
    // a baked variant put it there.
    const text = await resolver({
      getLearnerBand: async () => "A1",
      getVariantCache: () => cacheReturning(null)
    })({ ...request, text: "An old book." });

    expect(text).toBe("An old book.");
    expect(text).not.toContain("libro");
  });

  it("shows a flagged variant at A1; the flag never suppresses display", async () => {
    expect(
      await resolver({
        getLearnerBand: async () => "A1",
        getVariantCache: () => cacheReturning({ ...record(), reviewFlag: true })
      })(request)
    ).toBe(GRADED);
  });

  it("still uses baked variants at B1", async () => {
    expect(await resolver({ getLearnerBand: async () => "B1" })(request)).toBe(GRADED);
  });
});

describe("toGradedTextSource", () => {
  it("maps an item-view request onto the item source and its hash", () => {
    const mapped = toGradedTextSource(request);
    expect(mapped?.source).toEqual({
      kind: "item-view",
      itemDefinitionId: "item-book",
      field: "body"
    });
    // Same seed the bake side builds, or the lookup can never hit.
    expect(mapped?.contentHash).toBe(
      [`item:item-book:body`, AUTHORED, JSON.stringify({})].join("|")
    );
  });

  it("returns null for kinds sugarlang does not grade", () => {
    expect(toGradedTextSource({ ...request, subjectKind: "npc-bio" })).toBeNull();
  });
});
