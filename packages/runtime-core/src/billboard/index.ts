/**
 * packages/runtime-core/src/billboard/index.ts
 *
 * Purpose: Defines the platform-agnostic billboard semantics, camera snapshot boundary,
 * and per-frame LOD/visibility system used by the shared runtime.
 *
 * Exports:
 *   - BillboardDescriptor
 *   - BillboardComponent
 *   - BillboardSystem
 *   - CameraSnapshot
 *   - FoliageBillboardAsset
 *
 * Relationships:
 *   - Depends only on ECS component/system types plus Position.
 *   - Is consumed by gameplay-session and the web target host as the single billboard semantic source of truth.
 *
 * Status: active
 */

import type { Component } from "../ecs/core";
import { Position } from "../ecs/components";
import { System, type World } from "../ecs/core";

export interface BillboardTextStyle {
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  padding?: string;
  maxWidth?: number;
}

export type BillboardDescriptor =
  | { kind: "sprite"; atlasId: string; frameIndex: number }
  | { kind: "text"; content: string; style?: BillboardTextStyle }
  | { kind: "impostor"; captureId: string; angles: number };

export type BillboardOrientation = "spherical" | "cylindrical" | "fixed";
export type BillboardDisplayMode = "overlay" | "world-occluded";
export type BillboardLodState = "full-mesh" | "billboard" | "culled";

export interface BillboardSize {
  width: number;
  height: number;
}

export interface BillboardOffset {
  x: number;
  y: number;
  z: number;
}

export interface BillboardLodThresholds {
  billboard: number;
  cull: number;
}

export interface BillboardComponentOptions {
  orientation?: BillboardOrientation;
  displayMode?: BillboardDisplayMode;
  size?: BillboardSize;
  offset?: BillboardOffset;
  lodThresholds?: BillboardLodThresholds;
  enabled?: boolean;
  visible?: boolean;
  lodState?: BillboardLodState;
}

export interface CameraSnapshotPlane {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly d: number;
}

export interface CameraSnapshot {
  readonly position: { x: number; y: number; z: number };
  readonly forward: { x: number; y: number; z: number };
  readonly frustumPlanes: ReadonlyArray<CameraSnapshotPlane>;
  readonly viewport: { width: number; height: number };
  readonly fov: number;
}

export interface FoliageBillboardAsset {
  texturePath: string;
  size: BillboardSize;
  tintColor?: string;
  windSwayAmplitude?: number;
  lodThresholds?: BillboardLodThresholds;
}

export class BillboardComponent implements Component {
  static readonly type = "Billboard";
  readonly type = BillboardComponent.type;
  descriptor: BillboardDescriptor;
  orientation: BillboardOrientation;
  displayMode: BillboardDisplayMode;
  size: BillboardSize;
  offset: BillboardOffset;
  lodThresholds?: BillboardLodThresholds;
  enabled: boolean;
  visible: boolean;
  lodState: BillboardLodState;

  constructor(
    descriptor: BillboardDescriptor,
    options: BillboardComponentOptions = {}
  ) {
    this.descriptor = descriptor;
    this.orientation = options.orientation ?? "spherical";
    this.displayMode = options.displayMode ?? "overlay";
    this.size = options.size ?? { width: 1, height: 1 };
    this.offset = options.offset ?? { x: 0, y: 0, z: 0 };
    this.lodThresholds = options.lodThresholds;
    this.enabled = options.enabled ?? true;
    this.visible = options.visible ?? true;
    this.lodState = options.lodState ?? (options.lodThresholds ? "full-mesh" : "billboard");
  }
}

export function isCameraSnapshot(value: unknown): value is CameraSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.position === "object" &&
    record.position !== null &&
    typeof record.forward === "object" &&
    record.forward !== null &&
    Array.isArray(record.frustumPlanes) &&
    typeof record.viewport === "object" &&
    record.viewport !== null &&
    typeof record.fov === "number"
  );
}

export function resolveBillboardLodState(
  distance: number,
  thresholds?: BillboardLodThresholds
): BillboardLodState {
  if (!thresholds) {
    return "billboard";
  }

  if (distance < thresholds.billboard) {
    return "full-mesh";
  }

  if (distance < thresholds.cull) {
    return "billboard";
  }

  return "culled";
}

function computeBillboardRadius(size: BillboardSize): number {
  return Math.sqrt(size.width * size.width + size.height * size.height) * 0.5;
}

function isSphereInsideFrustum(
  center: { x: number; y: number; z: number },
  radius: number,
  planes: ReadonlyArray<CameraSnapshotPlane>
): boolean {
  for (const plane of planes) {
    const distance =
      plane.nx * center.x +
      plane.ny * center.y +
      plane.nz * center.z +
      plane.d;
    if (distance < -radius) {
      return false;
    }
  }
  return true;
}

export class BillboardSystem extends System {
  update(world: World, _delta: number, frameContext?: unknown): void {
    const cameraSnapshot = isCameraSnapshot(frameContext) ? frameContext : null;
    if (!cameraSnapshot) {
      for (const entity of world.query(Position, BillboardComponent)) {
        const billboard = world.getComponent(entity, BillboardComponent);
        if (!billboard) {
          continue;
        }
        billboard.visible = false;
      }
      return;
    }

    for (const entity of world.query(Position, BillboardComponent)) {
      const position = world.getComponent(entity, Position);
      const billboard = world.getComponent(entity, BillboardComponent);
      if (!position || !billboard) {
        continue;
      }

      if (!billboard.enabled) {
        billboard.visible = false;
        continue;
      }

      const center = {
        x: position.x + billboard.offset.x,
        y: position.y + billboard.offset.y,
        z: position.z + billboard.offset.z
      };
      const dx = cameraSnapshot.position.x - center.x;
      const dy = cameraSnapshot.position.y - center.y;
      const dz = cameraSnapshot.position.z - center.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      billboard.lodState = resolveBillboardLodState(distance, billboard.lodThresholds);

      if (billboard.lodState === "culled") {
        billboard.visible = false;
        continue;
      }

      billboard.visible = isSphereInsideFrustum(
        center,
        computeBillboardRadius(billboard.size),
        cameraSnapshot.frustumPlanes
      );
    }
  }
}
