/**
 * Named markers: a point in a region, not a region of floor (epic #226
 * story 18).
 *
 * Two problems wanted the same missing primitive. A door needs to say
 * where the player lands and which way they face. A behavior task aimed
 * at an AREA gets a hash-sampled point anywhere inside the box, so "go to
 * the market" can legitimately mean "stand against the wall".
 *
 * A marker is a named place. What it MEANS comes from whoever references
 * it, which is why there is no kind tag on it.
 */

import { describe, expect, it } from "vitest";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createRegionMarker,
  createRegionNPCBehaviorTask,
  type RegionDocument,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "region:hollow";

function sessionWithRegion(region: RegionDocument) {
  return createAuthoringSession(createDefaultGameProject("Test", "test"), [
    region
  ]);
}

function command(kind: string, payload: unknown): SemanticCommand {
  return {
    kind,
    target: { aggregateKind: "region-document", aggregateId: REGION_ID },
    subject: { subjectKind: "region-marker", subjectId: "marker:counter" },
    payload
  } as SemanticCommand;
}

describe("a marker is a named place", () => {
  it("carries a full transform, because facing is half the point", () => {
    const marker = createRegionMarker({ displayName: "Behind Counter" });

    // Arriving through a door pointed at a wall, or standing behind a
    // counter looking away from it, are the same bug.
    expect(marker.transform.position).toHaveLength(3);
    expect(marker.transform.rotation).toHaveLength(3);
    expect(marker.displayName).toBe("Behind Counter");
  });

  it("has no kind tag to disagree with what references it", () => {
    expect(Object.keys(createRegionMarker()).sort()).toEqual([
      "displayName",
      "markerId",
      "transform"
    ]);
  });
});

describe("authoring markers", () => {
  const region = () =>
    createDefaultRegion({ regionId: REGION_ID, displayName: "Hollow" });

  it("a region starts with none", () => {
    expect(region().markers).toEqual([]);
  });

  it("creating adds one, and moving it edits that one", () => {
    const created = applyCommand(
      sessionWithRegion(region()),
      command("CreateRegionMarker", {
        marker: createRegionMarker({
          markerId: "marker:counter",
          displayName: "Behind Counter"
        })
      })
    );
    expect(created.regions.get(REGION_ID)!.markers).toHaveLength(1);

    const moved = applyCommand(
      created,
      command("UpdateRegionMarker", {
        markerId: "marker:counter",
        patch: {
          transform: {
            position: [4, 0, -2] as [number, number, number],
            rotation: [0, 90, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number]
          }
        }
      })
    );

    const marker = moved.regions.get(REGION_ID)!.markers[0]!;
    expect(marker.transform.position).toEqual([4, 0, -2]);
    expect(marker.transform.rotation).toEqual([0, 90, 0]);
    expect(marker.displayName).toBe("Behind Counter");
  });

  it("deleting removes only the named one", () => {
    const seeded = {
      ...region(),
      markers: [
        createRegionMarker({ markerId: "marker:counter" }),
        createRegionMarker({ markerId: "marker:door" })
      ]
    };

    const next = applyCommand(
      sessionWithRegion(seeded),
      command("DeleteRegionMarker", { markerId: "marker:counter" })
    );

    expect(
      next.regions.get(REGION_ID)!.markers.map((m) => m.markerId)
    ).toEqual(["marker:door"]);
  });
});

describe("a behavior task's destination", () => {
  it("names an area or a marker, never both", () => {
    const atMarker = createRegionNPCBehaviorTask({
      target: { kind: "marker", markerId: "marker:counter" }
    });
    const inArea = createRegionNPCBehaviorTask({
      target: { kind: "area", areaId: "area:market" }
    });

    // One field with two shapes: there is no state where a task names an
    // area AND a marker and something has to pick.
    expect(atMarker.target).toEqual({
      kind: "marker",
      markerId: "marker:counter"
    });
    expect(inArea.target).toEqual({ kind: "area", areaId: "area:market" });
  });

  it("reads a pre-marker task's bare targetAreaId as the area it meant", () => {
    // Regions on disk still say `targetAreaId`. The factory is the one
    // place that reads it, so nothing downstream knows it existed.
    const migrated = createRegionNPCBehaviorTask({
      targetAreaId: "area:market"
    });

    expect(migrated.target).toEqual({ kind: "area", areaId: "area:market" });
  });

  it("treats a blank legacy target as no target", () => {
    expect(createRegionNPCBehaviorTask({ targetAreaId: "  " }).target).toBeNull();
    expect(createRegionNPCBehaviorTask({}).target).toBeNull();
  });
});

describe("a marker in the viewport", () => {
  const withMarker = () => {
    const region = createDefaultRegion({
      regionId: REGION_ID,
      displayName: "Hollow"
    });
    region.markers = [
      createRegionMarker({
        markerId: "marker:counter",
        displayName: "Behind Counter",
        transform: {
          position: [3, 0, -1],
          rotation: [0, 45, 0],
          scale: [1, 1, 1]
        }
      })
    ];
    return region;
  };

  it("draws for Studio, so there is something to see and grab", () => {
    // Without a scene object there is no gizmo: the transform controller
    // attaches to a drawn object, so a marker that does not render cannot
    // be moved.
    const objects = resolveSceneObjects(withMarker(), { includeMarkers: true });
    const marker = objects.find((o) => o.instanceId === "marker:counter");

    expect(marker).toBeDefined();
    expect(marker!.kind).toBe("marker");
    expect(marker!.displayName).toBe("Behind Counter");
    expect(marker!.transform.position).toEqual([3, 0, -1]);
    // No model, so it needs the capsule the renderer falls back to.
    expect(marker!.capsule).not.toBeNull();
  });

  it("does not draw by default, so the player never sees one", () => {
    // The game and the navmesh bake both take the default. A marker is an
    // authoring aid; a capsule standing in the world would be a bug.
    const objects = resolveSceneObjects(withMarker());

    expect(objects.some((o) => o.kind === "marker")).toBe(false);
  });

  it("carries no collider, because a place is not a body", () => {
    const objects = resolveSceneObjects(withMarker(), { includeMarkers: true });

    expect(objects.find((o) => o.kind === "marker")!.collider).toBeNull();
  });
});
