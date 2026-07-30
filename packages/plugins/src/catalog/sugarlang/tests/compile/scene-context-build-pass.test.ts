/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-context-build-pass.test.ts
 *
 * Purpose: Pins the scene-context build pass -- cache-hit skip, stale-hash
 *   discard, fail-soft, and the support-language cache key.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises flushSceneContext on SugarlangAuthoringCompileScheduler with a
 *     MemorySceneContextCache and a stub extract function. No network.
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { SugarlangAuthoringCompileScheduler } from "../../runtime/compile/compile-scheduler";
import {
  MemorySceneContextCache,
  createSceneContextCacheStorageKey
} from "../../runtime/compile/scene-context-cache";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

function makeModel(overrides: Partial<SceneContextModel> = {}): SceneContextModel {
  return {
    sceneId: "scene-a",
    contentHash: "hash",
    promptVersion: "090.1.0",
    supportLanguage: "en",
    prose: "A dock.",
    concepts: [
      { label: "cheese", pos: "noun", provenance: [{ sourceId: "npc:a", kind: "npc" }] }
    ],
    extractedAtMs: 1,
    extractedByModel: "gateway-resolved",
    reviewFlag: false,
    ...overrides
  };
}

type ExtractFn = NonNullable<
  ConstructorParameters<
    typeof SugarlangAuthoringCompileScheduler
  >[0]["sceneContextPass"]
>["extractSceneContext"];

function makeScheduler(options: {
  extract: ExtractFn;
  cache?: MemorySceneContextCache;
  getScenes?: () => ReturnType<typeof createTestSceneAuthoringContext>[];
}) {
  const scenes = [createTestSceneAuthoringContext()];
  const cache = options.cache ?? new MemorySceneContextCache();
  const logs: Array<{ message: string; detail?: Record<string, unknown> }> = [];
  const scheduler = new SugarlangAuthoringCompileScheduler({
    getScenes: options.getScenes ?? (() => scenes),
    atlas: createTestAtlasProvider("es", [{ lemmaId: "hola", cefrPriorBand: "A1" }]),
    morphology: createTestMorphologyLoader("es", { hola: "hola" }),
    cache: new MemoryCompileCache(),
    debounceMs: 0,
    sceneContextPass: {
      cache,
      extractSceneContext: options.extract,
      promptVersion: "090.1.0",
      supportLanguage: "en"
    },
    onLog: (message, detail) => logs.push({ message, detail })
  });
  return { scheduler, cache, logs, scenes };
}

describe("flushSceneContext", () => {
  it("extracts and caches a model for each pending scene", async () => {
    const extract = vi.fn(async () => ({
      model: makeModel(),
      tokenCost: { input: 1, output: 1 },
      latencyMs: 1
    }));
    const { scheduler, cache, logs } = makeScheduler({ extract });

    scheduler.rebuildAll();
    await scheduler.flushSceneContext();

    expect(extract).toHaveBeenCalledTimes(1);
    expect(await cache.listEntries()).toHaveLength(1);
    expect(logs.some((entry) => entry.message === "scene-context-built")).toBe(true);
  });

  it("skips the gateway entirely on a cache hit", async () => {
    const extract = vi.fn(async () => ({
      model: makeModel(),
      tokenCost: { input: 1, output: 1 },
      latencyMs: 1
    }));
    const { scheduler, logs } = makeScheduler({ extract });

    scheduler.rebuildAll();
    await scheduler.flushSceneContext();
    scheduler.rebuildAll();
    await scheduler.flushSceneContext();

    // Second run is a hit: unchanged content must never be re-billed.
    expect(extract).toHaveBeenCalledTimes(1);
    expect(logs.filter((e) => e.message === "scene-context-cache-hit")).toHaveLength(1);
  });

  it("caches under the SUPPORT language, so one entry serves every target", async () => {
    const extract = vi.fn(async () => ({
      model: makeModel(),
      tokenCost: { input: 1, output: 1 },
      latencyMs: 1
    }));
    const { scheduler, cache } = makeScheduler({ extract });

    scheduler.rebuildAll();
    await scheduler.flushSceneContext();

    const [entry] = await cache.listEntries();
    expect(entry?.supportLanguage).toBe("en");
    // Concepts are English. Keying on the TARGET language would re-extract and
    // re-bill the same scene once per language shipped.
    expect(createSceneContextCacheStorageKey(entry!)).toContain("en:090.1.0:");
  });

  it("writes nothing when extraction fails", async () => {
    const extract = vi.fn(async () => ({
      model: makeModel({ concepts: [], reviewFlag: true }),
      tokenCost: { input: 1, output: 0 },
      latencyMs: 1,
      failure: { code: "extractor_request_failed", message: "502" }
    }));
    const { scheduler, cache, logs } = makeScheduler({ extract });

    scheduler.rebuildAll();
    await scheduler.flushSceneContext();

    // Fail-soft: a scene with no context is a worse build, not a broken one --
    // and a failed run must not poison the cache with an empty model.
    expect(await cache.listEntries()).toHaveLength(0);
    expect(
      logs.some((entry) => entry.message === "scene-context-extraction-failed")
    ).toBe(true);
  });

  it("discards a result whose scene changed while extraction was in flight", async () => {
    const scenes = [createTestSceneAuthoringContext()];
    const extract = vi.fn(async () => {
      // Author edits the scene mid-call: swap in different authored text.
      scenes[0] = createTestSceneAuthoringContext({
        npcDefinitions: [
          {
            definitionId: "npc-orrin",
            displayName: "Orrin",
            description: "Completely different bio now.",
            interactionMode: "agent",
            lorePageId: null,
            presentation: {} as never
          }
        ]
      });
      return {
        model: makeModel(),
        tokenCost: { input: 1, output: 1 },
        latencyMs: 1
      };
    });
    const { scheduler, cache, logs } = makeScheduler({
      extract,
      getScenes: () => scenes
    });

    scheduler.rebuildAll();
    await scheduler.flushSceneContext();

    // Writing it would describe text the author has already replaced.
    expect(await cache.listEntries()).toHaveLength(0);
    expect(
      logs.some((entry) => entry.message === "scene-context-stale-discarded")
    ).toBe(true);
  });

  it("does nothing when the pass is not configured", async () => {
    const scheduler = new SugarlangAuthoringCompileScheduler({
      getScenes: () => [createTestSceneAuthoringContext()],
      atlas: createTestAtlasProvider("es", [{ lemmaId: "hola", cefrPriorBand: "A1" }]),
      morphology: createTestMorphologyLoader("es", { hola: "hola" }),
      cache: new MemoryCompileCache(),
      debounceMs: 0
    });

    scheduler.rebuildAll();
    await expect(scheduler.flushSceneContext()).resolves.toBeUndefined();
  });
});
