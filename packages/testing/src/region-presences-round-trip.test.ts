/**
 * Region-owned presences (epic #226 story 2).
 *
 * The region document is the world at rest: its residents (NPC presences,
 * item presences, player start) are direct fields beside placedAssets,
 * folders, and behaviors. This pins the two load-boundary properties the
 * story ships: a file predating the fields loads with empty ones, and a
 * populated region survives the load normalizer intact. Composition does
 * not read these fields yet; that behavior arrives with the two-layer
 * composition story.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegion,
  createEmptyContentLibrarySnapshot,
  createRegionItemPresence,
  createRegionNPCPresence,
  createRegionPlayerPresence,
  normalizeRegionDocumentForLoad,
  type RegionDocument
} from "@sugarmagic/domain";

const LIBRARY = createEmptyContentLibrarySnapshot("project:test");

describe("region-owned presences", () => {
  it("a region file predating the fields loads with empty presences", () => {
    const region = createDefaultRegion({
      regionId: "region:pre-226",
      displayName: "Pre-226 Region"
    });
    // Simulate the on-disk shape of an old file: no presence fields, and
    // the reader-less pre-#226 field still present.
    const legacy = { ...region } as Record<string, unknown>;
    delete legacy.npcPresences;
    delete legacy.itemPresences;
    delete legacy.playerPresence;
    legacy.gameplayPlacements = [];

    const loaded = normalizeRegionDocumentForLoad(
      legacy as unknown as RegionDocument,
      LIBRARY
    );

    expect(loaded.npcPresences).toEqual([]);
    expect(loaded.itemPresences).toEqual([]);
    expect(loaded.playerPresence).toBeNull();
    // The legacy field is stripped at load, so a save stops carrying it.
    expect("gameplayPlacements" in loaded).toBe(false);
  });

  it("a populated region round-trips through the load normalizer", () => {
    const region = createDefaultRegion({
      regionId: "region:harbour",
      displayName: "Harbour"
    });
    region.npcPresences = [
      createRegionNPCPresence({
        presenceId: "presence:npc:harbour-master",
        npcDefinitionId: "npc:harbour-master",
        transform: { position: [4, 0, 2], rotation: [0, 1.5, 0], scale: [1, 1, 1] }
      })
    ];
    region.itemPresences = [
      createRegionItemPresence({
        presenceId: "presence:item:crate",
        itemDefinitionId: "item:crate",
        quantity: 3
      })
    ];
    region.playerPresence = createRegionPlayerPresence({
      presenceId: "presence:player:harbour",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    });

    const loaded = normalizeRegionDocumentForLoad(
      JSON.parse(JSON.stringify(region)) as RegionDocument,
      LIBRARY
    );

    expect(loaded.npcPresences).toEqual(region.npcPresences);
    expect(loaded.itemPresences).toEqual(region.itemPresences);
    expect(loaded.playerPresence).toEqual(region.playerPresence);
  });
});
