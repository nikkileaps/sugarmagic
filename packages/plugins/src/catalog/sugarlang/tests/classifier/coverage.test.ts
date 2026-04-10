/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/coverage.test.ts
 *
 * Purpose: Verifies the deterministic coverage-profile computation for Epic 5.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/coverage with fake atlas fixtures and real tokenization.
 *   - Depends on ./test-helpers for compact learner, atlas, and morphology setup.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / Epic 5 Story 5.3
 *
 * Status: active
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createChunkMatcher } from "../../runtime/classifier/chunk-matcher";
import { computeCoverage } from "../../runtime/classifier/coverage";
import { tokenize } from "../../runtime/classifier/tokenize";
import {
  createLearnerProfile,
  createLexicalAtlasProvider,
  createMorphologyData
} from "./test-helpers";

describe("computeCoverage", () => {
  it("returns full coverage for A1 text given an A1 learner", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "día", cefrPriorBand: "A1" }
    ]);
    const morphology = createMorphologyData("es", {
      hola: "hola",
      días: "día"
    });

    const profile = computeCoverage(
      tokenize("Hola hola días", "es"),
      learner,
      atlas,
      new Set(),
      morphology
    );

    expect(profile.coverageRatio).toBe(1);
    expect(profile.outOfEnvelopeLemmas).toEqual([]);
    expect(profile.ceilingExceededLemmas).toEqual([]);
    expect(profile.unknownTokens).toBe(0);
  });

  it("tracks low coverage and ceiling-exceeding lemmas", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "arcano", cefrPriorBand: "C1" }
    ]);
    const morphology = createMorphologyData("es", {
      hola: "hola",
      arcano: "arcano"
    });

    const profile = computeCoverage(
      tokenize("hola hola hola hola hola hola hola hola hola arcano", "es"),
      learner,
      atlas,
      new Set(),
      morphology
    );

    expect(profile.coverageRatio).toBe(0.9);
    expect(profile.outOfEnvelopeLemmas).toEqual([
      {
        lemmaId: "arcano",
        surfaceForm: "arcano",
        lang: "es"
      }
    ]);
    expect(profile.ceilingExceededLemmas).toEqual(profile.outOfEnvelopeLemmas);
  });

  it("treats known entities as in-envelope tokens", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" }
    ]);
    const morphology = createMorphologyData("es", {
      hola: "hola"
    });

    const profile = computeCoverage(
      tokenize("hola Orrin Wordlark Hollow", "es"),
      learner,
      atlas,
      new Set(["orrin", "wordlark", "hollow"]),
      morphology
    );

    expect(profile.knownTokens).toBe(4);
    expect(profile.unknownTokens).toBe(0);
    expect(profile.coverageRatio).toBe(1);
  });

  it("counts unknown surface forms explicitly", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" }
    ]);
    const morphology = createMorphologyData("es", {
      hola: "hola"
    });

    const profile = computeCoverage(
      tokenize("hola asdfzxcv", "es"),
      learner,
      atlas,
      new Set(),
      morphology
    );

    expect(profile.totalTokens).toBe(2);
    expect(profile.unknownTokens).toBe(1);
    expect(profile.coverageRatio).toBe(0.5);
  });

  it("treats empty text as vacuously in coverage", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", []);
    const profile = computeCoverage([], learner, atlas);

    expect(profile.totalTokens).toBe(0);
    expect(profile.coverageRatio).toBe(1);
    expect(profile.matchedChunks).toEqual([]);
    expect(profile.matchedChunkTokens).toEqual([]);
  });

  it("matches lexical chunks before lemma processing", () => {
    const learner = createLearnerProfile("A2");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "voy", cefrPriorBand: "A1" },
      { lemmaId: "al", cefrPriorBand: "A1" },
      { lemmaId: "mercado", cefrPriorBand: "A1" },
      { lemmaId: "vez", cefrPriorBand: "B2" },
      { lemmaId: "cuando", cefrPriorBand: "A1" }
    ]);
    const morphology = createMorphologyData("es", {
      voy: "voy",
      de: "de",
      vez: "vez",
      en: "en",
      cuando: "cuando",
      al: "al",
      mercado: "mercado"
    });
    const chunks = [
      {
        chunkId: "de_vez_en_cuando",
        normalizedForm: "de_vez_en_cuando",
        surfaceForms: ["de vez en cuando"],
        cefrBand: "A2" as const,
        constituentLemmas: ["vez", "cuando"],
        extractedByModel: "test-model",
        extractedAtMs: 1,
        extractorPromptVersion: "1",
        source: "llm-extracted" as const
      }
    ];
    const text = "Voy de vez en cuando al mercado";
    const tokens = tokenize(text, "es");
    const matcher = createChunkMatcher(chunks, "es", text);

    const profile = computeCoverage(
      tokens,
      learner,
      atlas,
      new Set(),
      morphology,
      new Set(),
      matcher,
      chunks
    );

    expect(profile.matchedChunks).toEqual(chunks);
    expect(profile.matchedChunkTokens[0]).toEqual(
      expect.objectContaining({
        chunkId: "de_vez_en_cuando",
        surfaceMatched: "de vez en cuando",
        cefrBand: "A2"
      })
    );
    expect(profile.outOfEnvelopeLemmas).toEqual([]);
  });

  it("stays within the performance budget for typical NPC reply lengths", () => {
    const learner = createLearnerProfile("A1");
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "día", cefrPriorBand: "A1" }
    ]);
    const morphology = createMorphologyData("es", {
      hola: "hola",
      días: "día"
    });
    const tokens = tokenize(
      Array.from({ length: 40 }, () => "hola días").join(" "),
      "es"
    );

    const iterations = 100;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      computeCoverage(tokens, learner, atlas, new Set(), morphology);
    }
    const averageDurationMs = (performance.now() - startedAt) / iterations;

    expect(averageDurationMs).toBeLessThan(3);
  });
});
