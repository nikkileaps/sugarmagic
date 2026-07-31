/**
 * packages/plugins/src/catalog/sugarlang/tests/grading/graded-text-marker.test.ts
 *
 * Purpose: Guards the diglot weave -- citation-form substitution, chunk-surface
 *          substitution, English-frame preservation, and the mixed-text envelope
 *          predicate on typical woven output.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/grading/graded-text-marker.ts with a mock LexicalAtlasProvider.
 *   - Exercises runtime/classifier/envelope-rule.ts applyMixedTextEnvelopePredicate.
 *
 * Implements: Plan 086 story 086.2
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { LexicalAtlasProvider, AtlasLemmaEntry } from "../../runtime/types";
import type { InventoryChunk } from "../../runtime/contracts/competency-inventory";
import { markGradedText } from "../../runtime/grading/graded-text-marker";
import {
  applyMixedTextEnvelopePredicate,
  ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE
} from "../../runtime/classifier/envelope-rule";
import type { CoverageProfile, LemmaRef, LexicalPrescription } from "../../runtime/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAtlasEntry(lemmaId: string, gloss: string): AtlasLemmaEntry {
  return {
    lemmaId,
    lang: "es",
    cefrPriorBand: "A1",
    frequencyRank: 1,
    partsOfSpeech: ["noun"],
    glosses: { en: gloss }
  };
}

/**
 * Minimal mock LexicalAtlasProvider.
 * glossMap: { englishWord -> AtlasLemmaEntry[] }
 */
function makeMockAtlas(
  glossMap: Record<string, AtlasLemmaEntry[]>
): LexicalAtlasProvider {
  const normalizedMap: Record<string, AtlasLemmaEntry[]> = {};
  for (const [k, v] of Object.entries(glossMap)) {
    normalizedMap[k.toLowerCase()] = v;
  }
  return {
    getLemma: () => undefined,
    getBand: () => undefined,
    getFrequencyRank: () => undefined,
    getGloss: () => undefined,
    resolveFromGloss(glossWord: string): AtlasLemmaEntry[] {
      return normalizedMap[glossWord.toLowerCase()] ?? [];
    },
    listLemmasAtBand: () => [],
    getAtlasVersion: () => "test"
  };
}

function makeIntroduce(lemmaIds: string[]): Array<{ lemmaId: string; lang: string }> {
  return lemmaIds.map((id) => ({ lemmaId: id, lang: "es" }));
}

function makeInventoryChunk(
  chunkId: string,
  surfaceForm: string,
  constituentLemmas: string[]
): InventoryChunk {
  return {
    chunkId,
    normalizedForm: chunkId,
    surfaceForms: [surfaceForm],
    cefrBand: "A1",
    constituentLemmas
  };
}

// ---------------------------------------------------------------------------
// Envelope predicate fixture helpers
// ---------------------------------------------------------------------------

