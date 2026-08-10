/**
 * packages/plugins/src/catalog/sugarlang/tests/ui/artifact-round-trip.test.ts
 *
 * Purpose: The bake's derived artifacts survive a cleared browser (Plan 092.2).
 *
 * WHY THIS IS THE TEST THAT MATTERS
 *   Scene contexts cost a gateway call and therefore money. Before this, the
 *   only copy lived in browser storage: clearing it meant paying again for
 *   scenes that had not changed, and a deployed game got nothing at all. The
 *   artifact file in `assets/` is the durable copy, so the round trip below --
 *   write, wipe, restore -- is the property, not an implementation detail.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SUGARLANG_SCENE_CONTEXT_ASSET_PATH,
  SUGARLANG_VARIANT_ASSET_PATH,
  collectSceneContextArtifact,
  collectVariantArtifact,
  restoreSceneContextsFromArtifact,
  restoreVariantsFromArtifact
} from "../../ui/shell/editor-support";
import { IndexedDBSceneContextCache } from "../../runtime/compile/scene-context-cache";
import { IndexedDBVariantCache } from "../../runtime/compile/variant-cache";
import type { SceneContextModel } from "../../runtime/contracts/scene-context";
import { SCENE_CONTEXT_PROMPT_VERSION } from "../../runtime/compile/scene-context-extractor";
import { VARIANT_PROMPT_VERSION } from "../../runtime/compile/generate-variant";

const WORKSPACE = "sugarlang-studio:project-1";

function model(overrides: Partial<SceneContextModel> = {}): SceneContextModel {
  return {
    sceneId: "region-1",
    contentHash: "hash-abc",
    promptVersion: SCENE_CONTEXT_PROMPT_VERSION,
    supportLanguage: "en",
    prose: "A station platform. The manager is waiting.",
    concepts: [],
    extractedAtMs: 1,
    extractedByModel: "test",
    reviewFlag: false,
    ...overrides
  };
}

/** The artifact file exactly as the bake writes it. */
function artifactBlob(models: SceneContextModel[]): Blob {
  return new Blob([
    JSON.stringify({
      schemaVersion: 1,
      promptVersion: "v1",
      sceneContextModels: models
    })
  ]);
}

const reader = (blob: Blob | null) => async (path: string) => {
  expect(path).toBe(SUGARLANG_SCENE_CONTEXT_ASSET_PATH);
  return blob;
};

