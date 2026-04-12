/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/publish-sugarlang-artifacts.test.ts
 *
 * Purpose: Verifies the publish helper writes complete chunk-aware lexicon artifacts.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/publish-sugarlang-artifacts and the classifier facade.
 *   - Uses the shared compile test fixtures so publish stays aligned with the one compiler.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness / Epic 14 Story 14.4
 *
 * Status: active
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EnvelopeClassifier } from "../../runtime/classifier/envelope-classifier";
import {
  loadPublishedSugarlangLexiconArtifact,
  publishSugarlangArtifacts
} from "../../runtime/compile/publish-sugarlang-artifacts";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";
import { createLearnerProfile } from "../classifier/test-helpers";

function createDependencies() {
  const scene = createTestSceneAuthoringContext();
  const atlas = createTestAtlasProvider("es", [
    { lemmaId: "hola", cefrPriorBand: "A1" },
    { lemmaId: "viajero", cefrPriorBand: "A1" },
    { lemmaId: "vez", cefrPriorBand: "B2" },
    { lemmaId: "cuando", cefrPriorBand: "A1" }
  ]);
  const morphology = createTestMorphologyLoader("es", {
    hola: "hola",
    viajero: "viajero",
    de: "de",
    vez: "vez",
    en: "en",
    cuando: "cuando"
  });

  return { scene, atlas, morphology };
}

describe("publishSugarlangArtifacts", () => {
  it("writes gzipped lexicons with chunks and they load back for classification", async () => {
    const { scene, atlas, morphology } = createDependencies();
    const outputRoot = await mkdtemp(join(tmpdir(), "sugarlang-publish-"));

    try {
      const artifacts = await publishSugarlangArtifacts({
        scenes: [scene],
        outputRoot,
        atlas,
        morphology,
        extractSceneChunks: async () => ({
          chunks: [
            {
              chunkId: "de_vez_en_cuando",
              normalizedForm: "de_vez_en_cuando",
              surfaceForms: ["de vez en cuando"],
              cefrBand: "A2",
              constituentLemmas: ["vez", "cuando"],
              extractedByModel: "test-model",
              extractedAtMs: 1,
              extractorPromptVersion: "1",
              source: "llm-extracted"
            }
          ],
          tokenCost: { input: 10, output: 5 },
          latencyMs: 1,
          model: "test-model"
        })
      });
      const lexicon = await loadPublishedSugarlangLexiconArtifact(
        artifacts[0]!.outputPath
      );
      const classifier = new EnvelopeClassifier(atlas, morphology);
      const learner = createLearnerProfile("A2");

      const verdict = classifier.check("de vez en cuando", learner, {
        lang: "es",
        sceneLexicon: lexicon
      });

      expect(lexicon.chunks).toHaveLength(1);
      expect(verdict.profile.matchedChunks).toHaveLength(1);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("fails loudly when chunk extraction fails for a scene", async () => {
    const { scene, atlas, morphology } = createDependencies();
    const outputRoot = await mkdtemp(join(tmpdir(), "sugarlang-publish-"));

    try {
      await expect(
        publishSugarlangArtifacts({
          scenes: [scene],
          outputRoot,
          atlas,
          morphology,
          extractSceneChunks: async () => ({
            chunks: [],
            tokenCost: { input: 0, output: 0 },
            latencyMs: 1,
            model: "test-model",
            failure: {
              code: "extractor_request_failed",
              message: "boom"
            }
          })
        })
      ).rejects.toThrow(/Chunk extraction failed/);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
