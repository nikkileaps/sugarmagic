/**
 * packages/plugins/src/catalog/sugarlang/tests/scheduler/comprehension-rate.test.ts
 *
 * Purpose: Pins the scene comprehension rate estimator and its constants.
 *
 * Implements: Plan 087 story 087.3
 *
 * Status: active
 */

import { describe, it, expect } from "vitest";
import {
  estimateSceneComprehensionRate,
  KNOWN_RETRIEVABILITY_THRESHOLD,
  TARGET_COMPREHENSION_RATE,
  STRETCH_COMPREHENSION_FLOOR
} from "../../runtime/scheduler/comprehension-rate";
import type { LemmaCard } from "../../runtime/types";

function makeCard(lemmaId: string, retrievability: number): LemmaCard {
  return {
    lemmaId,
    difficulty: 5,
    stability: 2,
    retrievability,
    lastReviewedAt: null,
    reviewCount: 1,
    lapseCount: 0,
    cefrPriorBand: "A1",
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

describe("estimateSceneComprehensionRate", () => {
  it("returns 1.0 when sceneLemmaIds is empty", () => {
    expect(estimateSceneComprehensionRate({}, [])).toBe(1.0);
  });

  it("returns 0 when no scene lemmas have cards", () => {
    const result = estimateSceneComprehensionRate({}, ["hola", "adios"]);
    expect(result).toBe(0);
  });

  it("counts lemmas at exactly KNOWN_RETRIEVABILITY_THRESHOLD as known", () => {
    const cards: Record<string, LemmaCard> = {
      hola: makeCard("hola", KNOWN_RETRIEVABILITY_THRESHOLD)
    };
    const result = estimateSceneComprehensionRate(cards, ["hola"]);
    expect(result).toBe(1.0);
  });

  it("excludes lemmas just below KNOWN_RETRIEVABILITY_THRESHOLD", () => {
    const cards: Record<string, LemmaCard> = {
      hola: makeCard("hola", KNOWN_RETRIEVABILITY_THRESHOLD - 0.001)
    };
    const result = estimateSceneComprehensionRate(cards, ["hola"]);
    expect(result).toBe(0);
  });

  it("returns correct fraction when some lemmas are known", () => {
    const cards: Record<string, LemmaCard> = {
      hola: makeCard("hola", 0.95),   // known
      adios: makeCard("adios", 0.50)  // not known
    };
    const result = estimateSceneComprehensionRate(cards, ["hola", "adios", "gracias"]);
    expect(result).toBeCloseTo(1 / 3);
  });

  it("treats missing card as retrievability=0 (unknown)", () => {
    const cards: Record<string, LemmaCard> = {
      hola: makeCard("hola", 0.95)
    };
    // "desconocida" has no card entry
    const result = estimateSceneComprehensionRate(cards, ["hola", "desconocida"]);
    expect(result).toBeCloseTo(0.5);
  });
});

describe("constants", () => {
  it("KNOWN_RETRIEVABILITY_THRESHOLD is 0.70", () => {
    expect(KNOWN_RETRIEVABILITY_THRESHOLD).toBe(0.70);
  });

  it("TARGET_COMPREHENSION_RATE is 0.65", () => {
    expect(TARGET_COMPREHENSION_RATE).toBe(0.65);
  });

  it("STRETCH_COMPREHENSION_FLOOR is 0.80", () => {
    expect(STRETCH_COMPREHENSION_FLOOR).toBe(0.80);
  });

  it("STRETCH_COMPREHENSION_FLOOR > TARGET_COMPREHENSION_RATE (floor is stricter)", () => {
    expect(STRETCH_COMPREHENSION_FLOOR).toBeGreaterThan(TARGET_COMPREHENSION_RATE);
  });
});
