/**
 * Authored region links (epic #226 story 12).
 *
 * "This doorway leads to that region" had nowhere to live: the volume
 * trigger was audio and flags only, and no quest action named a region.
 * A link is one member of the shared action list, so it can sit on a
 * volume's enter actions or on a quest node with no second mechanism.
 *
 * Authoring only. Walking through one is story 13; until then the runtime
 * warns rather than moving the player.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultRegion,
  createRegionMarker,
  createRegionVolumeDefinition,
  normalizeQuestAction,
  validateProjectContent,
  QUEST_ACTION_TYPE_OPTIONS,
  createQuestAction,
  type RegionDocument
} from "@sugarmagic/domain";

describe("a link names a region and where in it", () => {
  it("is offered by the one action picker every surface renders", () => {
    // A volume's enter list and a quest node read the same list, so a door
    // and a story beat author the same way.
    expect(QUEST_ACTION_TYPE_OPTIONS.map((option) => option.value)).toContain(
      "goToRegion"
    );
  });

  it("starts with nothing picked rather than guessing a region", () => {
    expect(createQuestAction("goToRegion")).toEqual({
      type: "goToRegion",
      regionId: null,
      markerId: null
    });
  });

  it("round-trips a region and a marker", () => {
    expect(
      normalizeQuestAction({
        type: "goToRegion",
        regionId: "region:market",
        markerId: "marker:west-door"
      })
    ).toEqual({
      type: "goToRegion",
      regionId: "region:market",
      markerId: "marker:west-door"
    });
  });

  it("keeps a region with no marker, meaning that region's player start", () => {
    // A region an author has not put markers in yet still has a player
    // start, so the link is usable before any marker exists.
    expect(
      normalizeQuestAction({ type: "goToRegion", regionId: "region:market" })
    ).toEqual({
      type: "goToRegion",
      regionId: "region:market",
      markerId: null
    });
  });
});

describe("a link on a volume", () => {
  it("survives the volume factory like any other action", () => {
    const doorway = createRegionVolumeDefinition({
      volumeId: "vol:doorway",
      onEnterActions: [
        {
          type: "goToRegion",
          regionId: "region:market",
          markerId: "marker:west-door"
        }
      ]
    });

    expect(doorway.onEnterActions).toEqual([
      {
        type: "goToRegion",
        regionId: "region:market",
        markerId: "marker:west-door"
      }
    ]);
  });

  it("names the marker rather than copying where it is", () => {
    // Moving the marker moves every arrival that names it. A copied
    // transform would drift the first time the author nudged the marker.
    const marker = createRegionMarker({
      markerId: "marker:west-door",
      displayName: "West Door"
    });
    const link = normalizeQuestAction({
      type: "goToRegion",
      regionId: "region:market",
      markerId: marker.markerId
    });

    expect(link).toMatchObject({ markerId: "marker:west-door" });
    expect(JSON.stringify(link)).not.toContain("position");
  });
});

const HERE = "region:station";
const THERE = "region:market";

/** Two regions: a doorway in one, a marker in the other. */
function twoRegions(options: {
  linkRegionId: string | null;
  linkMarkerId: string | null;
  markerInDestination: boolean;
}): RegionDocument[] {
  const here = createDefaultRegion({
    regionId: HERE,
    displayName: "Station"
  });
  here.volumes = [
    createRegionVolumeDefinition({
      volumeId: "vol:doorway",
      onEnterActions: [
        {
          type: "goToRegion",
          regionId: options.linkRegionId,
          markerId: options.linkMarkerId
        }
      ]
    })
  ];
  const there = createDefaultRegion({
    regionId: THERE,
    displayName: "Market"
  });
  there.markers = options.markerInDestination
    ? [
        createRegionMarker({
          markerId: "marker:west-door",
          displayName: "West Door"
        })
      ]
    : [];
  return [here, there];
}

function validate(regions: RegionDocument[]) {
  const base = createDefaultGameProject("Test", "test");
  const project = {
    ...base,
    episodes: base.episodes.map((episode) => ({
      ...episode,
      scenes: episode.scenes.map((scene) => ({ ...scene, regionId: HERE }))
    }))
  };
  return validateProjectContent(project, regions);
}

describe("a link that leads nowhere", () => {
  it("is accepted when the region and marker both exist", () => {
    const result = validate(
      twoRegions({
        linkRegionId: THERE,
        linkMarkerId: "marker:west-door",
        markerInDestination: true
      })
    );

    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("is an error when the destination region is gone", () => {
    const result = validate(
      twoRegions({
        linkRegionId: "region:deleted",
        linkMarkerId: null,
        markerInDestination: true
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("does not exist"))
    ).toBe(true);
  });

  it("is an error when the marker is gone from a region that still exists", () => {
    // The quieter half: the door opens, the player lands somewhere
    // unintended, and nothing says why.
    const result = validate(
      twoRegions({
        linkRegionId: THERE,
        linkMarkerId: "marker:west-door",
        markerInDestination: false
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes("that region does not have")
      )
    ).toBe(true);
  });

  it("accepts a region with no marker picked, meaning its player start", () => {
    const result = validate(
      twoRegions({
        linkRegionId: THERE,
        linkMarkerId: null,
        markerInDestination: false
      })
    );

    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
