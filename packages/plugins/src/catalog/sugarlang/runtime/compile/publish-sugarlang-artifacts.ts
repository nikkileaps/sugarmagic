/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/publish-sugarlang-artifacts.ts
 *
 * Purpose: Publishes compiled sugarlang lexicon artifacts, including mandatory chunk extraction.
 *
 * Exports:
 *   - SugarlangPublishArtifactsRequest
 *   - SugarlangPublishedArtifact
 *   - publishSugarlangArtifacts
 *   - loadPublishedSugarlangLexiconArtifact
 *
 * Relationships:
 *   - Depends on the canonical compiler, chunk extractor, and node gzip/fs helpers.
 *   - Is consumed by tests and the future publish pipeline integration point.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness / §Scene Lexicon Compilation
 *
 * Status: active
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { LexicalAtlasProvider, CompiledSceneLexicon } from "../types";
import type { MorphologyLoader } from "../classifier/morphology-loader";
import { compileSugarlangScene } from "./compile-sugarlang-scene";
import type { ExtractChunksResult } from "./extract-chunks";
import type { SceneAuthoringContext } from "./scene-traversal";

export interface SugarlangPublishedArtifact {
  sceneId: string;
  contentHash: string;
  outputPath: string;
  chunkCount: number;
}

export interface SugarlangPublishArtifactsRequest {
  scenes: SceneAuthoringContext[];
  outputRoot: string;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  concurrency?: number;
  onProgress?: (phase: "compile" | "extract-chunks" | "write", sceneId: string) => void;
  extractSceneChunks: (
    scene: SceneAuthoringContext,
    contentHash: string
  ) => Promise<ExtractChunksResult>;
}

async function runWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  worker: (input: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(inputs[currentIndex]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, inputs.length) }, () => runWorker())
  );

  return results;
}

export async function publishSugarlangArtifacts(
  request: SugarlangPublishArtifactsRequest
): Promise<SugarlangPublishedArtifact[]> {
  const scenes = [...request.scenes].sort((left, right) =>
    left.sceneId.localeCompare(right.sceneId)
  );

  return runWithConcurrency(
    scenes,
    request.concurrency ?? 4,
    async (scene): Promise<SugarlangPublishedArtifact> => {
      request.onProgress?.("compile", scene.sceneId);
      const baseLexicon = compileSugarlangScene(
        scene,
        request.atlas,
        request.morphology,
        "published-target"
      );

      request.onProgress?.("extract-chunks", scene.sceneId);
      const extraction = await request.extractSceneChunks(
        scene,
        baseLexicon.contentHash
      );
      if (extraction.failure) {
        throw new Error(
          `Chunk extraction failed for published scene "${scene.sceneId}": ${extraction.failure.message}`
        );
      }

      const finalLexicon: CompiledSceneLexicon = {
        ...baseLexicon,
        chunks: extraction.chunks
      };
      const outputPath = join(
        request.outputRoot,
        "compiled",
        "sugarlang",
        "scenes",
        `${scene.sceneId}.lexicon.json.gz`
      );
      await mkdir(dirname(outputPath), { recursive: true });

      request.onProgress?.("write", scene.sceneId);
      await writeFile(outputPath, gzipSync(JSON.stringify(finalLexicon)), "utf8");

      return {
        sceneId: scene.sceneId,
        contentHash: baseLexicon.contentHash,
        outputPath,
        chunkCount: extraction.chunks.length
      };
    }
  );
}

export async function loadPublishedSugarlangLexiconArtifact(
  artifactPath: string
): Promise<CompiledSceneLexicon> {
  const compressed = await readFile(artifactPath);
  const json = gunzipSync(compressed).toString("utf8");
  return JSON.parse(json) as CompiledSceneLexicon;
}
