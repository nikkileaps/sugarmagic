import type { RegionDocument } from "@sugarmagic/domain";
import {
  getEntityPlayerSpatialRelation,
  setEntityCurrentArea,
  setEntityLocation,
  setEntityPlayerSpatialRelation,
  setEntityPosition,
  type LocationReference,
  type RuntimeBlackboard
} from "../state";
import {
  buildEntityCurrentAreaFact,
  buildEntityPlayerSpatialRelationFact,
  buildLocationReference,
  createSpatialAreaTracker
} from "./index";

interface SpatialDebugSnapshot {
  areaId: string | null;
  areaDisplayName: string | null;
  proximityBand?: string | null;
}

export interface RuntimeSpatialResolverSystemOptions {
  blackboard: RuntimeBlackboard;
  region: RegionDocument;
  playerEntityId: string;
  confirmationFrames?: number;
  logDebug?: (event: string, payload?: Record<string, unknown>) => void;
}

export interface RuntimeSpatialResolverSystemSyncInput {
  playerPosition: { x: number; y: number; z: number };
  npcPositions: Array<{
    entityId: string;
    position: { x: number; y: number; z: number };
  }>;
}

export interface RuntimeSpatialResolverSystem {
  buildRegionLocationReference: () => LocationReference;
  sync: (input: RuntimeSpatialResolverSystemSyncInput) => void;
  reset: () => void;
}

interface SyncEntitySpatialFactsOptions {
  entityId: string;
  entityKind: "player" | "npc";
  position: { x: number; y: number; z: number };
  playerPosition?: { x: number; y: number; z: number };
  playerArea?: import("@sugarmagic/domain").RegionAreaDefinition | null;
}

export function createRuntimeSpatialResolverSystem(
  options: RuntimeSpatialResolverSystemOptions
): RuntimeSpatialResolverSystem {
  const {
    blackboard,
    region,
    playerEntityId,
    confirmationFrames,
    logDebug
  } = options;
  const spatialAreaTracker = createSpatialAreaTracker(region, {
    confirmationFrames
  });
  const lastAreaDebugByEntityId = new Map<string, SpatialDebugSnapshot>();
  const lastRelationDebugByEntityId = new Map<string, SpatialDebugSnapshot>();

  function emitDebug(event: string, payload?: Record<string, unknown>) {
    logDebug?.(event, payload);
  }

  function buildRegionLocationReference(): LocationReference {
    return buildLocationReference(region, null);
  }

  function syncEntitySpatialFacts(options: SyncEntitySpatialFactsOptions) {
    const currentLocation = buildRegionLocationReference();
    const { entityId, entityKind, position } = options;
    const resolution = spatialAreaTracker.resolve(entityId, position);
    const area = resolution.area;

    setEntityPosition(blackboard, {
      entityId,
      x: position.x,
      y: position.y,
      z: position.z,
      regionId: currentLocation.regionId,
      sceneId: currentLocation.sceneId
    });
    setEntityCurrentArea(
      blackboard,
      buildEntityCurrentAreaFact(region, entityId, area)
    );
    setEntityLocation(blackboard, {
      entityId,
      location: buildLocationReference(region, area)
    });

    const previousArea = lastAreaDebugByEntityId.get(entityId) ?? null;
    const nextArea: SpatialDebugSnapshot = {
      areaId: area?.areaId ?? null,
      areaDisplayName: area?.displayName ?? null
    };
    if (resolution.changed || previousArea?.areaId !== nextArea.areaId) {
      emitDebug("spatial-area-changed", {
        entityId,
        entityKind,
        areaId: nextArea.areaId,
        areaDisplayName: nextArea.areaDisplayName,
        rawAreaId: resolution.rawArea?.areaId ?? null,
        stabilized: resolution.rawArea?.areaId !== nextArea.areaId
      });
      lastAreaDebugByEntityId.set(entityId, nextArea);
    }

    if (
      entityKind === "npc" &&
      options.playerPosition &&
      options.playerArea !== undefined
    ) {
      setEntityPlayerSpatialRelation(
        blackboard,
        buildEntityPlayerSpatialRelationFact({
          region,
          entityId,
          playerEntityId,
          entityArea: area,
          playerArea: options.playerArea,
          entityPosition: position,
          playerPosition: options.playerPosition
        })
      );
      const relation = getEntityPlayerSpatialRelation(blackboard, entityId);
      const previousRelation = lastRelationDebugByEntityId.get(entityId) ?? null;
      if (
        relation &&
        (
          previousRelation?.proximityBand !== relation.proximityBand ||
          previousRelation?.areaId !== relation.entityAreaId
        )
      ) {
        emitDebug("spatial-proximity-changed", {
          entityId,
          playerEntityId: relation.playerEntityId,
          proximityBand: relation.proximityBand,
          sameArea: relation.sameArea,
          sameParentArea: relation.sameParentArea,
          distanceMeters:
            relation.distanceMeters === null
              ? null
              : Number(relation.distanceMeters.toFixed(2))
        });
        lastRelationDebugByEntityId.set(entityId, {
          areaId: relation.entityAreaId,
          areaDisplayName: area?.displayName ?? null,
          proximityBand: relation.proximityBand
        });
      }
    }

    return area;
  }

  return {
    buildRegionLocationReference,
    sync(input) {
      const playerArea =
        syncEntitySpatialFacts({
          entityId: playerEntityId,
          entityKind: "player",
          position: input.playerPosition
        }) ?? null;

      for (const npc of input.npcPositions) {
        syncEntitySpatialFacts({
          entityId: npc.entityId,
          entityKind: "npc",
          position: npc.position,
          playerPosition: input.playerPosition,
          playerArea
        });
      }
    },
    reset() {
      spatialAreaTracker.reset();
      lastAreaDebugByEntityId.clear();
      lastRelationDebugByEntityId.clear();
    }
  };
}
