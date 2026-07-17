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
  createDefaultScene,
  createEmptyContentLibrarySnapshot,
  createRegionVolumeDefinition,
  executeCommand,
  normalizeRegionDocumentForLoad,
  reconcileRegionVolumesFromAreas,
  reconcileRegionVolumesFromAmbienceZones,
  type RegionAmbienceZone,
  type RegionAreaDefinition,
  type RegionDocument,
  type RegionVolumeDefinition,
  type SemanticCommand
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

describe("unified Volume — write path (069.4)", () => {
  it("edits an area after migration and the edit survives a reload", () => {
    const migrated = normalize(legacyRegion());
    const movedBounds = {
      kind: "box" as const,
      center: [9, 0, 9] as [number, number, number],
      size: [10, 4, 10] as [number, number, number]
    };
    const editedAreas = migrated.areas.map((area) =>
      area.areaId === "area:market" ? { ...area, bounds: movedBounds } : area
    );
    const written = reconcileRegionVolumesFromAreas(migrated, editedAreas);

    // Both the canonical volume and the derived alias reflect the move.
    expect(
      written.volumes?.find((v) => v.volumeId === "area:market")?.bounds
    ).toEqual(movedBounds);
    expect(
      written.areas.find((a) => a.areaId === "area:market")?.bounds
    ).toEqual(movedBounds);

    // Reload (normalize) — the edit persists (volumes is canonical).
    const reloaded = normalize(written);
    expect(
      reloaded.areas.find((a) => a.areaId === "area:market")?.bounds
    ).toEqual(movedBounds);
  });

  it("creates a new area as a label volume + alias", () => {
    const migrated = normalize(legacyRegion());
    const newArea: RegionAreaDefinition = {
      areaId: "area:dock",
      displayName: "Dock",
      lorePageId: null,
      parentAreaId: null,
      kind: "platform",
      bounds: { kind: "box", center: [0, 0, -5], size: [6, 2, 12] }
    };
    const written = reconcileRegionVolumesFromAreas(migrated, [
      ...migrated.areas,
      newArea
    ]);
    expect(
      written.volumes?.find((v) => v.volumeId === "area:dock")?.roles
    ).toEqual(["label"]);
    expect(written.areas).toContainEqual(newArea);
  });

  it("deletes an area from both volumes and the alias", () => {
    const migrated = normalize(legacyRegion());
    const written = reconcileRegionVolumesFromAreas(
      migrated,
      migrated.areas.filter((a) => a.areaId !== "area:stall")
    );
    expect(written.areas.some((a) => a.areaId === "area:stall")).toBe(false);
    expect(written.volumes?.some((v) => v.volumeId === "area:stall")).toBe(
      false
    );
    expect(written.areas.some((a) => a.areaId === "area:market")).toBe(true);
  });

  it("creates the first ambience zone (creating audio) via the trigger role", () => {
    // Region with NO audio at all.
    const region = legacyRegion();
    delete region.audio;
    region.areas = [];
    const migrated = normalize(region);
    expect(migrated.audio?.ambienceZones ?? []).toHaveLength(0);

    const zone: RegionAmbienceZone = {
      zoneId: "zone:wind",
      displayName: "Wind",
      cueDefinitionId: "cue:wind",
      center: [0, 0, 0],
      size: [20, 4, 20],
      trigger: "always",
      enabled: true
    };
    const written = reconcileRegionVolumesFromAmbienceZones(migrated, [zone]);
    expect(written.audio?.ambienceZones).toContainEqual(zone);
    expect(
      written.volumes?.find((v) => v.volumeId === "zone:wind")?.roles
    ).toEqual(["trigger"]);
  });
});

describe("unified Volume — authoring commands (069.7)", () => {
  const scene = createDefaultScene({ sceneId: "scene:test" });

  function run(region: RegionDocument, command: SemanticCommand): RegionDocument {
    return executeCommand({ region, scene }, command).region;
  }
  function cmd(
    region: RegionDocument,
    kind: SemanticCommand["kind"],
    subjectId: string,
    payload: unknown
  ): SemanticCommand {
    return {
      kind,
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "region-volume", subjectId },
      payload
    } as SemanticCommand;
  }

  it("CreateRegionVolume adds a blocker (no area alias — no label role)", () => {
    const region = normalize(legacyRegion());
    const blocker = createRegionVolumeDefinition({
      volumeId: "vol:wall",
      displayName: "Wall",
      roles: ["blocker"],
      blockDirection: "both",
      bounds: { kind: "box", center: [0, 0, 0], size: [1, 4, 8] }
    });
    const next = run(
      region,
      cmd(region, "CreateRegionVolume", blocker.volumeId, { volume: blocker })
    );
    expect(next.volumes?.some((v) => v.volumeId === "vol:wall")).toBe(true);
    expect(next.areas.some((a) => a.areaId === "vol:wall")).toBe(false);
  });

  it("UpdateRegionVolume adds a blocker role to a label volume (area alias kept)", () => {
    const region = normalize(legacyRegion());
    const next = run(
      region,
      cmd(region, "UpdateRegionVolume", "area:market", {
        volumeId: "area:market",
        patch: { roles: ["label", "blocker"], blockDirection: "in" }
      })
    );
    const volume = next.volumes?.find((v) => v.volumeId === "area:market");
    expect(volume?.roles).toEqual(["label", "blocker"]);
    expect(volume?.blockDirection).toBe("in");
    // Still a label -> still an area alias.
    expect(next.areas.some((a) => a.areaId === "area:market")).toBe(true);
  });

  it("DeleteRegionVolume removes it from volumes + alias + reparents children", () => {
    const region = normalize(legacyRegion());
    const next = run(
      region,
      cmd(region, "DeleteRegionVolume", "area:market", {
        volumeId: "area:market"
      })
    );
    expect(next.volumes?.some((v) => v.volumeId === "area:market")).toBe(false);
    expect(next.areas.some((a) => a.areaId === "area:market")).toBe(false);
    // area:stall was nested under market -> reparented to null.
    expect(
      next.volumes?.find((v) => v.volumeId === "area:stall")?.parentVolumeId
    ).toBeNull();
  });
});
