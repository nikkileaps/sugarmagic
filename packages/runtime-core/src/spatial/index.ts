import {
  resolveRegionVolumes,
  volumeToRegionArea,
  type RegionAreaBounds,
  type RegionAreaDefinition,
  type RegionDocument,
  type RegionVolumeDefinition
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

/** Exported so the volume-crossing tracker (and any role consumer)
 *  shares one box containment test. Y is honored (volumes are boxes). */
export function containsPoint(
  bounds: RegionAreaBounds,
  x: number,
  y: number,
  z: number
): boolean {
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

  // Plan 069.4 — source from the CANONICAL `label`-role volumes, not the
  // `@deprecated region.areas` alias, so this has zero live readers of the
  // alias and can't drift if a future write path forgets to re-derive it.
  // (`volumeToRegionArea` is exactly what derives the alias, so results are
  // identical to the old `region.areas`.)
  const index = new Map<string, RegionAreaDefinition>();
  for (const volume of resolveRegionVolumes(region)) {
    const area = volumeToRegionArea(volume);
    if (area) {
      index.set(area.areaId, area);
    }
  }
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
  // Plan 069.4 — canonical label volumes (via `buildAreaIndex`), not the
  // `@deprecated region.areas` alias.
  const containingAreas = [...buildAreaIndex(region).values()].filter((area) =>
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

interface SpatialAreaResolutionCore {
  rawArea: RegionAreaDefinition | null;
  area: RegionAreaDefinition | null;
  changed: boolean;
}

export interface SpatialAreaResolution extends SpatialAreaResolutionCore {
  /**
   * Volumes this entity crossed INTO / OUT of since the last resolve. Edge
   * of since the previous resolve. Edge-detected off a per-entity inside
   * set, so a volume runs once per entry and re-arms only after an exit.
   */
  volumesEntered: RegionVolumeDefinition[];
  volumesExited: RegionVolumeDefinition[];
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

  // Volumes that DO something on a crossing, and the per-entity inside set
  // we edge-detect against. A volume with no actions on either side is not
  // tracked -- there would be nothing to run.
  const actionVolumes = resolveRegionVolumes(region).filter(
    (volume) =>
      volume.enabled &&
      (volume.onEnterActions.length > 0 || volume.onExitActions.length > 0)
  );
  const insideVolumeIdsByEntity = new Map<string, Set<string>>();

  function resolveVolumeCrossings(
    entityId: string,
    position: { x: number; y: number; z: number }
  ): { entered: RegionVolumeDefinition[]; exited: RegionVolumeDefinition[] } {
    const entered: RegionVolumeDefinition[] = [];
    const exited: RegionVolumeDefinition[] = [];
    if (actionVolumes.length === 0) {
      return { entered, exited };
    }
    const previous = insideVolumeIdsByEntity.get(entityId);
    // First resolve for this entity: PRIME the inside-set (record where it
    // already is) without emitting edges — spawning INSIDE a volume is not a
    // crossing, so loading a save there must not re-run its enter actions.
    // Only genuine enter/exit crossings on later frames run anything.
    const isFirstResolve = previous === undefined;
    const current = new Set<string>();
    for (const volume of actionVolumes) {
      const inside = containsPoint(
        volume.bounds,
        position.x,
        position.y,
        position.z
      );
      if (inside) {
        current.add(volume.volumeId);
        if (!isFirstResolve && !previous.has(volume.volumeId)) {
          entered.push(volume);
        }
      } else if (!isFirstResolve && previous.has(volume.volumeId)) {
        exited.push(volume);
      }
    }
    insideVolumeIdsByEntity.set(entityId, current);
    return { entered, exited };
  }

  function resolveArea(
    entityId: string,
    position: { x: number; y: number; z: number }
  ): SpatialAreaResolutionCore {
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
  }

  return {
    resolve(entityId, position) {
      const areaResolution = resolveArea(entityId, position);
      const crossings = resolveVolumeCrossings(entityId, position);
      return {
        ...areaResolution,
        volumesEntered: crossings.entered,
        volumesExited: crossings.exited
      };
    },
    reset() {
      states.clear();
      insideVolumeIdsByEntity.clear();
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
