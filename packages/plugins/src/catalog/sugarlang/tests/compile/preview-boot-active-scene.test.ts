/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/preview-boot-active-scene.test.ts
 *
 * Purpose: Regression pin for the queso/Finnick bug (2026-07-27). Composed
 *   npcPresences are OVERLAY-ONLY (composeRegionContents), so the preview
 *   boot compile MUST pass the session's active Scene into
 *   resolveSceneAuthoringContexts -- a base-only compose silently excludes
 *   every NPC (bio, lore page, bound dialogues) from the scene lexicon, and
 *   an NPC whose authored character is about cheese never yields "queso" as
 *   a teachable.
 *
 * Relationships:
 *   - Drives buildSugarlangPreviewBootPayloadForSession end to end with the
 *     REAL atlas + morphology (gloss reverse lookup included).
 *   - Depends on fake-indexeddb for the compile cache.
 *
 * Status: active
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultScene,
  createPluginConfigurationRecord,
  createRegionNPCPresence
} from "@sugarmagic/domain";
import type { NPCDefinition } from "@sugarmagic/domain";
import { buildSugarlangPreviewBootPayloadForSession } from "../../preview-boot";
import { createTestRegion } from "./test-helpers";

const CHEESE_NPC: NPCDefinition = {
  definitionId: "npc-finnick",
  displayName: "Finnick Thorn",
  description:
    "A traveling cheesemonger obsessed with cheese. He judges every town by its cheese.",
  interactionMode: "agent",
  lorePageId: null,
  presentation: {
    modelAssetDefinitionId: null,
    modelHeight: 1.7,
    animationAssetBindings: { idle: null, walk: null, run: null }
  }
};

describe("preview boot composes the active Scene overlay", () => {
  it("an overlay-placed NPC's bio vocabulary reaches the compiled lexicon", async () => {
    const region = createTestRegion();
    const gameProject = {
      ...createDefaultGameProject("Test Game", "project-preview-boot-test"),
      // The language lives in PROJECT CONFIG, where Studio's Language panel
      // writes it -- not in an environment variable. This test used to pass
      // SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE, which was the only way the old
      // env-only read could ever succeed and therefore hid the fact that a
      // language set in Studio did nothing.
      pluginConfigurations: [
        createPluginConfigurationRecord("sugarlang", true, {
          targetLanguage: "es"
        })
      ],
      npcDefinitions: [CHEESE_NPC],
      scenes: [
        createDefaultScene({
          sceneId: "scene:overlay-test",
          regionOverlays: {
            [region.identity.id]: {
              assetAppearanceOverrides: {},
              folders: [],
              placedAssets: [],
              playerPresence: null,
              npcPresences: [
                createRegionNPCPresence({ npcDefinitionId: "npc-finnick" })
              ],
              itemPresences: []
            }
          }
        })
      ]
    };
    const session = createAuthoringSession(gameProject, [region]);

    const payload = await buildSugarlangPreviewBootPayloadForSession(
      session,
      "ws-preview-boot-test",
      {}
    );

    expect(payload).not.toBeNull();
    const lexicon = payload!.compiledScenes.find(
      (scene) => scene.sceneId === region.identity.id
    );
    expect(lexicon).toBeDefined();

    // "cheese" in the NPC bio resolves to "queso" via the atlas gloss reverse
    // lookup. Before the fix this was absent: no activeScene -> no npcPresences
    // -> no NPC blobs, so the overlay-placed NPC's bio was never traversed.
    //
    // 090.2d NARROWED THIS PIN, and it is worth stating rather than hiding.
    // It used to also assert `npcSourceIds` contained "npc-finnick" -- WHICH
    // npc contributed the word. That field existed only so the budgeter could
    // boost words from the NPC being spoken to, and it died with the budgeter;
    // nothing reads per-lemma NPC attribution now. Presence of `queso` still
    // guards the traversal regression, because the bio is its only source in
    // this fixture. Per-source attribution lives on scene-context concept
    // provenance (`npc:<id>`), which is a different artifact and pinned
    // separately.
    expect(lexicon!.lemmaIds).toContain("queso");
  });
});
