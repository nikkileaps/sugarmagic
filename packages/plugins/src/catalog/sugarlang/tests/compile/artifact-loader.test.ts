/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/artifact-loader.test.ts
 *
 * Purpose: A deployed game reads the scene contexts it shipped with
 *   (Plan 092.3).
 *
 * WHY THIS MATTERS
 *   Extraction is a gateway call, so a player's machine can never do it. The
 *   only way a deployed game knows what a scene is ABOUT is to read the file
 *   the bake shipped. Before this the deployed Teacher had nothing, and
 *   Studio's own warning described production: "NPCs will still talk, but they
 *   will not teach what your scenes are about."
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { loadSceneContextsFromArtifact } from "../../runtime/compile/artifact-loader";
import { SUGARLANG_SCENE_CONTEXT_ASSET_PATH } from "../../runtime/compile/artifact-paths";

const STAMPED_URL = "/assets/sugarlang/scene-contexts.json?v=abc123";

const sources = { [SUGARLANG_SCENE_CONTEXT_ASSET_PATH]: STAMPED_URL };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response;
}

const model = (sceneId: string) => ({
  sceneId,
  contentHash: "h",
  promptVersion: "v",
  supportLanguage: "en",
  prose: `about ${sceneId}`,
  concepts: [{ label: "cheese", provenance: "npc:finnick" }],
  extractedAtMs: 1,
  extractedByModel: "test",
  reviewFlag: false
});

describe("092.3 — the deployed game reads its shipped scene contexts", () => {
  it("THE ONE THAT MATTERS: fetches and returns the shipped models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ sceneContextModels: [model("region-1"), model("region-2")] })
    );

    const models = await loadSceneContextsFromArtifact(sources, fetchImpl);

    expect(models).toHaveLength(2);
    expect(models[0]!.prose).toBe("about region-1");
  });

  it("uses the VERSION-STAMPED url, never a hand-built path", async () => {
    // `/assets/*` is served immutable for a year. A hard-coded
    // `/assets/sugarlang/scene-contexts.json` would be cached across deploys
    // and never pick up a rebake; the stamp in assetSources is what busts it.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ sceneContextModels: [] })
    );

    await loadSceneContextsFromArtifact(sources, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(STAMPED_URL);
  });

  it("a game that shipped no artifact is a quiet empty, not a crash", async () => {
    const fetchImpl = vi.fn();
    expect(await loadSceneContextsFromArtifact({}, fetchImpl)).toEqual([]);
    expect(await loadSceneContextsFromArtifact(undefined, fetchImpl)).toEqual([]);
    // No URL means nothing to fetch -- it must not guess one.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a 404 or a network failure degrades, it does not stop the game booting", async () => {
    expect(
      await loadSceneContextsFromArtifact(
        sources,
        vi.fn().mockResolvedValue(jsonResponse(null, false, 404))
      )
    ).toEqual([]);

    expect(
      await loadSceneContextsFromArtifact(
        sources,
        vi.fn().mockRejectedValue(new Error("offline"))
      )
    ).toEqual([]);
  });

  it("junk in the file cannot take the game down", async () => {
    for (const body of [
      {},
      { sceneContextModels: "not an array" },
      null,
      { sceneContextModels: [{ nope: true }] }
    ]) {
      await expect(
        loadSceneContextsFromArtifact(
          sources,
          vi.fn().mockResolvedValue(jsonResponse(body))
        )
      ).resolves.toEqual([]);
    }
  });

  it("drops a malformed model but keeps its well-formed neighbours", async () => {
    const models = await loadSceneContextsFromArtifact(
      sources,
      vi.fn().mockResolvedValue(
        jsonResponse({
          sceneContextModels: [
            model("region-1"),
            { sceneId: "", concepts: [] },
            { sceneId: "region-3" }
          ]
        })
      )
    );
    expect(models.map((m) => m.sceneId)).toEqual(["region-1"]);
  });
});
