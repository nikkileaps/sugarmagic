/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/english-collisions.test.ts
 *
 * Purpose: Pins the honest-instrument counting -- an English homograph counts
 *   as target-language only inside a recognized Spanish span.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { computeCoverage } from "../../runtime/classifier/coverage";
import { createChunkMatcher } from "../../runtime/classifier/chunk-matcher";
import { tokenize } from "../../runtime/classifier/tokenize";
import itMorphology from "../../data/languages/it/morphology.json";
import { englishCollisionSurfaces } from "../../runtime/classifier/english-collisions";
import {
  createLearnerProfile,
  createLexicalAtlasProvider,
  createMorphologyData
} from "./test-helpers";

const atlas = createLexicalAtlasProvider("es", [
  { lemmaId: "toar", cefrPriorBand: "A2" },
  { lemmaId: "haber", cefrPriorBand: "A1" },
  { lemmaId: "queso", cefrPriorBand: "A1" },
  { lemmaId: "gustar", cefrPriorBand: "A1" },
  { lemmaId: "manchego", cefrPriorBand: "B1" }
]);
const morphology = createMorphologyData("es", {
  too: "toar",
  he: "haber",
  queso: "queso",
  gusta: "gustar",
  me: "me",
  manchego: "manchego"
});
const learner = createLearnerProfile("A1");
const collisions = englishCollisionSurfaces("es");

function coverageOf(text: string, extra: {
  recognized?: Set<string>;
  chunks?: Array<{ normalizedForm: string; surfaceForms: string[]; cefrBand: "A1"; constituentLemmas: string[] }>;
} = {}) {
  const matcher = extra.chunks ? createChunkMatcher(extra.chunks, "es") : undefined;
  return computeCoverage(
    tokenize(text, "es"),
    learner,
    atlas,
    new Set(),
    morphology,
    new Set(),
    matcher,
    undefined,
    text,
    collisions,
    extra.recognized
  );
}

describe("the english-collision guard", () => {
  it("THE ONE THAT MATTERS: English 'too' no longer counts as Spanish", () => {
    // "I love queso too" -- before the guard, "too" resolved to `toar` (A2)
    // and became a phantom out-of-envelope violation, and it inflated the
    // measured Spanish ratio. That is how the repair fired on ~100% of turns.
    const profile = coverageOf("I love queso too");

    expect(profile.outOfEnvelopeLemmas.map((l) => l.lemmaId)).not.toContain("toar");
    // Only `queso` counts as resolved Spanish; "too" is unresolved English.
    expect(profile.resolvedTargetLanguageTokens).toBe(1);
  });

  it("a slated word's form still counts, collision or not", () => {
    // If `toar` were somehow slated, its form "too" is recognized and counts.
    const profile = coverageOf("I love queso too", {
      recognized: new Set(["too"])
    });
    expect(profile.resolvedTargetLanguageTokens).toBe(2);
  });

  it("'me' inside the exponent 'me gusta' counts via the span", () => {
    // The exponent matcher consumes both tokens, so the collision guard never
    // sees "me" -- exactly the protection the design specifies for
    // both-language function words.
    const profile = coverageOf("me gusta el queso", {
      chunks: [{
        normalizedForm: "me_gusta",
        surfaceForms: ["me gusta"],
        cefrBand: "A1",
        constituentLemmas: ["gustar"]
      }]
    });
    expect(profile.matchedChunkTokens).toHaveLength(1);
  });

  it("bare English 'me' outside any span does not count", () => {
    const profile = coverageOf("trust me about the queso");
    expect(profile.resolvedTargetLanguageTokens).toBe(1); // queso only
  });

  it("a genuine above-band word is still a violation", () => {
    // The guard removes phantoms, not truth: manchego is really B1.
    const profile = coverageOf("try the manchego");
    expect(profile.outOfEnvelopeLemmas.map((l) => l.lemmaId)).toContain("manchego");
  });

  it("membership is pinned; growth is a reviewed diff", () => {
    expect([...collisions].sort()).toEqual([
      "a", "are", "aroma", "be", "case", "come", "dice", "do",
      // 2026-08-06: English "fine" resolved to `finar` ("to pass away", A2).
      "fine",
      "he", "mate",
      "me", "no", "okay", "once", "red", "sale",
      // 2026-08-06, post-psm re-measure: English "snack" resolved to the C1
      // Spanish loanword and flagged as a violation in an English frame.
      "snack",
      "so", "ten", "too", "tour", "use", "vine"
    ]);
  });

  it("italian: membership is pinned; growth is a reviewed diff", () => {
    // Written from knowledge of both languages rather than measured from
    // captured violations, because there is no Italian capture corpus and
    // waiting for one meant shipping the bug. Pinned all the same.
    expect([...englishCollisionSurfaces("it")].sort()).toEqual([
      "a", "ago", "ape", "area", "camera", "cane", "case", "come", "con",
      "costume", "data", "date", "dice", "do", "due", "era", "fine", "forte",
      "gusto", "i", "idea", "in", "male", "mare", "me", "no", "note", "opera",
      "pace", "pane", "per", "piano", "pose", "pure", "rate", "rose", "sale",
      "salsa", "salute", "serve", "solo", "studio", "tale", "tempo", "via",
      "viola", "vista", "zero"
    ]);
  });

  it("italian: every listed surface really resolves, or listing it does nothing", () => {
    // The guard fires on a surface that RESOLVES to an Italian lemma. One that
    // resolves to nothing was never going to be credited, so listing it is
    // inert and hides the fact that the real collision is spelled differently.
    const index = (
      itMorphology as { forms: Record<string, { lemmaId: string }> }
    ).forms;
    for (const surface of englishCollisionSurfaces("it")) {
      expect(index[surface]?.lemmaId, surface).toBeTruthy();
    }
  });

  it("italian: deliberately EXCLUDES lookalikes whose English word is rare", () => {
    // These are real Italian words that are also English words, and they are
    // left out on purpose: nobody writing English types `stanza` or `penne`
    // by accident, so listing them would only cost Italian learners credit.
    const it = englishCollisionSurfaces("it");
    for (const surface of ["capo", "stanza", "penne", "novella", "volta", "vale"]) {
      expect(it.has(surface), surface).toBe(false);
    }
  });
});
