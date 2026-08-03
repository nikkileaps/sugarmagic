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

  // DELETED a wall-clock performance assertion (2026-08-02).
  //
  // It asserted a millisecond budget while vitest runs test files in PARALLEL,
  // so it measured whatever else the machine was doing as much as the code. It
  // passed every run in isolation and failed intermittently in the suite, which
  // is the worst kind of test: it teaches you to ignore a red run.
  //
  // Nothing replaces it here. A latency bar needs a harness that controls what
  // else is running; asserting one from inside the unit suite cannot work.


  it("strips gesture-tag spans before tokenization", () => {
    const tokens = tokenize("*slaps knee* ¡Ay, qué cosa!", "es");
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).not.toContain("slaps");
    expect(surfaces).not.toContain("knee");
    expect(surfaces).toContain("ay");
    expect(surfaces).toContain("qué");
    expect(surfaces).toContain("cosa");
  });

  it("strips a mid-sentence gesture tag leaving surrounding words intact", () => {
    const tokens = tokenize("Hola *waves* amigo", "es");
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).toEqual(["hola", "amigo"]);
  });

  it("returns empty when input is only a gesture tag", () => {
    expect(tokenize("*nods slowly*", "es")).toEqual([]);
  });

  it("does not strip asterisks used as multiplication or standalone punctuation", () => {
    const tokens = tokenize("3 * 4 es doce", "es");
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).toContain("3");
    expect(surfaces).toContain("4");
    expect(surfaces).toContain("doce");
  });
});