describe("092.2 — a bake survives clearing the browser", () => {
  beforeEach(async () => {
    await new IndexedDBSceneContextCache({ workspaceId: WORKSPACE }).invalidate();
  });

  it("THE ONE THAT MATTERS: restores from the file into an empty cache", async () => {
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });
    const key = {
      contentHash: "hash-abc",
      supportLanguage: "en",
      promptVersion: SCENE_CONTEXT_PROMPT_VERSION
    };
    // The browser was cleared: nothing is cached.
    expect(await cache.has(key)).toBe(false);

    const restored = await restoreSceneContextsFromArtifact(
      WORKSPACE,
      reader(artifactBlob([model()]))
    );

    expect(restored).toBe(1);
    expect(await cache.has(key)).toBe(true);
    expect((await cache.get(key))?.model.prose).toContain("station platform");
  });

  it("a model restores under its OWN hash, so an edited scene stays a miss", async () => {
    // Restoring must not let a stale model answer for current content. The key
    // is rebuilt from the model, so a scene edited since the bake simply does
    // not hit -- rather than hitting with an answer about what it used to be.
    await restoreSceneContextsFromArtifact(
      WORKSPACE,
      reader(artifactBlob([model({ contentHash: "hash-OLD" })]))
    );
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });

    expect(
      await cache.has({
        contentHash: "hash-OLD",
        supportLanguage: "en",
        promptVersion: SCENE_CONTEXT_PROMPT_VERSION
      })
    ).toBe(true);
    expect(
      await cache.has({
        contentHash: "hash-CURRENT",
        supportLanguage: "en",
        promptVersion: SCENE_CONTEXT_PROMPT_VERSION
      })
    ).toBe(false);
  });

  it("THE BUG A REAL RUN FOUND: a warm cache still produces the artifact", async () => {
    // The first version collected models as the EXTRACTOR produced them. But
    // compile-scheduler skips extraction on a cache hit (`if (cached)
    // { continue; }`), so a project baked even once handed out nothing and no
    // file was ever written. It only worked on a first-ever bake -- which is
    // exactly the case unit tests hit and real projects never are.
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });
    await cache.set({
      key: {
        contentHash: "hash-abc",
        supportLanguage: "en",
        promptVersion: "v1"
      },
      sceneId: "region-1",
      model: model()
    });

    const artifact = await collectSceneContextArtifact(WORKSPACE);

    expect(artifact?.relativeAssetPath).toBe(SUGARLANG_SCENE_CONTEXT_ASSET_PATH);
    expect(
      (artifact?.json as { sceneContextModels: unknown[] }).sceneContextModels
    ).toHaveLength(1);
  });

  it("THE ONE THE REAL FILE EXPOSED: superseded editions are not shipped", async () => {
    // The cache keeps every extraction ever made -- one per edit of a scene,
    // plus one per prompt version -- and none of the old ones can be hit
    // again. Measured on the wordlark project: 7 models, 2 current, 5 dead.
    // Harmless in a cache; not harmless in a file that ships to every player
    // and grows for the life of the project.
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });
    const put = (contentHash: string, promptVersion: string) =>
      cache.set({
        key: { contentHash, supportLanguage: "en", promptVersion },
        sceneId: "region-1",
        model: model({ contentHash, promptVersion })
      });

    await put("hash-CURRENT", SCENE_CONTEXT_PROMPT_VERSION);
    await put("hash-OLD-EDIT", SCENE_CONTEXT_PROMPT_VERSION);
    await put("hash-CURRENT", "an-older-prompt");

    const artifact = await collectSceneContextArtifact(
      WORKSPACE,
      new Map([["region-1", "hash-CURRENT"]])
    );

    const shipped = (artifact?.json as { sceneContextModels: SceneContextModel[] })
      .sceneContextModels;
    expect(shipped).toHaveLength(1);
    expect(shipped[0]!.contentHash).toBe("hash-CURRENT");
    expect(shipped[0]!.promptVersion).toBe(SCENE_CONTEXT_PROMPT_VERSION);
  });

  it("with no current hashes it keeps everything rather than shipping nothing", async () => {
    // Studio tolerates a project with no target language, where hashes cannot
    // be computed. A bigger file beats a file missing the model in use.
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });
    await cache.set({
      key: { contentHash: "h1", supportLanguage: "en", promptVersion: "old" },
      sceneId: "region-1",
      model: model({ contentHash: "h1", promptVersion: "old" })
    });

    const artifact = await collectSceneContextArtifact(WORKSPACE);
    expect(
      (artifact?.json as { sceneContextModels: unknown[] }).sceneContextModels
    ).toHaveLength(1);
  });

  it("a scene absent from the current-hash map is kept, not dropped", async () => {
    // An unknown scene is not a stale scene. Dropping it would silently ship
    // less than was baked.
    const cache = new IndexedDBSceneContextCache({ workspaceId: WORKSPACE });
    await cache.set({
      key: {
        contentHash: "h9",
        supportLanguage: "en",
        promptVersion: SCENE_CONTEXT_PROMPT_VERSION
      },
      sceneId: "region-UNKNOWN",
      model: model({ sceneId: "region-UNKNOWN", contentHash: "h9" })
    });

    const artifact = await collectSceneContextArtifact(
      WORKSPACE,
      new Map([["region-1", "hash-CURRENT"]])
    );
    expect(
      (artifact?.json as { sceneContextModels: unknown[] }).sceneContextModels
    ).toHaveLength(1);
  });

  it("an empty scene-context cache produces no artifact rather than an empty one", async () => {
    expect(await collectSceneContextArtifact(WORKSPACE)).toBeNull();
  });

  it("a project that was never baked is a quiet zero, not a crash", async () => {
    expect(await restoreSceneContextsFromArtifact(WORKSPACE, reader(null))).toBe(0);
  });

  it("an unreadable or junk artifact cannot stop Studio opening", async () => {
    for (const blob of [
      new Blob(["not json at all"]),
      new Blob([JSON.stringify({ sceneContextModels: "not an array" })]),
      new Blob([JSON.stringify({})])
    ]) {
      await expect(
        restoreSceneContextsFromArtifact(WORKSPACE, reader(blob))
      ).resolves.toBe(0);
    }
  });

  it("skips a model with no scene or no hash rather than caching a broken key", async () => {
    const restored = await restoreSceneContextsFromArtifact(
      WORKSPACE,
      reader(
        artifactBlob([
          model(),
          { ...model(), sceneId: "" },
          { ...model(), contentHash: "" }
        ] as SceneContextModel[])
      )
    );
    expect(restored).toBe(1);
  });
});

