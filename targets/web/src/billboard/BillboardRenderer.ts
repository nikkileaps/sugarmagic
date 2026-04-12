/**
 * targets/web/src/billboard/BillboardRenderer.ts
 *
 * Purpose: Renders sprite and impostor billboards in the web runtime using pooled instanced quads.
 *
 * Exports:
 *   - BillboardRenderer
 *
 * Relationships:
 *   - Reads billboard semantics from runtime-core.
 *   - Resolves textures exclusively through BillboardAssetRegistry.
 *
 * Status: active
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  color as tslColor,
  float,
  positionLocal,
  positionWorld,
  sin,
  texture as textureNode,
  time,
  uv,
  vec3
} from "three/tsl";
import {
  BillboardComponent,
  Position,
  type BillboardOrientation,
  type World
} from "@sugarmagic/runtime-core";
import { BillboardAssetRegistry, type ResolvedBillboardAsset, type UVRect } from "./BillboardAssetRegistry";

interface BillboardRendererOptions {
  scene: THREE.Scene;
  registry: BillboardAssetRegistry;
}

interface BillboardInstance {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  orientation: BillboardOrientation;
}

interface BillboardMeshRecord {
  mesh: THREE.InstancedMesh;
  geometry: THREE.PlaneGeometry;
  material: MeshBasicNodeMaterial;
  capacity: number;
  assetKey: string;
}

function nextCapacity(required: number): number {
  let capacity = 1;
  while (capacity < required) {
    capacity *= 2;
  }
  return capacity;
}

function applyUvRect(geometry: THREE.PlaneGeometry, rect: UVRect) {
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      [
        rect.u0, rect.v1,
        rect.u1, rect.v1,
        rect.u0, rect.v0,
        rect.u1, rect.v0
      ],
      2
    )
  );
}

function createBillboardMaterial(asset: ResolvedBillboardAsset): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const sample = textureNode(asset.texture, uv());
  material.colorNode = asset.tintColor
    ? sample.rgb.mul(tslColor(new THREE.Color(asset.tintColor)))
    : sample.rgb;
  material.opacityNode = sample.a;

  if ((asset.windSwayAmplitude ?? 0) > 0) {
    const normalizedHeight = positionLocal.y.add(float(0.5)).max(0);
    const sway = sin(
      time.mul(float(1.6)).add(positionWorld.x.mul(float(0.35))).add(positionWorld.z.mul(float(0.2)))
    )
      .mul(float(asset.windSwayAmplitude ?? 0))
      .mul(normalizedHeight);
    material.positionNode = positionLocal.add(vec3(sway, 0, 0));
  }

  return material;
}

export class BillboardRenderer {
  private readonly scene: THREE.Scene;
  private readonly registry: BillboardAssetRegistry;
  private readonly root: THREE.Group;
  private readonly meshRecords = new Map<string, BillboardMeshRecord>();
  private readonly activeAssetKeys = new Set<string>();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempScale = new THREE.Vector3();
  private readonly tempMatrix = new THREE.Matrix4();

  constructor(options: BillboardRendererOptions) {
    this.scene = options.scene;
    this.registry = options.registry;
    this.root = new THREE.Group();
    this.root.name = "runtime-billboard-root";
    this.scene.add(this.root);
  }

  update(input: { world: World; camera: THREE.Camera }): void {
    const groups = new Map<string, { asset: ResolvedBillboardAsset; instances: BillboardInstance[] }>();
    const nextAssetKeys = new Set<string>();
    this.cameraPosition.setFromMatrixPosition(input.camera.matrixWorld);

    for (const entity of input.world.query(Position, BillboardComponent)) {
      const position = input.world.getComponent(entity, Position);
      const billboard = input.world.getComponent(entity, BillboardComponent);
      if (!position || !billboard) {
        continue;
      }
      if (billboard.lodState !== "billboard" || !billboard.visible) {
        continue;
      }
      if (billboard.descriptor.kind === "text") {
        continue;
      }

      const asset = this.registry.resolve(billboard.descriptor);
      if (!asset) {
        continue;
      }

      nextAssetKeys.add(asset.assetKey);
      const groupKey = [
        asset.assetKey,
        billboard.orientation,
        asset.uv.u0,
        asset.uv.v0,
        asset.uv.u1,
        asset.uv.v1,
        asset.tintColor ?? "",
        asset.windSwayAmplitude ?? 0
      ].join("|");

      const group = groups.get(groupKey) ?? { asset, instances: [] };
      group.instances.push({
        x: position.x + billboard.offset.x,
        y: position.y + billboard.offset.y,
        z: position.z + billboard.offset.z,
        width: billboard.size.width,
        height: billboard.size.height,
        orientation: billboard.orientation
      });
      groups.set(groupKey, group);
    }

    for (const assetKey of this.activeAssetKeys) {
      if (!nextAssetKeys.has(assetKey)) {
        this.registry.release(assetKey);
      }
    }
    for (const assetKey of nextAssetKeys) {
      if (!this.activeAssetKeys.has(assetKey)) {
        this.registry.acquire(assetKey);
      }
    }
    this.activeAssetKeys.clear();
    for (const assetKey of nextAssetKeys) {
      this.activeAssetKeys.add(assetKey);
    }

    for (const [groupKey, record] of this.meshRecords) {
      if (!groups.has(groupKey)) {
        record.mesh.visible = false;
        record.mesh.count = 0;
      }
    }

    for (const [groupKey, group] of groups) {
      const record = this.ensureMeshRecord(groupKey, group.asset, group.instances.length);
      this.populateInstances(record.mesh, group.instances, input.camera);
      record.mesh.visible = group.instances.length > 0;
      record.mesh.count = group.instances.length;
      record.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const assetKey of this.activeAssetKeys) {
      this.registry.release(assetKey);
    }
    this.activeAssetKeys.clear();

    for (const record of this.meshRecords.values()) {
      this.root.remove(record.mesh);
      record.mesh.dispose();
      record.geometry.dispose();
      record.material.dispose();
    }
    this.meshRecords.clear();
    this.scene.remove(this.root);
  }

  private ensureMeshRecord(
    groupKey: string,
    asset: ResolvedBillboardAsset,
    requiredCount: number
  ): BillboardMeshRecord {
    const existing = this.meshRecords.get(groupKey) ?? null;
    if (existing && existing.capacity >= requiredCount) {
      return existing;
    }

    if (existing) {
      this.root.remove(existing.mesh);
      existing.mesh.dispose();
      existing.geometry.dispose();
      existing.material.dispose();
      this.meshRecords.delete(groupKey);
    }

    const capacity = nextCapacity(Math.max(1, requiredCount));
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    applyUvRect(geometry, asset.uv);
    const material = createBillboardMaterial(asset);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `runtime-billboard-group:${groupKey}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.root.add(mesh);

    const record: BillboardMeshRecord = {
      mesh,
      geometry,
      material,
      capacity,
      assetKey: asset.assetKey
    };
    this.meshRecords.set(groupKey, record);
    return record;
  }

  private populateInstances(
    mesh: THREE.InstancedMesh,
    instances: BillboardInstance[],
    camera: THREE.Camera
  ) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index]!;
      this.tempQuaternion.copy(this.resolveOrientationQuaternion(instance, camera));
      this.tempScale.set(instance.width, instance.height, 1);
      this.tempMatrix.compose(
        new THREE.Vector3(instance.x, instance.y, instance.z),
        this.tempQuaternion,
        this.tempScale
      );
      mesh.setMatrixAt(index, this.tempMatrix);
    }
  }

  private resolveOrientationQuaternion(
    instance: BillboardInstance,
    camera: THREE.Camera
  ): THREE.Quaternion {
    if (instance.orientation === "spherical") {
      return camera.quaternion;
    }

    if (instance.orientation === "fixed") {
      this.tempQuaternion.identity();
      return this.tempQuaternion;
    }

    const dx = this.cameraPosition.x - instance.x;
    const dz = this.cameraPosition.z - instance.z;
    const yaw = Math.atan2(dx, dz);
    this.tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return this.tempQuaternion;
  }
}
