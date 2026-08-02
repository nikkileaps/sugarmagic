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

  it("returns authored text rather than a flagged record", async () => {
    // A flagged record failed one of the four gates. Showing it puts text in
    // front of a learner that the verifiers already judged wrong for their
    // band, which is worse than showing English.
    expect(
      await resolver({
        getVariantCache: () => cacheReturning(record({ reviewFlag: true }))
      })(request)
    ).toBe(AUTHORED);
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

describe("A1/A2 substitution path", () => {
  // The bug this exists to fix: a beginner saw plain English on every item
  // forever, because the resolver only ever looked up baked variants and none
  // are baked below B1.
  /**
   * `atBand` is what the atlas reports as available for the learner's level --
   * the whole substitution pool, since the demo substitution matches against the full
   * lexicon rather than a teaching shortlist.
   */
  const markerInputs = (atBand: Array<{ lemmaId: string; lang: string }>) => async () => ({
    band: "A1" as const,
    atlas: {
      listLemmasAtBand: () => atBand,
      resolveFromGloss: (gloss: string) =>
        gloss === "book"
          ? [{ lemmaId: "libro", lang: "es", cefrPriorBand: "A1", partsOfSpeech: ["noun"] }]
          : [],
      getGloss: () => "book"
    } as never,
    supportLanguage: "en"
  });

  it("substitutes prescribed words into authored English at A1", async () => {
    const text = await resolver({
      getLearnerBand: async () => "A1",
      getMarkerInputs: markerInputs([{ lemmaId: "libro", lang: "es" }])
    })({ ...request, text: "An old book." });

    expect(text).toContain("libro");
    expect(text).not.toBe("An old book.");
  });

  it("does not read the variant cache at A1", async () => {
    // Variants below B1 do not exist; looking would be a guaranteed miss and
    // would mask the substitution never running.
    const cache = cacheReturning(record());
    await resolver({
      getLearnerBand: async () => "A1",
      getVariantCache: () => cache,
      getMarkerInputs: markerInputs([{ lemmaId: "libro", lang: "es" }])
    })({ ...request, text: "An old book." });

    expect(cache.get).not.toHaveBeenCalled();
  });

  it("substitutes at A2 as well", async () => {
    const text = await resolver({
      getLearnerBand: async () => "A2",
      getMarkerInputs: markerInputs([{ lemmaId: "libro", lang: "es" }])
    })({ ...request, text: "An old book." });
    expect(text).toContain("libro");
  });

  it("substitutes any level-appropriate word in the text, not just a shortlist", async () => {
    // THE bug this replaced. Candidates used to come from the budgeter's top-N
    // teaching slate for the whole SCENE, which almost never intersects one
    // specific paragraph -- measured on a real scene the slate was
    // [estación, área, vuestro] while the item prose was about travellers and
    // flying, so every substitution missed and the item rendered plain English.
    // The pool is now everything the learner's level admits.
    const text = await resolver({
      getLearnerBand: async () => "A1",
      getMarkerInputs: markerInputs([
        { lemmaId: "estación", lang: "es" },
        { lemmaId: "libro", lang: "es" }
      ])
    })({ ...request, text: "An old book." });

    expect(text).toContain("libro");
  });

  it("returns authored text when nothing prescribed appears in the text", async () => {
    const text = await resolver({
      getLearnerBand: async () => "A1",
      getMarkerInputs: markerInputs([{ lemmaId: "queso", lang: "es" }])
    })({ ...request, text: "An old book." });
    expect(text).toBe("An old book.");
  });

  it("returns authored text when marker inputs are unavailable", async () => {
    const text = await resolver({
      getLearnerBand: async () => "A1",
      getMarkerInputs: async () => null
    })({ ...request, text: "An old book." });
    expect(text).toBe("An old book.");
  });

  it("returns authored text when no marker inputs are wired at all", async () => {
    const text = await resolver({ getLearnerBand: async () => "A1" })({
      ...request,
      text: "An old book."
    });
    expect(text).toBe("An old book.");
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
