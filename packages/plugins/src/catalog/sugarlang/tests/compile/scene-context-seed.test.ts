/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-context-seed.test.ts
 *
 * Purpose: Pins the Studio -> runtime seed path for scene-context models --
 *   the only way the runtime ever has one, since it cannot build them itself.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises preview-boot payload build/extract and the runtime memory store.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSugarlangPreviewBootPayload,
  extractSugarlangPreviewBootSceneContexts
} from "../../runtime/compile/preview-boot";
import {
  MemorySceneContextCache
} from "../../runtime/compile/scene-context-cache";
import {
  clearSugarlangRuntimeSceneContext,
  getSugarlangRuntimeSceneContext,
  seedSugarlangRuntimeSceneContext
} from "../../runtime/compile/runtime-cache-state";
import { SCENE_CONTEXT_PROMPT_VERSION } from "../../runtime/compile/scene-context-extractor";
import { compileSugarlangScene } from "../../runtime/compile/compile-sugarlang-scene";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

function makeModel(regionId: string, contentHash: string): SceneContextModel {
  return {
    regionId,
    contentHash,
    promptVersion: SCENE_CONTEXT_PROMPT_VERSION,
    supportLanguage: "en",
    prose: "A dock where cargo boats tie up.",
    concepts: [
      {
        label: "cheese",
        pos: "noun",
        provenance: [{ sourceId: "npc:npc-orrin", kind: "npc" }]
      }
    ],
    extractedAtMs: 1,
    extractedByModel: "gateway-resolved",
    reviewFlag: false
  };
}

const atlas = createTestAtlasProvider("es", [
  { lemmaId: "hola", cefrPriorBand: "A1" }
]);
const morphology = createTestMorphologyLoader("es", { hola: "hola" });

describe("scene-context seed path", () => {
  beforeEach(() => {
    clearSugarlangRuntimeSceneContext();
  });

  it("carries a built model through the boot payload to the runtime", async () => {
    const scene = createTestSceneAuthoringContext();
    const contentHash = compileSugarlangScene(
      scene,
      atlas,
      morphology,
      "runtime-preview"
    ).contentHash;

    const contextCache = new MemorySceneContextCache();
    await contextCache.set({
      key: {
        contentHash,
        supportLanguage: scene.supportLanguage,
        promptVersion: SCENE_CONTEXT_PROMPT_VERSION
      },
      regionId: scene.regionId,
      model: makeModel(scene.regionId, contentHash)
    });

    const payload = await buildSugarlangPreviewBootPayload(
      [scene],
      new MemoryCompileCache(),
      atlas,
      morphology,
      contextCache
    );

    seedSugarlangRuntimeSceneContext(
      extractSugarlangPreviewBootSceneContexts(payload)
    );

    const seeded = getSugarlangRuntimeSceneContext(scene.regionId);
    expect(seeded?.concepts.map((concept) => concept.label)).toEqual(["cheese"]);
  });

  it("ships nothing when the scene was never built", async () => {
    const payload = await buildSugarlangPreviewBootPayload(
      [createTestSceneAuthoringContext()],
      new MemoryCompileCache(),
      atlas,
      morphology,
      new MemorySceneContextCache()
    );

    // Absent is a legal, quiet state -- the Teacher simply has no situation.
    expect(extractSugarlangPreviewBootSceneContexts(payload)).toEqual([]);
  });

  it("ships nothing when the scene changed since the last build", async () => {
    const scene = createTestSceneAuthoringContext();
    const contextCache = new MemorySceneContextCache();
    // Built against a DIFFERENT content hash -- i.e. the author has edited the
    // scene since. Shipping it would describe text that no longer exists.
    await contextCache.set({
      key: {
        contentHash: "stale-hash",
        supportLanguage: scene.supportLanguage,
        promptVersion: SCENE_CONTEXT_PROMPT_VERSION
      },
      regionId: scene.regionId,
      model: makeModel(scene.regionId, "stale-hash")
    });

    const payload = await buildSugarlangPreviewBootPayload(
      [scene],
      new MemoryCompileCache(),
      atlas,
      morphology,
      contextCache
    );

    expect(extractSugarlangPreviewBootSceneContexts(payload)).toEqual([]);
  });

  it("omits the field entirely when no cache is supplied", async () => {
    // Callers that do not pass a context cache behave exactly as before.
    const payload = await buildSugarlangPreviewBootPayload(
      [createTestSceneAuthoringContext()],
      new MemoryCompileCache(),
      atlas,
      morphology
    );

    expect(payload.sceneContextModels).toBeUndefined();
    expect(extractSugarlangPreviewBootSceneContexts(payload)).toEqual([]);
  });

  it("tolerates a malformed payload", () => {
    expect(extractSugarlangPreviewBootSceneContexts(null)).toEqual([]);
    expect(extractSugarlangPreviewBootSceneContexts("nope")).toEqual([]);
    expect(
      extractSugarlangPreviewBootSceneContexts({ sceneContextModels: "nope" })
    ).toEqual([]);
  });

  it("returns undefined for a scene that was never seeded", () => {
    seedSugarlangRuntimeSceneContext([makeModel("scene-a", "hash")]);

    expect(getSugarlangRuntimeSceneContext("scene-b")).toBeUndefined();
  });
});
