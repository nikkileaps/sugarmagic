/**
 * Unified Volume migration (Plan 069.4).
 *
 * The load-time migration of RegionAreaDefinition + RegionAmbienceZone into
 * canonical `volumes`, with the `@deprecated` area/ambience aliases
 * re-derived so every legacy reader keeps working. The bar is INVISIBILITY:
 * every field + id survives, and the aliases are byte-identical to the
 * legacy stores.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot,
  normalizeRegionDocumentForLoad,
  type RegionAmbienceZone,
  type RegionAreaDefinition,
  type RegionDocument,
  type RegionVolumeDefinition
} from "@sugarmagic/domain";

const AREAS: RegionAreaDefinition[] = [
  {
    areaId: "area:market",
    displayName: "Market",
    lorePageId: "lore:market",
    parentAreaId: null,
    kind: "zone",
    bounds: { kind: "box", center: [1, 0, 2], size: [10, 4, 10] }
  },
  {
    areaId: "area:stall",
    displayName: "Fruit Stall",
    lorePageId: null,
    parentAreaId: "area:market", // nested
    kind: "stall",
    bounds: { kind: "box", center: [3, 0, 4], size: [2, 3, 2] }
  }
];

const AMBIENCE: RegionAmbienceZone[] = [
  {
    zoneId: "zone:crowd",
    displayName: "Crowd Murmur",
    cueDefinitionId: "cue:crowd",
    center: [1, 0, 2],
    size: [10, 4, 10],
    trigger: "always",
    enabled: true
  }
];

function legacyRegion(): RegionDocument {
  return {
    identity: { id: "region-vol", schema: "RegionDocument", version: 1 },
    displayName: "Volume Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: null },
    areas: AREAS.map((area) => ({ ...area })),
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({}),
    audio: { emitters: [], ambienceZones: AMBIENCE.map((z) => ({ ...z })) },
    markers: [],
    gameplayPlacements: []
    // no `volumes` — a pre-069.4 file
  };
}

const library = createEmptyContentLibrarySnapshot("wordlark");
const normalize = (region: RegionDocument): RegionDocument =>
  normalizeRegionDocumentForLoad(region, library);

describe("unified Volume migration — invisibility", () => {
  it("migrates areas + ambience into canonical volumes (ids preserved)", () => {
    const { volumes = [] } = normalize(legacyRegion());
    expect(volumes).toHaveLength(3); // 2 areas + 1 ambience zone

    const market = volumes.find((v) => v.volumeId === "area:market")!;
    expect(market.roles).toEqual(["label"]);
    expect(market.labelKind).toBe("zone");
    expect(market.lorePageId).toBe("lore:market");
    expect(market.parentVolumeId).toBeNull();
    expect(market.bounds).toEqual(AREAS[0]!.bounds);

    const stall = volumes.find((v) => v.volumeId === "area:stall")!;
    expect(stall.parentVolumeId).toBe("area:market"); // nesting preserved
    expect(stall.labelKind).toBe("stall");

    const crowd = volumes.find((v) => v.volumeId === "zone:crowd")!;
    expect(crowd.roles).toEqual(["trigger"]);
    expect(crowd.trigger).toEqual({
      timing: "always",
      action: { audioCueId: "cue:crowd", setWorldFlag: null }
    });
    expect(crowd.enabled).toBe(true);
    expect(crowd.bounds).toEqual({
      kind: "box",
      center: [1, 0, 2],
      size: [10, 4, 10]
    });
  });

  it("re-derives the area alias identically to the legacy store", () => {
    const normalized = normalize(legacyRegion());
    // Same ids, kinds, lore, nesting, bounds — a findRegionAreaById /
    // targetAreaId consumer sees exactly what it saw before.
    expect(normalized.areas).toEqual(AREAS);
  });

  it("re-derives the ambience-zone alias identically to the legacy store", () => {
    const normalized = normalize(legacyRegion());
    expect(normalized.audio?.ambienceZones).toEqual(AMBIENCE);
  });

  it("is idempotent — re-loading a migrated region is a fixed point", () => {
    const once = normalize(legacyRegion());
    const twice = normalize(once);
    expect(twice.volumes).toEqual(once.volumes);
    expect(twice.areas).toEqual(once.areas);
    expect(twice.audio?.ambienceZones).toEqual(once.audio?.ambienceZones);
  });

  it("preserves canonical volumes (incl. physical roles) when already migrated", () => {
    // A post-069.4 region with a blocker volume that has NO area/ambience
    // alias — it must survive load and not be dropped by re-derivation.
    const blocker: RegionVolumeDefinition = {
      volumeId: "vol:wall",
      displayName: "Invisible Wall",
      parentVolumeId: null,
      enabled: true,
      bounds: { kind: "box", center: [0, 0, 0], size: [1, 4, 8] },
      roles: ["blocker"],
      labelKind: null,
      lorePageId: null,
      blockDirection: "both",
      condition: null,
      trigger: null,
      navCost: null
    };
    const region = legacyRegion();
    region.volumes = [...AREAS.map((a) => ({
      volumeId: a.areaId,
      displayName: a.displayName,
      parentVolumeId: a.parentAreaId,
      enabled: true,
      bounds: a.bounds,
      roles: ["label"] as RegionVolumeDefinition["roles"],
      labelKind: a.kind,
      lorePageId: a.lorePageId,
      blockDirection: null,
      condition: null,
      trigger: null,
      navCost: null
    })), blocker];
    // Legacy areas/ambience present too, but volumes is canonical.
    const normalized = normalize(region);
    expect(normalized.volumes?.some((v) => v.volumeId === "vol:wall")).toBe(true);
    // The blocker has no label role, so it doesn't leak into the area alias.
    expect(normalized.areas.some((a) => a.areaId === "vol:wall")).toBe(false);
    // Label volumes still derive their area aliases.
    expect(normalized.areas.map((a) => a.areaId)).toEqual([
      "area:market",
      "area:stall"
    ]);
  });
});
