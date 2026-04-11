import type {
  RegionAreaBounds,
  RegionAreaDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import type {
  AreaReference,
  EntityCurrentAreaFact,
  EntityPlayerSpatialRelationFact,
  LocationReference,
  SpatialProximityBand
} from "../state";

const regionAreaIndexCache = new WeakMap<
  RegionDocument,
  Map<string, RegionAreaDefinition>
>();

function containsPoint(bounds: RegionAreaBounds, x: number, y: number, z: number): boolean {
  const [centerX, centerY, centerZ] = bounds.center;
  const [sizeX, sizeY, sizeZ] = bounds.size;
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const halfZ = sizeZ / 2;

  return (
    x >= centerX - halfX &&
    x <= centerX + halfX &&
    y >= centerY - halfY &&
    y <= centerY + halfY &&
    z >= centerZ - halfZ &&
    z <= centerZ + halfZ
  );
}

function volume(area: RegionAreaDefinition): number {
  return area.bounds.size[0] * area.bounds.size[1] * area.bounds.size[2];
}

export function buildAreaIndex(region: RegionDocument): Map<string, RegionAreaDefinition> {
  const cached = regionAreaIndexCache.get(region);
  if (cached) {
    return cached;
  }

  const index = new Map(region.areas.map((area) => [area.areaId, area]));
  regionAreaIndexCache.set(region, index);
  return index;
}

export function findRegionAreaById(
  region: RegionDocument,
  areaId: string | null | undefined
): RegionAreaDefinition | null {
  if (!areaId) {
    return null;
  }
  return buildAreaIndex(region).get(areaId) ?? null;
}

export function isRegionAreaDescendant(
  region: RegionDocument,
  candidateAreaId: string | null | undefined,
  ancestorAreaId: string | null | undefined
): boolean {
  return isRegionAreaDescendantInIndex(
    buildAreaIndex(region),
    candidateAreaId,
    ancestorAreaId
  );
}

function isRegionAreaDescendantInIndex(
  index: Map<string, RegionAreaDefinition>,
  candidateAreaId: string | null | undefined,
  ancestorAreaId: string | null | undefined
): boolean {
  if (!candidateAreaId || !ancestorAreaId || candidateAreaId === ancestorAreaId) {
    return false;
  }
  let current = index.get(candidateAreaId) ?? null;
  while (current?.parentAreaId) {
    if (current.parentAreaId === ancestorAreaId) {
      return true;
    }
    current = index.get(current.parentAreaId) ?? null;
  }
  return false;
}

export function resolveRegionAreaAtPosition(
  region: RegionDocument,
  position: { x: number; y: number; z: number }
): RegionAreaDefinition | null {
  const containingAreas = region.areas.filter((area) =>
    containsPoint(area.bounds, position.x, position.y, position.z)
  );
  if (containingAreas.length === 0) {
    return null;
  }

  containingAreas.sort((left, right) => volume(left) - volume(right));
  return containingAreas[0] ?? null;
}

export interface SpatialAreaTrackerOptions {
  confirmationFrames?: number;
}

export interface SpatialAreaResolution {
  rawArea: RegionAreaDefinition | null;
  area: RegionAreaDefinition | null;
  changed: boolean;
}

interface SpatialAreaTrackerState {
  committedAreaId: string | null;
  candidateAreaId: string | null;
  candidateFrames: number;
}

export interface SpatialAreaTracker {
  resolve: (
    entityId: string,
    position: { x: number; y: number; z: number }
  ) => SpatialAreaResolution;
  reset: () => void;
}

export function createSpatialAreaTracker(
  region: RegionDocument,
  options: SpatialAreaTrackerOptions = {}
): SpatialAreaTracker {
  const confirmationFrames = Math.max(1, options.confirmationFrames ?? 3);
  const states = new Map<string, SpatialAreaTrackerState>();
  const index = buildAreaIndex(region);

  return {
    resolve(entityId, position) {
      const rawArea = resolveRegionAreaAtPosition(region, position);
      const rawAreaId = rawArea?.areaId ?? null;
      const state = states.get(entityId);

      if (!state) {
        states.set(entityId, {
          committedAreaId: rawAreaId,
          candidateAreaId: null,
          candidateFrames: 0
        });
        return {
          rawArea,
          area: rawArea,
          changed: rawAreaId !== null
        };
      }

      if (rawAreaId === state.committedAreaId) {
        state.candidateAreaId = null;
        state.candidateFrames = 0;
        return {
          rawArea,
          area: state.committedAreaId ? index.get(state.committedAreaId) ?? null : null,
          changed: false
        };
      }

      if (
        rawAreaId &&
        state.committedAreaId &&
        isRegionAreaDescendantInIndex(index, rawAreaId, state.committedAreaId)
      ) {
        state.committedAreaId = rawAreaId;
        state.candidateAreaId = null;
        state.candidateFrames = 0;
        return {
          rawArea,
          area: rawArea,
          changed: true
        };
      }

      if (
        rawAreaId &&
        state.committedAreaId &&
        isRegionAreaDescendantInIndex(index, state.committedAreaId, rawAreaId)
      ) {
        state.committedAreaId = rawAreaId;
        state.candidateAreaId = null;
        state.candidateFrames = 0;
        return {
          rawArea,
          area: rawAreaId ? index.get(rawAreaId) ?? null : null,
          changed: true
        };
      }

      if (state.candidateAreaId === rawAreaId) {
        state.candidateFrames += 1;
      } else {
        state.candidateAreaId = rawAreaId;
        state.candidateFrames = 1;
      }

      if (state.candidateFrames >= confirmationFrames) {
        state.committedAreaId = rawAreaId;
        state.candidateAreaId = null;
        state.candidateFrames = 0;
        return {
          rawArea,
          area: rawAreaId ? index.get(rawAreaId) ?? null : null,
          changed: true
        };
      }

      return {
        rawArea,
        area: state.committedAreaId ? index.get(state.committedAreaId) ?? null : null,
        changed: false
      };
    },
    reset() {
      states.clear();
    }
  };
}

export function classifySpatialProximity(
  region: RegionDocument,
  leftArea: RegionAreaDefinition | null,
  rightArea: RegionAreaDefinition | null
): SpatialProximityBand {
  if (leftArea?.areaId && rightArea?.areaId && leftArea.areaId === rightArea.areaId) {
    return "immediate";
  }

  if (leftArea && rightArea) {
    const isDirectlyRelated =
      (leftArea.parentAreaId !== null && leftArea.parentAreaId === rightArea.parentAreaId) ||
      leftArea.parentAreaId === rightArea.areaId ||
      rightArea.parentAreaId === leftArea.areaId;
    if (isDirectlyRelated) {
      return "local";
    }
    return "remote";
  }

  return "remote";
}

function computeDistanceMeters(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function buildEntityCurrentAreaFact(
  region: RegionDocument,
  entityId: string,
  area: RegionAreaDefinition | null
): EntityCurrentAreaFact {
  const index = buildAreaIndex(region);
  const parentArea = area?.parentAreaId ? index.get(area.parentAreaId) ?? null : null;

  return {
    entityId,
    area: buildAreaReference(area),
    parentArea: buildAreaReference(parentArea)
  };
}

export function buildEntityPlayerSpatialRelationFact(input: {
  region: RegionDocument;
  entityId: string;
  playerEntityId: string;
  entityArea: RegionAreaDefinition | null;
  playerArea: RegionAreaDefinition | null;
  entityPosition: { x: number; y: number; z: number };
  playerPosition: { x: number; y: number; z: number };
}): EntityPlayerSpatialRelationFact {
  const {
    region,
    entityId,
    playerEntityId,
    entityArea,
    playerArea,
    entityPosition,
    playerPosition
  } = input;
  const proximityBand = classifySpatialProximity(region, entityArea, playerArea);
  return {
    entityId,
    playerEntityId,
    entityAreaId: entityArea?.areaId ?? null,
    playerAreaId: playerArea?.areaId ?? null,
    sameArea:
      !!entityArea &&
      !!playerArea &&
      entityArea.areaId === playerArea.areaId,
    sameParentArea:
      !!entityArea &&
      !!playerArea &&
      entityArea.parentAreaId !== null &&
      playerArea.parentAreaId !== null &&
      entityArea.parentAreaId === playerArea.parentAreaId,
    proximityBand,
    distanceMeters: computeDistanceMeters(entityPosition, playerPosition)
  };
}

export function buildLocationReference(
  region: RegionDocument,
  area: RegionAreaDefinition | null
): LocationReference {
  const index = buildAreaIndex(region);
  const parentArea = area?.parentAreaId ? index.get(area.parentAreaId) ?? null : null;
  return {
    regionId: region.identity.id,
    regionDisplayName: region.displayName,
    regionLorePageId: region.lorePageId ?? null,
    sceneId: region.identity.id,
    sceneDisplayName: region.displayName,
    area: buildAreaReference(area),
    parentArea: buildAreaReference(parentArea)
  };
}

function buildAreaReference(area: RegionAreaDefinition | null): AreaReference | null {
  if (!area) {
    return null;
  }
  return {
    areaId: area.areaId,
    displayName: area.displayName,
    lorePageId: area.lorePageId ?? null,
    kind: area.kind
  };
}
