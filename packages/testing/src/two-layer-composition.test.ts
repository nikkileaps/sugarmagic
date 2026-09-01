/**
 * Two-layer composition (epic #226 story 3).
 *
 * The region is the world at rest and a Scene overlay is a diff against
 * it. These pin the rules a Scene author depends on: residents are there
 * with no Scene at all, a Scene adds to them rather than replacing them,
 * a Scene can hide one by id, and two layers each offering a player start
 * still produce exactly one spawn.
 */

import { describe, expect, it } from "vitest";
import {
  composeRegionContents,
  createDefaultRegion,
  createDefaultScene,
  createRegionItemPresence,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  createRegionSceneOverlay,
  type RegionDocument,
  type Scene
} from "@sugarmagic/domain";

const REGION_ID = "region:village";

function regionWithResidents(): RegionDocument {
  const region = createDefaultRegion({
    regionId: REGION_ID,
    displayName: "Village"
  });
  region.npcPresences = [
    createRegionNPCPresence({
      presenceId: "presence:finnick",
      npcDefinitionId: "npc:finnick"
    }),
    createRegionNPCPresence({
      presenceId: "presence:barkeep",
      npcDefinitionId: "npc:barkeep"
    })
  ];
  region.itemPresences = [
    createRegionItemPresence({
      presenceId: "presence:cheese",
      itemDefinitionId: "item:cheese"
    })
  ];
  region.playerPresence = createRegionPlayerPresence({
    presenceId: "presence:player-region"
  });
  return region;
}

function sceneWithOverlay(
  overlay: Partial<Parameters<typeof createRegionSceneOverlay>[0]> = {}
): Scene {
  return createDefaultScene({
    sceneId: "scene:market-day",
    regionId: REGION_ID,
    overlay: createRegionSceneOverlay(overlay)
  });
}

describe("two-layer composition", () => {
  it("a region with no Scene is a populated place", () => {
    const composed = composeRegionContents(regionWithResidents(), null);

    expect(composed.npcPresences.map((p) => p.presenceId)).toEqual([
      "presence:finnick",
      "presence:barkeep"
    ]);
    expect(composed.itemPresences).toHaveLength(1);
    expect(composed.playerPresence?.presenceId).toBe("presence:player-region");
  });

  it("a Scene ADDS to the residents rather than replacing them", () => {
    const scene = sceneWithOverlay({
      npcPresences: [
        createRegionNPCPresence({
          presenceId: "presence:visiting-merchant",
          npcDefinitionId: "npc:merchant"
        })
      ]
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    // The failure this guards: an overlay that replaces would leave the
    // merchant alone in an empty village.
    expect(composed.npcPresences.map((p) => p.presenceId)).toEqual([
      "presence:finnick",
      "presence:barkeep",
      "presence:visiting-merchant"
    ]);
  });

  it("a Scene can suppress a specific resident by id", () => {
    const scene = sceneWithOverlay({
      suppressedRegionIds: ["presence:barkeep"]
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    expect(composed.npcPresences.map((p) => p.presenceId)).toEqual([
      "presence:finnick"
    ]);
    // Suppression hides; it never edits the region.
    expect(regionWithResidents().npcPresences).toHaveLength(2);
  });

  it("suppression reaches items and the player start too", () => {
    const scene = sceneWithOverlay({
      suppressedRegionIds: ["presence:cheese", "presence:player-region"]
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    expect(composed.itemPresences).toEqual([]);
    expect(composed.playerPresence).toBeNull();
  });

  it("suppressing an id that matches nothing changes nothing", () => {
    const scene = sceneWithOverlay({
      suppressedRegionIds: ["presence:deleted-long-ago"]
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    expect(composed.npcPresences).toHaveLength(2);
  });

  it("exactly one player spawn when both layers offer one", () => {
    const scene = sceneWithOverlay({
      playerPresence: createRegionPlayerPresence({
        presenceId: "presence:player-scene"
      })
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    // Not an array: the composed shape holds one, and the Scene's wins.
    expect(composed.playerPresence?.presenceId).toBe("presence:player-scene");
  });

  it("a Scene that names a different region leaves this one at rest", () => {
    const scene = createDefaultScene({
      sceneId: "scene:elsewhere",
      regionId: "region:harbour",
      overlay: createRegionSceneOverlay({
          npcPresences: [
            createRegionNPCPresence({
              presenceId: "presence:harbour-master",
              npcDefinitionId: "npc:harbour-master"
            })
          ]
        })
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    expect(composed.npcPresences.map((p) => p.presenceId)).toEqual([
      "presence:finnick",
      "presence:barkeep"
    ]);
  });

  it("suppression cannot reach the Scene's own placements", () => {
    const scene = sceneWithOverlay({
      npcPresences: [
        createRegionNPCPresence({
          presenceId: "presence:visiting-merchant",
          npcDefinitionId: "npc:merchant"
        })
      ],
      suppressedRegionIds: ["presence:visiting-merchant"]
    });

    const composed = composeRegionContents(regionWithResidents(), scene);

    // A Scene that does not want its own placement simply does not add it.
    expect(
      composed.npcPresences.some(
        (p) => p.presenceId === "presence:visiting-merchant"
      )
    ).toBe(true);
  });
});