describe("092.2 — variants survive clearing the browser", () => {
  const KEY = {
    lang: "es",
    band: "A1" as const,
    contentHash: "node-1|hola",
    variantPromptVersion: VARIANT_PROMPT_VERSION
  };

  function variantArtifactBlob(entries: unknown[]): Blob {
    return new Blob([
      JSON.stringify({ schemaVersion: 1, promptVersion: "v1", variants: entries })
    ]);
  }

  const variantReader = (blob: Blob | null) => async (path: string) => {
    expect(path).toBe(SUGARLANG_VARIANT_ASSET_PATH);
    return blob;
  };

  beforeEach(async () => {
    await new IndexedDBVariantCache({ workspaceId: WORKSPACE }).invalidate();
  });

  it("THE ONE THAT MATTERS: a HAND-EDITED variant survives", async () => {
    // A generated variant is a derived artifact -- losing it costs a rebake.
    // A hand-written one is AUTHORED and cannot be regenerated at all, so
    // losing it is losing work (ADR 005 rule 6). Same store, same trip.
    const restored = await restoreVariantsFromArtifact(
      WORKSPACE,
      variantReader(
        variantArtifactBlob([
          {
            key: KEY,
            variant: { text: "hola, corregido a mano", generatedByModel: "manual" }
          }
        ])
      )
    );

    expect(restored).toBe(1);
    const entry = await new IndexedDBVariantCache({
      workspaceId: WORKSPACE
    }).get(KEY);
    expect(entry?.variant.text).toBe("hola, corregido a mano");
    expect(
      (entry?.variant as { generatedByModel?: string }).generatedByModel
    ).toBe("manual");
  });

  it("sweeps whatever is in the cache, so the file is never a partial view", async () => {
    const cache = new IndexedDBVariantCache({ workspaceId: WORKSPACE });
    await cache.set({
      key: KEY,
      variant: { text: "uno" } as never
    });
    await cache.set({
      key: { ...KEY, band: "A2" as const },
      variant: { text: "dos" } as never
    });

    const artifact = await collectVariantArtifact(WORKSPACE);
    expect(artifact?.relativeAssetPath).toBe(SUGARLANG_VARIANT_ASSET_PATH);
    expect((artifact?.json as { variants: unknown[] }).variants).toHaveLength(2);
  });

  it("THE ONE THAT PROTECTS YOUR WRITING: stale DRAFTS pruned, stale HAND EDITS kept", async () => {
    // The variant key includes the prompt version, so bumping it orphans
    // everything older. docs/backlog/007: "correct for machine drafts,
    // indefensible for authored text." A regenerated draft costs a gateway
    // call; a hand correction costs work nobody can repeat.
    //
    // Measured on wordlark when this was written: 126 entries, 24 current
    // drafts, and 4 hand edits -- every one of the hand edits already orphaned.
    const cache = new IndexedDBVariantCache({ workspaceId: WORKSPACE });
    const put = (
      band: "A1" | "A2" | "B1",
      promptVersion: string,
      generatedByModel: string
    ) =>
      cache.set({
        key: { ...KEY, band, variantPromptVersion: promptVersion },
        variant: { text: `${band}-${generatedByModel}`, generatedByModel } as never
      });

    await put("A1", VARIANT_PROMPT_VERSION, "claude");
    await put("A2", "an-older-prompt", "claude");
    await put("B1", "an-older-prompt", "manual");

    const shipped = (
      (await collectVariantArtifact(WORKSPACE))?.json as {
        variants: Array<{ variant: { generatedByModel: string } }>;
      }
    ).variants;

    const kinds = shipped.map((e) => e.variant.generatedByModel).sort();
    expect(kinds).toEqual(["claude", "manual"]);
    // The stale DRAFT is gone; the stale HAND EDIT survived.
    expect(shipped.some((e) => e.variant.generatedByModel === "manual")).toBe(true);
    expect(shipped).toHaveLength(2);
  });

  it("an empty cache produces no artifact rather than an empty one", async () => {
    expect(await collectVariantArtifact(WORKSPACE)).toBeNull();
  });

  it("skips an entry with no key or no variant", async () => {
    const restored = await restoreVariantsFromArtifact(
      WORKSPACE,
      variantReader(
        variantArtifactBlob([
          { key: KEY, variant: { text: "kept" } },
          { key: KEY },
          { variant: { text: "no key" } },
          { key: { ...KEY, contentHash: "" }, variant: { text: "blank hash" } }
        ])
      )
    );
    expect(restored).toBe(1);
  });
});
