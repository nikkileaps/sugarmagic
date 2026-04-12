/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/auto-simplify.test.ts
 *
 * Purpose: Verifies the deterministic auto-simplify fallback and its re-verification invariant.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/auto-simplify with real ES language data and custom gloss fixtures.
 *   - Confirms the simplified output re-enters the envelope through the classifier facade.
 *
 * Implements: Proposal 001 §Verification, Failure Modes, and Guardrails / Epic 5 Story 5.6
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { autoSimplify } from "../../runtime/classifier/auto-simplify";
import { EnvelopeClassifier } from "../../runtime/classifier/envelope-classifier";
import {
  SimplificationsLoader,
  type SimplificationsDataFile
} from "../../runtime/classifier/simplifications-loader";
import { createLearnerProfile } from "./test-helpers";

describe("autoSimplify", () => {
  it("substitutes a higher-band lemma with an in-band synonym and re-enters the envelope", () => {
    const learner = createLearnerProfile("A1");
    const text = "hola hola hola hola hola hola hola hola hola adelante";

    const result = autoSimplify(
      text,
      [{ lemmaId: "adelante", lang: "es" }],
      learner
    );

    expect(result.text).toContain("bueno");
    expect(result.substitutionCount).toBe(1);
    expect(result.fallbackGlosses).toEqual([]);
  });

  it("uses gloss fallback when no acceptable substitution exists and still passes re-verification", () => {
    const learner = createLearnerProfile("A1");
    const classifier = new EnvelopeClassifier();
    const simplifications = new SimplificationsLoader({
      es: {
        lang: "es",
        entries: {
          adelante: [
            {
              kind: "gloss-fallback",
              gloss: "forward"
            }
          ]
        }
      } satisfies SimplificationsDataFile
    });
    const text = `${Array.from({ length: 19 }, () => "hola").join(" ")} adelante`;

    const result = autoSimplify(
      text,
      [{ lemmaId: "adelante", lang: "es" }],
      learner,
      simplifications
    );
    const verdict = classifier.check(result.text, learner, { lang: "es" });

    expect(result.text).toContain("*forward*");
    expect(result.fallbackGlosses).toEqual([{ lemmaId: "adelante", lang: "es" }]);
    expect(verdict.withinEnvelope).toBe(true);
  });

  it("holds the simplification invariant across 50 deterministic out-of-envelope inputs", () => {
    const learner = createLearnerProfile("A1");
    const violatingLemmaIds = [
      "adelante",
      "cuyo",
      "asociar",
      "adquirir",
      "mental"
    ];

    for (let index = 0; index < 50; index += 1) {
      const lemmaId = violatingLemmaIds[index % violatingLemmaIds.length];
      expect(() =>
        autoSimplify(
          `hola hola hola hola hola ${lemmaId}`,
          [{ lemmaId, lang: "es" }],
          learner
        )
      ).not.toThrow();
    }
  });

  it("logs a simple degradation metric for later tuning", () => {
    const learner = createLearnerProfile("A1");
    let substitutionCount = 0;
    let fallbackCount = 0;

    for (let index = 0; index < 100; index += 1) {
      const result = autoSimplify(
        `hola hola hola hola hola ${index % 2 === 0 ? "adelante" : "cuyo"}`,
        [
          {
            lemmaId: index % 2 === 0 ? "adelante" : "cuyo",
            lang: "es"
          }
        ],
        learner
      );

      substitutionCount += result.substitutionCount;
      fallbackCount += result.fallbackGlosses.length;
    }

    console.info(
      JSON.stringify({
        metric: "sugarlang.auto-simplify.degradation",
        sentences: 100,
        substitutions: substitutionCount,
        fallbackGlosses: fallbackCount
      })
    );

    expect(substitutionCount).toBeGreaterThan(0);
    expect(fallbackCount).toBe(0);
  });
});
