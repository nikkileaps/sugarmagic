/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/lemmatize.test.ts
 *
 * Purpose: Verifies token-to-lemma resolution against the shipped morphology data.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/lemmatize with real ES/IT morphology fixtures.
 *   - Covers both the Token-returning Epic 5 path and the string overload kept for data smoke tests.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / Epic 5 Story 5.2
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { lemmatize } from "../../runtime/classifier/lemmatize";

describe("lemmatize", () => {
  it("resolves Spanish forms to lemma refs", () => {
    expect(
      lemmatize(
        {
          surface: "corriendo",
          start: 0,
          end: 10,
          kind: "word"
        },
        "es"
      )
    ).toEqual({
      lemmaId: "correr",
      surfaceForm: "corriendo",
      lang: "es"
    });
  });

  it("resolves Italian forms to lemma refs", () => {
    expect(
      lemmatize(
        {
          surface: "parlato",
          start: 0,
          end: 7,
          kind: "word"
        },
        "it"
      )
    ).toEqual({
      lemmaId: "parlare",
      surfaceForm: "parlato",
      lang: "it"
    });
  });

  it("returns null for unknown forms", () => {
    expect(
      lemmatize(
        {
          surface: "asdfzxcv",
          start: 0,
          end: 8,
          kind: "word"
        },
        "es"
      )
    ).toBeNull();
  });

  it("handles uppercase input while preserving original surface form", () => {
    expect(
      lemmatize(
        {
          surface: "Corriendo",
          start: 0,
          end: 10,
          kind: "word"
        },
        "es"
      )
    ).toEqual({
      lemmaId: "correr",
      surfaceForm: "Corriendo",
      lang: "es"
    });
  });

  it("preserves accented surface forms", () => {
    expect(
      lemmatize(
        {
          surface: "días",
          start: 0,
          end: 4,
          kind: "word"
        },
        "es"
      )
    ).toEqual({
      lemmaId: "día",
      surfaceForm: "días",
      lang: "es"
    });
  });

  it("keeps the string overload for data smoke tests", () => {
    expect(lemmatize("corriendo", "es")).toBe("correr");
    expect(lemmatize("correndo", "it")).toBe("correre");
  });
});