function createProfile(
  overrides: Partial<CoverageProfile> = {}
): CoverageProfile {
  return {
    totalTokens: 10,
    knownTokens: 8,
    inBandTokens: 8,
    // Coverage below 0.95 (0.8) to confirm the floor is NOT applied.
    unknownTokens: 2,
    bandHistogram: { A1: 8, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
    outOfEnvelopeLemmas: [],
    ceilingExceededLemmas: [],
    questEssentialLemmasMatched: [],
    matchedChunks: [],
    matchedChunkTokens: [],
    coverageRatio: 0.8, // below Krashen floor intentionally
    ratioCheckTokens: 10,
    resolvedTargetLanguageTokens: 2,
    ...overrides
  };
}

function createLemmaRef(lemmaId: string): LemmaRef {
  return { lemmaId, surfaceForm: lemmaId, lang: "es" };
}

function createPrescription(lemmaIds: string[]): LexicalPrescription {
  return {
    introduce: lemmaIds.map((id) => ({ lemmaId: id, lang: "es" })),
    reinforce: [],
    avoid: [],
    budget: { newItemsAllowed: lemmaIds.length },
    rationale: { candidateSetSize: 0, envelopeSurvivorCount: 0, priorityScores: [], reasons: [] }
  };
}

// ---------------------------------------------------------------------------
// markGradedText tests
// ---------------------------------------------------------------------------

describe("markGradedText", () => {
  it("substitutes an English word with its bare citation form when it resolves to an introduced lemma", () => {
    const atlas = makeMockAtlas({ hello: [makeAtlasEntry("hola", "hello")] });
    const result = markGradedText(
      "Hello, how are you?",
      makeIntroduce(["hola"]),
      [],
      atlas,
      "es",
      "en"
    );

    // The substitution is bare -- no asterisks. Sentence-initial, so it
    // carries sentence case rather than the bare lowercase citation form.
    expect(result.text).toContain("Hola");
    expect(result.text).not.toContain("*");
    expect(result.markedForms).toHaveLength(1);
    expect(result.markedForms[0]!.targetForm).toBe("hola");
    expect(result.markedForms[0]!.englishGloss).toBe("hello");
    expect(result.markedForms[0]!.lemmaId).toBe("hola");
  });

  it("substitutes a chunk surface form when an English word resolves to a constituent lemma in the introduce list", () => {
    // "buenos" resolves to "bueno"; "bueno" is a constituent of the "buenos dias" chunk.
    const atlas = makeMockAtlas({ buenos: [makeAtlasEntry("bueno", "buenos")] });
    const chunk = makeInventoryChunk("buenos_dias", "buenos dias", ["bueno", "dia"]);
    const result = markGradedText(
      "Buenos, how are you?",
      makeIntroduce(["bueno"]),
      [chunk],
      atlas,
      "es",
      "en"
    );

    // The chunk surface form is substituted, not just the bare lemma.
    expect(result.text).toContain("Buenos dias");
    expect(result.text).not.toContain("*");
    expect(result.markedForms).toHaveLength(1);
    expect(result.markedForms[0]!.targetForm).toBe("buenos dias");
  });

  it("leaves English words NOT in the introduce list unchanged", () => {
    const atlas = makeMockAtlas({
      hello: [makeAtlasEntry("hola", "hello")],
      station: [makeAtlasEntry("estacion", "station")]
    });
    // Only "hola" is introduced; "estacion" is not.
    const result = markGradedText(
      "Hello at the station.",
      makeIntroduce(["hola"]),
      [],
      atlas,
      "es",
      "en"
    );

    expect(result.text).toContain("Hola");
    // "station" must remain in English because "estacion" is not introduced.
    expect(result.text).toContain("station");
    expect(result.text).not.toContain("estacion");
  });

  it("returns text unchanged and empty markedForms when introduce list is empty", () => {
    const atlas = makeMockAtlas({ hello: [makeAtlasEntry("hola", "hello")] });
    const authoredText = "Hello, welcome!";
    const result = markGradedText(
      authoredText,
      makeIntroduce([]),
      [],
      atlas,
      "es",
      "en"
    );

    expect(result.text).toBe(authoredText);
    expect(result.markedForms).toHaveLength(0);
  });

  it("substituted forms contain no asterisk wrapping", () => {
    // Regression guard: gesture-tag wrapping (*...*) would erase the form from
    // coverage, ratio, and encounter counting.
    const atlas = makeMockAtlas({ goodbye: [makeAtlasEntry("adios", "goodbye")] });
    const result = markGradedText(
      "Goodbye, friend.",
      makeIntroduce(["adios"]),
      [],
      atlas,
      "es",
      "en"
    );

    for (const wf of result.markedForms) {
      expect(wf.targetForm).not.toMatch(/^\*/);
      expect(wf.targetForm).not.toMatch(/\*$/);
    }
    expect(result.text).not.toContain("*");
  });

  it("handles multiple substitutions across a sentence", () => {
    const atlas = makeMockAtlas({
      hello: [makeAtlasEntry("hola", "hello")],
      goodbye: [makeAtlasEntry("adios", "goodbye")]
    });
    const result = markGradedText(
      "Hello and goodbye.",
      makeIntroduce(["hola", "adios"]),
      [],
      atlas,
      "es",
      "en"
    );

    expect(result.text).toContain("Hola");
    expect(result.text).toContain("adios");
    expect(result.markedForms).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyMixedTextEnvelopePredicate tests
// ---------------------------------------------------------------------------

describe("applyMixedTextEnvelopePredicate", () => {
  it("passes even when coverage is below 0.95 (no floor check)", () => {
    // This is the key distinction from applyEnvelopeRule: the 95% floor does
    // NOT apply to mixed-text woven lines where the English frame is expected.
    const profile = createProfile({ coverageRatio: 0.6 });
    const result = applyMixedTextEnvelopePredicate(profile, "A1");

    expect(result.passes).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes when violations are at or below the allowance", () => {
    const profile = createProfile({
      outOfEnvelopeLemmas: [createLemmaRef("andar"), createLemmaRef("barco")]
    });
    const result = applyMixedTextEnvelopePredicate(profile, "A1");

    expect(result.passes).toBe(true);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.length).toBeLessThanOrEqual(ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE);
  });

  it("fails (leg 1) when non-exempt violations exceed the allowance", () => {
    const profile = createProfile({
      outOfEnvelopeLemmas: [
        createLemmaRef("andar"),
        createLemmaRef("barco"),
        createLemmaRef("carta")
      ]
    });
    const result = applyMixedTextEnvelopePredicate(profile, "A1");

    expect(result.passes).toBe(false);
    expect(result.violations).toHaveLength(3);
  });

  it("fails (leg 2) when a non-exempt lemma exceeds the CEFR ceiling", () => {
    const ceilingLemma = createLemmaRef("equilateral");
    const profile = createProfile({
      outOfEnvelopeLemmas: [ceilingLemma],
      ceilingExceededLemmas: [ceilingLemma]
    });
    const result = applyMixedTextEnvelopePredicate(profile, "A1");

    expect(result.passes).toBe(false);
  });

  it("passes when a ceiling-exceeded lemma is exempted by prescription-introduce", () => {
    const prescribedLemma = createLemmaRef("hola");
    const profile = createProfile({
      outOfEnvelopeLemmas: [prescribedLemma],
      ceilingExceededLemmas: [prescribedLemma]
    });
    const result = applyMixedTextEnvelopePredicate(profile, "A1", {
      taughtLemmaIds: ["hola"]
    });

    expect(result.passes).toBe(true);
    expect(result.exemptionsApplied).toContain("prescription-introduce");
  });

  it("passes on typical woven output with prescription options (envelope exit criterion)", () => {
    // Simulates a woven line: 10 tokens, 2 are the introduced target-lang forms
    // (counted in outOfEnvelopeLemmas but exempted by prescription), 8 are known
    // English tokens. Coverage is below 0.95 due to unknownTokens from the
    // English frame -- the predicate must still pass.
    const hola = createLemmaRef("hola");
    const profile = createProfile({
      coverageRatio: 0.75,
      unknownTokens: 8,
      knownTokens: 2,
      outOfEnvelopeLemmas: [hola],
      ceilingExceededLemmas: [],
      questEssentialLemmasMatched: []
    });
    const result = applyMixedTextEnvelopePredicate(profile, "A1", {
      taughtLemmaIds: ["hola"]
    });

    expect(result.passes).toBe(true);
    expect(result.exemptionsApplied).toContain("prescription-introduce");
  });
});

describe("markGradedText -- proper nouns and titles are protected", () => {
  const atlas = makeMockAtlas({
    station: [makeAtlasEntry("estación", "station")]
  });
  const introduce: Array<{ lemmaId: string; lang: string }> = [
    { lemmaId: "estación", lang: "es" }
  ];

  it("does not substitute inside a capitalised multi-word title", () => {
    // The shipped bug: "Station Manager" is a fixed title ("Jefe de Estación"
    // in Spanish), so swapping one constituent produces a hybrid.
    const result = markGradedText(
      "I'm Horace Pennyfeather, Station Manager. If you need anything just hollar.",
      introduce,
      [],
      atlas,
      "es",
      "en"
    );
    expect(result.text).toContain("Station Manager");
    expect(result.text).not.toContain("estación");
    expect(result.markedForms).toEqual([]);
  });

  it("still substitutes the same word when it is ordinary lowercase prose", () => {
    const result = markGradedText(
      "The station is closed today.",
      introduce,
      [],
      atlas,
      "es",
      "en"
    );
    expect(result.text).toContain("estación");
    expect(result.markedForms).toHaveLength(1);
  });

  it("substitutes a sentence-initial capital and preserves its casing", () => {
    const result = markGradedText(
      "Station closes at dusk.",
      introduce,
      [],
      atlas,
      "es",
      "en"
    );
    // Sentence case carries no proper-noun signal, so it is still woven --
    // but it must not come back lowercase mid-sentence-start.
    expect(result.text).toContain("Estación");
    expect(result.text).not.toMatch(/^estación/);
  });

  it("protects only the title occurrence when a word appears both ways", () => {
    const result = markGradedText(
      "The station is near. Ask the Station Manager.",
      introduce,
      [],
      atlas,
      "es",
      "en"
    );
    expect(result.text).toContain("estación is near");
    expect(result.text).toContain("Station Manager");
  });
});
