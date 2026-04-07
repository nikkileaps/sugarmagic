import { describe, expect, it } from "vitest";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  buildEntityCurrentAreaFact,
  buildEntityPlayerSpatialRelationFact,
  buildLocationReference,
  classifySpatialProximity,
  createSpatialAreaTracker,
  resolveRegionAreaAtPosition
} from "@sugarmagic/runtime-core";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "wordlark-hollow", schema: "RegionDocument", version: 1 },
    displayName: "Wordlark Hollow Station",
    lorePageId: "root.locations.wordlark_hollow_station",
    placement: {
      gridPosition: { x: 0, y: 0 },
      placementPolicy: "world-grid"
    },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: {
      defaultEnvironmentId: null
    },
    areas: [
      {
        areaId: "station-exterior",
        displayName: "Station Exterior",
        lorePageId: "root.locations.wordlark_hollow_station.exterior",
        parentAreaId: null,
        kind: "exterior",
        bounds: {
          kind: "box",
          center: [0, 6, 0],
          size: [30, 12, 30]
        }
      },
      {
        areaId: "cheese-kiosk",
        displayName: "Cheese Kiosk",
        lorePageId: "root.locations.wordlark_hollow_station.cheese_kiosk",
        parentAreaId: "station-exterior",
        kind: "shop",
        bounds: {
          kind: "box",
          center: [2, 6, 2],
          size: [8, 12, 8]
        }
      },
      {
        areaId: "platform-east",
        displayName: "Platform East",
        lorePageId: "root.locations.wordlark_hollow_station.platform_east",
        parentAreaId: "station-exterior",
        kind: "platform",
        bounds: {
          kind: "box",
          center: [12, 6, 0],
          size: [6, 12, 12]
        }
      },
      {
        areaId: "waiting-room",
        displayName: "Waiting Room",
        lorePageId: "root.locations.wordlark_hollow_station.waiting_room",
        parentAreaId: "station-interior",
        kind: "room",
        bounds: {
          kind: "box",
          center: [-10, 6, 0],
          size: [8, 12, 8]
        }
      },
      {
        areaId: "ticket-office",
        displayName: "Ticket Office",
        lorePageId: "root.locations.wordlark_hollow_station.ticket_office",
        parentAreaId: "station-interior",
        kind: "room",
        bounds: {
          kind: "box",
          center: [-2, 6, 0],
          size: [8, 12, 8]
        }
      },
      {
        areaId: "station-interior",
        displayName: "Station Interior",
        lorePageId: "root.locations.wordlark_hollow_station.interior",
        parentAreaId: null,
        kind: "interior",
        bounds: {
          kind: "box",
          center: [-6, 6, 0],
          size: [24, 12, 16]
        }
      }
    ],
    behaviors: [],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 8,
      channels: [],
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

describe("runtime spatial resolution", () => {
  it("resolves the smallest containing area at a position", () => {
    const region = makeRegion();

    const resolved = resolveRegionAreaAtPosition(region, { x: 2, y: 3, z: 2 });

    expect(resolved?.areaId).toBe("cheese-kiosk");
    expect(resolved?.displayName).toBe("Cheese Kiosk");
  });

  it("returns null when a position is outside all authored areas", () => {
    const region = makeRegion();

    const resolved = resolveRegionAreaAtPosition(region, { x: 100, y: 3, z: 100 });

    expect(resolved).toBeNull();
  });

  it("builds current-area and location references with parent context", () => {
    const region = makeRegion();
    const kiosk = region.areas[1] ?? null;

    const currentArea = buildEntityCurrentAreaFact(region, "npc:rick-roll", kiosk);
    const location = buildLocationReference(region, kiosk);

    expect(currentArea).toMatchObject({
      entityId: "npc:rick-roll",
      area: {
        areaId: "cheese-kiosk",
        displayName: "Cheese Kiosk"
      },
      parentArea: {
        areaId: "station-exterior",
        displayName: "Station Exterior"
      }
    });
    expect(location).toMatchObject({
      regionId: "wordlark-hollow",
      regionDisplayName: "Wordlark Hollow Station",
      area: {
        areaId: "cheese-kiosk",
        displayName: "Cheese Kiosk"
      },
      parentArea: {
        areaId: "station-exterior",
        displayName: "Station Exterior"
      }
    });
  });

  it("classifies same-area proximity as immediate and shared-container proximity as local", () => {
    const region = makeRegion();
    const exterior = region.areas[0] ?? null;
    const kiosk = region.areas[1] ?? null;
    const platform = region.areas[2] ?? null;
    const waitingRoom = region.areas[3] ?? null;
    const ticketOffice = region.areas[4] ?? null;
    const interior = region.areas[5] ?? null;

    expect(classifySpatialProximity(region, kiosk, kiosk)).toBe("immediate");
    expect(classifySpatialProximity(region, kiosk, exterior)).toBe("local");
    expect(classifySpatialProximity(region, kiosk, platform)).toBe("local");
    expect(classifySpatialProximity(region, waitingRoom, ticketOffice)).toBe("local");
    expect(classifySpatialProximity(region, kiosk, waitingRoom)).toBe("remote");
    expect(classifySpatialProximity(region, interior, exterior)).toBe("remote");
    expect(classifySpatialProximity(region, exterior, null)).toBe("remote");
  });

  it("builds player relation facts with proximity metadata", () => {
    const region = makeRegion();
    const exterior = region.areas[0] ?? null;
    const kiosk = region.areas[1] ?? null;

    const relation = buildEntityPlayerSpatialRelationFact({
      region,
      entityId: "npc:rick-roll",
      playerEntityId: "player:mim",
      entityArea: kiosk,
      playerArea: exterior,
      entityPosition: { x: 2, y: 3, z: 2 },
      playerPosition: { x: 6, y: 3, z: 6 }
    });

    expect(relation).toMatchObject({
      entityId: "npc:rick-roll",
      playerEntityId: "player:mim",
      entityAreaId: "cheese-kiosk",
      playerAreaId: "station-exterior",
      sameArea: false,
      proximityBand: "local"
    });
    expect(relation.distanceMeters).toBeGreaterThan(0);
  });

  it("stabilizes area resolution across brief boundary jitter", () => {
    const region = makeRegion();
    const tracker = createSpatialAreaTracker(region, { confirmationFrames: 3 });

    const first = tracker.resolve("player:mim", { x: 2, y: 3, z: 2 });
    const second = tracker.resolve("player:mim", { x: 100, y: 3, z: 100 });
    const third = tracker.resolve("player:mim", { x: 100, y: 3, z: 100 });
    const fourth = tracker.resolve("player:mim", { x: 100, y: 3, z: 100 });

    expect(first.area?.areaId).toBe("cheese-kiosk");
    expect(second.rawArea).toBeNull();
    expect(second.area?.areaId).toBe("cheese-kiosk");
    expect(third.area?.areaId).toBe("cheese-kiosk");
    expect(fourth.area).toBeNull();
    expect(fourth.changed).toBe(true);
  });

  it("commits direct descendant-to-parent transitions immediately", () => {
    const region = makeRegion();
    const tracker = createSpatialAreaTracker(region, { confirmationFrames: 3 });

    const first = tracker.resolve("player:mim", { x: 2, y: 3, z: 2 });
    const second = tracker.resolve("player:mim", { x: 7, y: 3, z: 7 });

    expect(first.area?.areaId).toBe("cheese-kiosk");
    expect(second.rawArea?.areaId).toBe("station-exterior");
    expect(second.area?.areaId).toBe("station-exterior");
    expect(second.changed).toBe(true);
  });
});
