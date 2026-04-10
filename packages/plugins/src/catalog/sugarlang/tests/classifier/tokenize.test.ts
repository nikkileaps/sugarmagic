/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/tokenize.test.ts
 *
 * Purpose: Verifies the deterministic tokenizer used by the envelope classifier.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/tokenize directly.
 *   - Guards the token-shape and position contract that later classifier stages rely on.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / Epic 5 Story 5.1
 *
 * Status: active
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../runtime/classifier/tokenize";

describe("tokenize", () => {
  it("tokenizes Spanish text with stable positions", () => {
    expect(tokenize("Hola, ¿cómo estás?", "es")).toEqual([
      { surface: "hola", start: 0, end: 4, kind: "word" },
      { surface: "cómo", start: 7, end: 11, kind: "word" },
      { surface: "estás", start: 12, end: 17, kind: "word" }
    ]);
  });

  it("tokenizes Italian text with stable positions", () => {
    expect(tokenize("Mi chiamo Sam.", "it")).toEqual([
      { surface: "mi", start: 0, end: 2, kind: "word" },
      { surface: "chiamo", start: 3, end: 9, kind: "word" },
      { surface: "sam", start: 10, end: 13, kind: "word" }
    ]);
  });

  it("preserves numbers as number tokens", () => {
    expect(tokenize("I have 3 cats", "en")).toContainEqual({
      surface: "3",
      start: 7,
      end: 8,
      kind: "number"
    });
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("", "es")).toEqual([]);
  });

  it("returns an empty array for punctuation-only input", () => {
    expect(tokenize("...?!", "es")).toEqual([]);
  });

  it("stays within the performance budget on a 500-token string", () => {
    const text = Array.from({ length: 250 }, () => "hola día").join(" ");
    const iterations = 100;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      tokenize(text, "es");
    }
    const averageDurationMs = (performance.now() - startedAt) / iterations;

    expect(averageDurationMs).toBeLessThan(2);
  });
});
