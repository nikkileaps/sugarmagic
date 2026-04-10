/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/envelope-rule.test.ts
 *
 * Purpose: Guards the deterministic envelope rule and its exemption clauses.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/envelope-rule as a pure rule function.
 *   - Uses direct CoverageProfile fixtures so every clause is testable in isolation.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / §Quest-Essential Lemma Exemption / Epic 5 Story 5.4
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { CoverageProfile, LemmaRef, LexicalPrescription } from "../../runtime/types";
import {
  ENVELOPE_KRASHEN_FLOOR,
  ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE,
  applyEnvelopeRule
} from "../../runtime/classifier/envelope-rule";

function createLemma(lemmaId: string, surfaceForm = lemmaId): LemmaRef {
  return {
    lemmaId,
    surfaceForm,
    lang: "es"
  };
}

function createProfile(
  overrides: Partial<CoverageProfile> = {}
): CoverageProfile {
  return {
    totalTokens: 10,
    knownTokens: 10,
    inBandTokens: 10,
    unknownTokens: 0,
    bandHistogram: {
      A1: 10,
      A2: 0,
      B1: 0,
      B2: 0,
      C1: 0,
      C2: 0
    },
    outOfEnvelopeLemmas: [],
    ceilingExceededLemmas: [],
    questEssentialLemmasMatched: [],
    coverageRatio: 1,
    ...overrides
  };
}

function createPrescription(lemmaIds: string[]): LexicalPrescription {
  return {
    introduce: lemmaIds.map((lemmaId) => ({ lemmaId, lang: "es" })),
    reinforce: [],
    avoid: [],
    budget: {
      newItemsAllowed: lemmaIds.length
    },
    rationale: {
      candidateSetSize: lemmaIds.length,
      envelopeSurvivorCount: lemmaIds.length,
      priorityScores: [],
      reasons: []
    }
  };
}

describe("applyEnvelopeRule", () => {
  it("passes fully in-envelope profiles", () => {
    const result = applyEnvelopeRule(createProfile(), "A1");

    expect(result.withinEnvelope).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.exemptionsApplied).toEqual([]);
  });

  it("fails when coverage drops below the Krashen floor", () => {
    const result = applyEnvelopeRule(
      createProfile({
        coverageRatio: 0.949
      }),
      "A1"
    );

    expect(result.withinEnvelope).toBe(false);
  });

  it("fails when a non-exempt lemma exceeds learnerBand + 1", () => {
    const forbiddenLemma = createLemma("equilátero");
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [forbiddenLemma],
        ceilingExceededLemmas: [forbiddenLemma]
      }),
      "A1"
    );

    expect(result.withinEnvelope).toBe(false);
    expect(result.violations).toEqual([forbiddenLemma]);
  });

  it("fails when more than two non-exempt out-of-band lemmas remain", () => {
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [
          createLemma("andar"),
          createLemma("barco"),
          createLemma("carta")
        ]
      }),
      "A1"
    );

    expect(result.withinEnvelope).toBe(false);
  });

  it("passes when all out-of-band lemmas are prescription introductions", () => {
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [
          createLemma("andar"),
          createLemma("barco"),
          createLemma("carta")
        ]
      }),
      "A1",
      {
        prescription: createPrescription(["andar", "barco", "carta"])
      }
    );

    expect(result.withinEnvelope).toBe(true);
    expect(result.exemptionsApplied).toEqual([
      "prescription-introduce",
      "prescription-introduce",
      "prescription-introduce"
    ]);
  });

  it("passes when no more than two non-exempt out-of-band lemmas remain", () => {
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [createLemma("andar"), createLemma("barco")]
      }),
      "A1"
    );

    expect(result.withinEnvelope).toBe(true);
  });

  it("locks the literal regression-guard thresholds", () => {
    expect(ENVELOPE_KRASHEN_FLOOR).toBe(0.95);
    expect(ENVELOPE_OUT_OF_ENVELOPE_ALLOWANCE).toBe(2);
  });

  it("passes the Ethereal Altar regression case through the quest-essential exemption", () => {
    const altar = createLemma("altar");
    const etereo = createLemma("etéreo");
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [altar, etereo],
        ceilingExceededLemmas: [altar, etereo],
        questEssentialLemmasMatched: ["altar", "etéreo"]
      }),
      "A1",
      {
        prescription: createPrescription([]),
        questEssentialLemmas: new Set(["altar", "etéreo"])
      }
    );

    expect(result.withinEnvelope).toBe(true);
    expect(result.exemptionsApplied).toEqual([
      "quest-essential",
      "quest-essential"
    ]);
  });

  it("honors quest-essential independently of prescription", () => {
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [createLemma("altar"), createLemma("etéreo")],
        ceilingExceededLemmas: [createLemma("altar"), createLemma("etéreo")]
      }),
      "A1",
      {
        prescription: createPrescription([]),
        questEssentialLemmas: new Set(["altar", "etéreo"])
      }
    );

    expect(result.withinEnvelope).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not let quest-essential bypass the coverage floor", () => {
    const result = applyEnvelopeRule(
      createProfile({
        coverageRatio: 0.5,
        outOfEnvelopeLemmas: [createLemma("altar"), createLemma("etéreo")],
        ceilingExceededLemmas: [createLemma("altar"), createLemma("etéreo")]
      }),
      "A1",
      {
        questEssentialLemmas: new Set(["altar", "etéreo"])
      }
    );

    expect(result.withinEnvelope).toBe(false);
  });

  it("uses deterministic exemption attribution priority", () => {
    const result = applyEnvelopeRule(
      createProfile({
        outOfEnvelopeLemmas: [createLemma("altar")]
      }),
      "A1",
      {
        prescription: createPrescription(["altar"]),
        questEssentialLemmas: new Set(["altar"])
      }
    );

    expect(result.withinEnvelope).toBe(true);
    expect(result.exemptionsApplied).toEqual(["prescription-introduce"]);
  });
});
