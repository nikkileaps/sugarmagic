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
import { MemoryTelemetrySink } from "../../runtime/telemetry/telemetry";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import { MemoryChunkCache } from "../../runtime/compile/chunk-cache";
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

  it("runs the tier-2 chunk pipeline after tier-1 compilation and skips cached hashes", async () => {
    vi.useFakeTimers();
    const { scenes, atlas, morphology, cache } = createSchedulerDependencies();
    const chunkCache = new MemoryChunkCache();
    const extractSceneChunks = vi.fn(async () => ({
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
      ],
      tokenCost: { input: 10, output: 5 },
      latencyMs: 1,
      model: "test-model"
    }));
    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => scenes,
      atlas,
      morphology,
      cache,
      debounceMs: 0,
      chunkPipeline: {
        cache: chunkCache,
        extractSceneChunks,
        promptVersion: "1",
        debounceMs: 5,
        telemetry: new MemoryTelemetrySink()
      }
    });

    scheduler.scheduleScene(scenes[0]!.sceneId);
    await scheduler.flush();
    await vi.advanceTimersByTimeAsync(5);

    const runtimeLexicon = await cache.listEntries();
    const chunkEntries = await chunkCache.listEntries();
    expect(extractSceneChunks).toHaveBeenCalledTimes(1);
    expect(runtimeLexicon).toHaveLength(2);
    expect(chunkEntries).toHaveLength(1);

    scheduler.scheduleScene(scenes[0]!.sceneId);
    await scheduler.flush();
    await vi.advanceTimersByTimeAsync(5);
    expect(extractSceneChunks).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("discards stale chunk results when the scene content changes before write-back", async () => {
    vi.useFakeTimers();
    const { scenes, atlas, morphology, cache } = createSchedulerDependencies();
    const telemetry = new MemoryTelemetrySink();
    let releaseExtraction: () => void = () => undefined;
    const extractSceneChunks = vi.fn(
      () =>
        new Promise<{
          chunks: any[];
          tokenCost: { input: number; output: number };
          latencyMs: number;
          model: string;
        }>((resolve) => {
          releaseExtraction = () =>
            resolve({
              chunks: [],
              tokenCost: { input: 1, output: 1 },
              latencyMs: 1,
              model: "test-model"
            });
        })
    );
    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => scenes,
      atlas,
      morphology,
      cache,
      debounceMs: 0,
      chunkPipeline: {
        cache: new MemoryChunkCache({ telemetry }),
        extractSceneChunks,
        promptVersion: "1",
        debounceMs: 0,
        telemetry
      }
    });

    scheduler.scheduleScene(scenes[0]!.sceneId);
    await scheduler.flush();
    const flushPromise = scheduler.flushChunks();
    await Promise.resolve();
    scenes[0] = {
      ...scenes[0]!,
      dialogues: [
        {
          ...scenes[0]!.dialogues[0]!,
          nodes: [
            {
              ...scenes[0]!.dialogues[0]!.nodes[0]!,
              text: "Hola viajero cambiado"
            }
          ]
        }
      ]
    };
    releaseExtraction();
    await flushPromise;

    const events = await telemetry.query({
      eventKinds: ["chunk.extraction-stale-discarded"]
    });
    expect(events).toHaveLength(1);
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
