/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/compile-scheduler.test.ts
 *
 * Purpose: Verifies the background and runtime compile schedulers for Epic 6.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/compile-scheduler against the shared compiler and cache.
 *   - Depends on ./test-helpers for deterministic scene contexts.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import {
  RuntimeCompileScheduler,
  SugarlangAuthoringCompileScheduler
} from "../../runtime/compile/compile-scheduler";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

function createSchedulerDependencies() {
  const scenes = [
    createTestSceneAuthoringContext(),
    createTestSceneAuthoringContext({
      region: {
        ...createTestSceneAuthoringContext().region,
        identity: {
          ...createTestSceneAuthoringContext().region.identity,
          id: "scene-alt"
        }
      }
    })
  ];
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
  const cache = new MemoryCompileCache();

  return { scenes, atlas, morphology, cache };
}

describe("SugarlangAuthoringCompileScheduler", () => {
  it("debounces and compiles requested scenes into both preview profiles", async () => {
    vi.useFakeTimers();
    const { scenes, atlas, morphology, cache } = createSchedulerDependencies();
    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => scenes,
      atlas,
      morphology,
      cache,
      debounceMs: 10
    });

    scheduler.scheduleScene(scenes[0]!.sceneId);
    scheduler.scheduleScene(scenes[0]!.sceneId);
    await vi.advanceTimersByTimeAsync(10);

    const entries = await cache.listEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.profile).sort()).toEqual([
      "authoring-preview",
      "runtime-preview"
    ]);
    vi.useRealTimers();
  });
});

describe("RuntimeCompileScheduler", () => {
  it("lazy-compiles and caches missing scenes", async () => {
    const { scenes, atlas, morphology, cache } = createSchedulerDependencies();
    const scheduler = new RuntimeCompileScheduler({
      getScene: (sceneId) => scenes.find((scene) => scene.sceneId === sceneId) ?? null,
      atlas,
      morphology,
      cache,
      profile: "runtime-preview"
    });

    const first = await scheduler.ensureScene(scenes[0]!.sceneId);
    const second = await scheduler.ensureScene(scenes[0]!.sceneId);

    expect(first).toEqual(second);
    expect(await cache.has(first.sceneId, first.contentHash, first.profile)).toBe(true);
  });
});
