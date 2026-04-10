/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/envelope-classifier.test.ts
 *
 * Purpose: Verifies the end-to-end deterministic classifier facade.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/classifier/envelope-classifier with both fake and real data providers.
 *   - Depends on ./test-helpers for compact custom atlas/morphology fixtures.
 *
 * Implements: Proposal 001 §2. Envelope Classifier / Epic 5 Story 5.5
 *
 * Status: active
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { EnvelopeClassifier } from "../../runtime/classifier/envelope-classifier";
import { MorphologyLoader } from "../../runtime/classifier/morphology-loader";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import {
  createLearnerProfile,
  createLexicalAtlasProvider,
  createMorphologyData
} from "./test-helpers";

describe("EnvelopeClassifier", () => {
  it("accepts a simple real Spanish greeting for an A1 learner", () => {
    const classifier = new EnvelopeClassifier();
    const learner = createLearnerProfile("A1");

    const verdict = classifier.check("Hola, buenos días.", learner, {
      lang: "es"
    });

    expect(verdict.withinEnvelope).toBe(true);
    expect(verdict.worstViolation).toBeNull();
  });

  it("rejects clearly above-band text through the full facade", () => {
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "el", cefrPriorBand: "A1" },
      { lemmaId: "paralelogramo", cefrPriorBand: "B2" },
      { lemmaId: "equilátero", cefrPriorBand: "C1" }
    ]);
    const morphology = new MorphologyLoader({
      es: createMorphologyData("es", {
        el: "el",
        paralelogramo: "paralelogramo",
        equilátero: "equilátero"
      })
    });
    const classifier = new EnvelopeClassifier(atlas, morphology);
    const learner = createLearnerProfile("A1");

    const verdict = classifier.check("El paralelogramo es equilátero", learner, {
      lang: "es"
    });

    expect(verdict.withinEnvelope).toBe(false);
    expect(verdict.worstViolation?.lemmaRef.lemmaId).toBe("equilátero");
  });

  it("supports the repair-retry loop by rechecking simplified text", () => {
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "arcano", cefrPriorBand: "C1" }
    ]);
    const morphology = new MorphologyLoader({
      es: createMorphologyData("es", {
        hola: "hola",
        arcano: "arcano"
      })
    });
    const classifier = new EnvelopeClassifier(atlas, morphology);
    const learner = createLearnerProfile("A1");

    const failingVerdict = classifier.check("hola arcano", learner, {
      lang: "es"
    });
    const repairedVerdict = classifier.check("hola", learner, {
      lang: "es"
    });

    expect(failingVerdict.withinEnvelope).toBe(false);
    expect(failingVerdict.worstViolation?.lemmaRef.lemmaId).toBe("arcano");
    expect(repairedVerdict.withinEnvelope).toBe(true);
  });

  it("handles typical real Spanish and Italian reply lengths", () => {
    const classifier = new EnvelopeClassifier(new CefrLexAtlasProvider());
    const spanishLearner = createLearnerProfile("A1", {
      targetLanguage: "es"
    });
    const italianLearner = createLearnerProfile("A1", {
      targetLanguage: "it"
    });
    const spanishText = Array.from({ length: 20 }, () => "hola buenos días").join(" ");
    const italianText = Array.from({ length: 20 }, () => "ciao mi parlato e correndo").join(" ");

    const spanishVerdict = classifier.check(spanishText, spanishLearner, {
      lang: "es"
    });
    const italianVerdict = classifier.check(italianText, italianLearner, {
      lang: "it"
    });

    expect(spanishVerdict.withinEnvelope).toBe(true);
    expect(italianVerdict.withinEnvelope).toBe(true);
  });

  it("stays within the performance budget for repeated checks", () => {
    const classifier = new EnvelopeClassifier();
    const learner = createLearnerProfile("A1");
    const text = Array.from({ length: 20 }, () => "hola buenos días").join(" ");

    const iterations = 100;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      classifier.check(text, learner, { lang: "es" });
    }
    const durationMs = performance.now() - startedAt;

    expect(durationMs).toBeLessThan(500);
  });

  it("is deterministic for repeated identical inputs", () => {
    const classifier = new EnvelopeClassifier();
    const learner = createLearnerProfile("A1");

    const firstVerdict = classifier.check("Hola, buenos días.", learner, {
      lang: "es"
    });
    const secondVerdict = classifier.check("Hola, buenos días.", learner, {
      lang: "es"
    });

    expect(secondVerdict).toEqual(firstVerdict);
  });
});
