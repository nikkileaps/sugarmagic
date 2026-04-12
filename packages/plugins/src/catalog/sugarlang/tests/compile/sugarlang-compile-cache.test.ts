/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/sugarlang-compile-cache.test.ts
 *
 * Purpose: Verifies the memory and IndexedDB compile cache implementations.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/cache-memory, ../../runtime/compile/cache-indexeddb, and the shared cache interface.
 *   - Depends on ./test-helpers and fake-indexeddb for deterministic cache fixtures.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { MemoryCompileCache } from "../../runtime/compile/cache-memory";
import { IndexedDBCompileCache } from "../../runtime/compile/cache-indexeddb";
import { compileSugarlangScene } from "../../runtime/compile/compile-sugarlang-scene";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

function createLexicon(sceneId = "scene-station") {
  const context = createTestSceneAuthoringContext({
    region: {
      ...createTestSceneAuthoringContext().region,
      identity: {
        ...createTestSceneAuthoringContext().region.identity,
        id: sceneId
      }
    }
  });
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

  return compileSugarlangScene(context, atlas, morphology, "runtime-preview");
}

describe("MemoryCompileCache", () => {
  it("round-trips a compiled artifact", async () => {
    const cache = new MemoryCompileCache();
    const lexicon = createLexicon();

    await cache.set(lexicon);

    await expect(
      cache.get(lexicon.sceneId, lexicon.contentHash, lexicon.profile)
    ).resolves.toEqual(lexicon);
  });

  it("returns null for an unset key", async () => {
    const cache = new MemoryCompileCache();

    await expect(
      cache.get("missing", "hash", "runtime-preview")
    ).resolves.toBeNull();
  });

  it("evicts least-recently-used entries when over capacity", async () => {
    const cache = new MemoryCompileCache({ maxEntries: 1 });
    const first = createLexicon("scene-a");
    const second = createLexicon("scene-b");

    await cache.set(first);
    await cache.set(second);

    await expect(
      cache.get(first.sceneId, first.contentHash, first.profile)
    ).resolves.toBeNull();
    await expect(
      cache.get(second.sceneId, second.contentHash, second.profile)
    ).resolves.toEqual(second);
  });

  it("invalidates a single scene or the full cache", async () => {
    const cache = new MemoryCompileCache();
    const first = createLexicon("scene-a");
    const second = createLexicon("scene-b");

    await cache.set(first);
    await cache.set(second);
    await cache.invalidate("scene-a");

    expect(await cache.get(first.sceneId, first.contentHash, first.profile)).toBeNull();
    expect(await cache.get(second.sceneId, second.contentHash, second.profile)).toEqual(second);

    await cache.invalidate();
    expect(await cache.get(second.sceneId, second.contentHash, second.profile)).toBeNull();
  });

  it("handles parallel sets deterministically", async () => {
    const cache = new MemoryCompileCache();
    const first = createLexicon("scene-a");
    const second = createLexicon("scene-b");

    await Promise.all([cache.set(first), cache.set(second)]);

    expect(await cache.has(first.sceneId, first.contentHash, first.profile)).toBe(true);
    expect(await cache.has(second.sceneId, second.contentHash, second.profile)).toBe(true);
  });
});

describe("IndexedDBCompileCache", () => {
  it("persists entries across cache instances in the same workspace", async () => {
    const lexicon = createLexicon();
    const first = new IndexedDBCompileCache({ workspaceId: "workspace-a" });
    await first.set(lexicon);

    const second = new IndexedDBCompileCache({ workspaceId: "workspace-a" });
    await expect(
      second.get(lexicon.sceneId, lexicon.contentHash, lexicon.profile)
    ).resolves.toEqual(lexicon);
  });

  it("isolates entries by workspace", async () => {
    const lexicon = createLexicon();
    const first = new IndexedDBCompileCache({ workspaceId: "workspace-one" });
    const second = new IndexedDBCompileCache({ workspaceId: "workspace-two" });

    await first.set(lexicon);

    await expect(
      second.get(lexicon.sceneId, lexicon.contentHash, lexicon.profile)
    ).resolves.toBeNull();
  });

  it("falls back to memory cache when IndexedDB is unavailable", async () => {
    const warn = vi.fn();
    const cache = new IndexedDBCompileCache({
      workspaceId: "workspace-fallback",
      indexedDbFactory: null,
      logger: { warn }
    });
    const lexicon = createLexicon();

    await cache.set(lexicon);

    expect(await cache.get(lexicon.sceneId, lexicon.contentHash, lexicon.profile)).toEqual(lexicon);
    expect(warn).toHaveBeenCalled();
  });
});
