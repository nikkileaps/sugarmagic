import { describe, expect, it } from "vitest";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  createDefaultQuestDefinition,
  createDefaultQuestNodeDefinition,
  createDefaultQuestStageDefinition
} from "@sugarmagic/domain";
import {
  QuestManager,
  isRegionAreaDescendant,
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
    placedAssets: [],
    folders: [],
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
      surfaceSlots: [],
      deform: null,
      effect: null,
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
      sceneId: "wordlark-hollow",
      sceneDisplayName: "Wordlark Hollow Station",
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

describe("location objectives", () => {
  /**
   * A location objective completes when the player is inside its target area,
   * or inside anything nested in it. QuestManager cannot read the player's
   * position -- it takes a predicate, and this drives the real one's rule.
   */
  function buildLocationQuest(targetAreaId: string) {
    const node = {
      ...createDefaultQuestNodeDefinition({
        displayName: "Reach the Kiosk",
        description: "Go there",
        objectiveSubtype: "location"
      }),
      targetAreaId
    };
    const stage = createDefaultQuestStageDefinition({ nodeDefinitions: [node] });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:go-there",
      displayName: "Go There"
    });
    return {
      ...quest,
      startStageId: stage.stageId,
      stageDefinitions: [stage]
    };
  }

  function managerInArea(targetAreaId: string, playerAreaId: string | null) {
    const region = makeRegion();
    const manager = new QuestManager();
    manager.registerDefinitions([buildLocationQuest(targetAreaId)]);
    manager.setPlayerAreaProvider((areaId) => {
      if (!playerAreaId) return false;
      return (
        playerAreaId === areaId ||
        isRegionAreaDescendant(region, playerAreaId, areaId)
      );
    });
    manager.startQuest("quest:go-there");
    return manager;
  }

  it("completes when the player is in the target area", () => {
    const manager = managerInArea("cheese-kiosk", "cheese-kiosk");
    manager.update();
    expect(manager.isQuestCompleted("quest:go-there")).toBe(true);
  });

  it("completes from an area nested inside the target", () => {
    // The kiosk sits inside the station exterior.
    const manager = managerInArea("station-exterior", "cheese-kiosk");
    manager.update();
    expect(manager.isQuestCompleted("quest:go-there")).toBe(true);
  });

  it("does not complete from somewhere else", () => {
    const manager = managerInArea("cheese-kiosk", "ticket-office");
    manager.update();
    expect(manager.isQuestCompleted("quest:go-there")).toBe(false);
  });

  it("does not complete when the player is in no area at all", () => {
    const manager = managerInArea("cheese-kiosk", null);
    manager.update();
    expect(manager.isQuestCompleted("quest:go-there")).toBe(false);
  });

  it("does not complete a node that has not activated yet", () => {
    // Standing in the area before the objective is reachable must not tick it
    // off the moment it activates later.
    const region = makeRegion();
    const first = createDefaultQuestNodeDefinition({
      displayName: "Talk First",
      description: "Do this first",
      objectiveSubtype: "custom"
    });
    const second = {
      ...createDefaultQuestNodeDefinition({
        displayName: "Reach the Kiosk",
        description: "Then go there",
        objectiveSubtype: "location"
      }),
      targetAreaId: "cheese-kiosk",
      prerequisiteNodeIds: [first.nodeId]
    };
    const stage = createDefaultQuestStageDefinition({
      nodeDefinitions: [first, second],
      entryNodeIds: [first.nodeId]
    });
    const quest = createDefaultQuestDefinition({
      definitionId: "quest:ordered",
      displayName: "Ordered"
    });
    const manager = new QuestManager();
    manager.registerDefinitions([
      { ...quest, startStageId: stage.stageId, stageDefinitions: [stage] }
    ]);
    manager.setPlayerAreaProvider((areaId) =>
      areaId === "cheese-kiosk" ||
      isRegionAreaDescendant(region, "cheese-kiosk", areaId)
    );
    manager.startQuest("quest:ordered");
    manager.update();

    // The location node is behind a prerequisite, so it is not active yet.
    expect(manager.isNodeCompleted("quest:ordered", second.nodeId)).toBe(false);
    expect(manager.isQuestCompleted("quest:ordered")).toBe(false);
  });
});
