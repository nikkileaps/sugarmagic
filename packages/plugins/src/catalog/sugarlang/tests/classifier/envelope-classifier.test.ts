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
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
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

  it("treats chunk matches as in-envelope units for an A2 learner", async () => {
    const atlas = createLexicalAtlasProvider("es", [
      { lemmaId: "voy", cefrPriorBand: "A1" },
      { lemmaId: "al", cefrPriorBand: "A1" },
      { lemmaId: "mercado", cefrPriorBand: "A1" },
      { lemmaId: "vez", cefrPriorBand: "B2" },
      { lemmaId: "cuando", cefrPriorBand: "A1" }
    ]);
    const morphology = new MorphologyLoader({
      es: createMorphologyData("es", {
        voy: "voy",
        de: "de",
        vez: "vez",
        en: "en",
        cuando: "cuando",
        al: "al",
        mercado: "mercado"
      })
    });
    const telemetry = new MemoryTelemetrySink();
    const classifier = new EnvelopeClassifier(atlas, morphology, {
      telemetry
    });
    const learner = createLearnerProfile("A2");
    const sceneLexicon = {
      regionId: "scene-1",
      contentHash: "hash-1",
      chunks: [
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
      ]
    };

    const verdict = classifier.check("Voy de vez en cuando al mercado", learner, {
      lang: "es",
      sceneLexicon,
      conversationId: "conversation-1",
      turnId: "turn-1",
      sessionId: "session-1"
    });
    const events = await telemetry.query({
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventKinds: ["chunk.hit-during-classification"]
    });

    expect(verdict.withinEnvelope).toBe(true);
    expect(verdict.profile.matchedChunks).toEqual(sceneLexicon.chunks);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: "chunk.hit-during-classification",
        regionId: "scene-1"
      })
    );
  });

  it("reuses the cached chunk matcher for repeated scene checks", () => {
    const classifier = new EnvelopeClassifier();
    const learner = createLearnerProfile("A2");
    const sceneLexicon = {
      regionId: "scene-1",
      contentHash: "hash-shared",
      chunks: [
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
      ]
    };

    classifier.check("Voy de vez en cuando", learner, {
      lang: "es",
      sceneLexicon
    });
    classifier.check("Voy de vez en cuando", learner, {
      lang: "es",
      sceneLexicon
    });

    expect(classifier.getCachedChunkMatcherCount()).toBe(1);
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

    // THE WORDS HAVE TO BE RECOGNIZED, not merely fail to violate anything.
    //
    // `withinEnvelope` alone passed while the Spanish line resolved ZERO of its
    // 60 tokens -- reading Spanish text against the Italian half of the atlas
    // recognizes nothing, and recognizing nothing violates nothing. Asserting
    // the coverage is what makes reading a line in the wrong language fail.
    expect(spanishVerdict.profile.unknownTokens).toBe(0);
    expect(spanishVerdict.profile.knownTokens).toBeGreaterThan(0);
    expect(italianVerdict.profile.unknownTokens).toBe(0);
    expect(italianVerdict.profile.knownTokens).toBeGreaterThan(0);
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

  it("085.1 regression: cached chunk matcher returns correct surfaceMatched for a different turn text", () => {
    const classifier = new EnvelopeClassifier();
    const learner = createLearnerProfile("A2");
    const sceneLexicon = {
      regionId: "scene-1",
      contentHash: "hash-cache-regression",
      chunks: [
        {
          chunkId: "buenos_dias",
          normalizedForm: "buenos_dias",
          surfaceForms: ["buenos dias", "buenos días"],
          cefrBand: "A1" as const,
          constituentLemmas: ["bueno", "dia"],
          extractedByModel: "test",
          extractedAtMs: 1,
          extractorPromptVersion: "1",
          source: "llm-extracted" as const
        }
      ]
    };

    // First call seeds the cache.
    const firstVerdict = classifier.check("Hola, buenos días, amigo.", learner, {
      lang: "es",
      sceneLexicon
    });

    // Second call uses a different text (same scene). Before the fix the cached
    // matcher would slice surfaceMatched from the first text at new offsets.
    const secondVerdict = classifier.check("buenos días de hoy", learner, {
      lang: "es",
      sceneLexicon
    });

    // Cache should have been reused (still 1 entry).
    expect(classifier.getCachedChunkMatcherCount()).toBe(1);

    // Both verdicts should find the chunk with correct surface slice.
    expect(firstVerdict.profile.matchedChunkTokens[0]?.surfaceMatched).toMatch(/buenos d/i);
    expect(secondVerdict.profile.matchedChunkTokens[0]?.surfaceMatched).toMatch(/buenos d/i);
    // Specifically verify the second call's surfaceMatched starts at the right offset
    // (not sliced from the first text).
    expect(secondVerdict.profile.matchedChunkTokens[0]?.start).toBe(0);
  });
});
