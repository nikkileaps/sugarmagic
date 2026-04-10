/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-lexicon-store.test.ts
 *
 * Purpose: Verifies the runtime-facing scene lexicon store abstraction.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/scene-lexicon-store and ../../runtime/compile/compile-scheduler.
 *   - Depends on ./test-helpers for deterministic scene fixtures.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import { RuntimeCompileScheduler } from "../../runtime/compile/compile-scheduler";
import { DefaultSugarlangSceneLexiconStore } from "../../runtime/compile/scene-lexicon-store";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

describe("DefaultSugarlangSceneLexiconStore", () => {
  it("returns seeded entries via get()", async () => {
    const scene = createTestSceneAuthoringContext();
    const atlas = createTestAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "viajero", cefrPriorBand: "A1" },
      { lemmaId: "altar", cefrPriorBand: "C1" },
      { lemmaId: "etéreo", cefrPriorBand: "C2" },
      { lemmaId: "investigate", cefrPriorBand: "B1" },
      { lemmaId: "keeper", cefrPriorBand: "C1" },
      { lemmaId: "temple", cefrPriorBand: "C1" }
    ]);
    const morphology = createTestMorphologyLoader("es", {
      hola: "hola",
      viajero: "viajero",
      altar: "altar",
      etéreo: "etéreo",
      investigate: "investigate",
      keeper: "keeper",
      temple: "temple"
    });
    const scheduler = new RuntimeCompileScheduler({
      getScene: () => scene,
      atlas,
      morphology,
      cache: new MemoryCompileCache(),
      profile: "runtime-preview"
    });
    const store = new DefaultSugarlangSceneLexiconStore(scheduler);
    const seeded = await scheduler.ensureScene(scene.sceneId);

    store.seed([seeded]);

    expect(store.get(scene.sceneId)).toEqual(seeded);
  });

  it("lazy-compiles missing entries via ensure()", async () => {
    const scene = createTestSceneAuthoringContext();
    const atlas = createTestAtlasProvider("es", [
      { lemmaId: "hola", cefrPriorBand: "A1" },
      { lemmaId: "viajero", cefrPriorBand: "A1" },
      { lemmaId: "altar", cefrPriorBand: "C1" },
      { lemmaId: "etéreo", cefrPriorBand: "C2" },
      { lemmaId: "investigate", cefrPriorBand: "B1" },
      { lemmaId: "keeper", cefrPriorBand: "C1" },
      { lemmaId: "temple", cefrPriorBand: "C1" }
    ]);
    const morphology = createTestMorphologyLoader("es", {
      hola: "hola",
      viajero: "viajero",
      altar: "altar",
      etéreo: "etéreo",
      investigate: "investigate",
      keeper: "keeper",
      temple: "temple"
    });
    const scheduler = new RuntimeCompileScheduler({
      getScene: () => scene,
      atlas,
      morphology,
      cache: new MemoryCompileCache(),
      profile: "runtime-preview"
    });
    const store = new DefaultSugarlangSceneLexiconStore(scheduler);

    const lexicon = await store.ensure(scene.sceneId);

    expect(lexicon.sceneId).toBe(scene.sceneId);
    expect(store.get(scene.sceneId)).toEqual(lexicon);
  });

  it("fires invalidation listeners", () => {
    const scheduler = {
      ensureScene: vi.fn()
    } as unknown as RuntimeCompileScheduler;
    const store = new DefaultSugarlangSceneLexiconStore(scheduler);
    const listener = vi.fn();
    const dispose = store.onInvalidate(listener);

    store.seed([
      {
        sceneId: "scene-a",
        contentHash: "hash",
        pipelineVersion: "1",
        atlasVersion: "atlas",
        profile: "runtime-preview",
        lemmas: {},
        properNouns: [],
        anchors: [],
        questEssentialLemmas: []
      }
    ]);
    store.invalidate("scene-a");
    dispose();

    expect(listener).toHaveBeenCalledWith("scene-a");
  });
});
