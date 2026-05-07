/**
 * RibbonStreamerRenderer.
 *
 * Realizes RuntimeVFXRibbonStreamerSnapshot entries as N thin planes
 * radiating from the host position, oriented around the vertical axis at
 * angle (i/count)*2π + elapsedTime*orbitSpeed. Width and length come from
 * params; alpha tapers from full at the root to zero at the tip via TSL.
 *
 * Static parameters bake into the TSL graph as literals (see
 * ShaderRuntime.ts:803 — TSL uniform() doesn't reliably propagate scalar
 * updates here). Param edits trigger material rebuild.
 *
 * v1 is CPU-driven for the per-frame rotation update (~4-8 streamers per
 * binding; cheap). A future optimization could push the orbit math into
 * TSL, but the current scale doesn't need it.
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { float, smoothstep, sub, uv, vec3 } from "three/tsl";
import type {
  RibbonStreamerDefinition,
  RibbonStreamerParams
} from "@sugarmagic/domain";
import type { RuntimeVFXRibbonStreamerSnapshot } from "@sugarmagic/runtime-core";

interface MaterialEntry {
  material: MeshBasicNodeMaterial;
  cacheKey: string;
  refCount: number;
}

interface StreamerEntry {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  geometry: THREE.PlaneGeometry;
  cacheKey: string;
  count: number;
  length: number;
  width: number;
  verticalDrift: number;
  orbitSpeed: number;
  easeShape: "linear" | "ease-out";
}

interface ScalarNodeLike {
  add: (other: unknown) => ScalarNodeLike;
  sub: (other: unknown) => ScalarNodeLike;
  mul: (other: unknown) => ScalarNodeLike;
}

interface Vec2NodeLike {
  x: unknown;
  y: unknown;
}

function paramsCacheKey(definitionId: string, params: RibbonStreamerParams): string {
  const c = params.color;
  return [
    definitionId,
    c.r.toFixed(3),
    c.g.toFixed(3),
    c.b.toFixed(3),
    c.a.toFixed(3),
    params.easeShape,
    params.blendMode
  ].join("|");
}

export class RibbonStreamerRenderer {
  private readonly scene: THREE.Scene;
  private readonly materials = new Map<string, MaterialEntry>();
  private readonly streamers = new Map<string, StreamerEntry>();
  private readonly startedAt = performance.now();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(
    snapshots: RuntimeVFXRibbonStreamerSnapshot[],
    _camera: THREE.Camera | null
  ): void {
    void _camera; // streamers don't need camera; signature matches the registry contract
    const liveKeys = new Set(snapshots.map((s) => s.bindingKey));

    for (const [bindingKey, entry] of this.streamers.entries()) {
      if (!liveKeys.has(bindingKey)) {
        this.scene.remove(entry.group);
        entry.geometry.dispose();
        this.releaseMaterial(entry.cacheKey);
        this.streamers.delete(bindingKey);
      }
    }

    const elapsedSeconds = (performance.now() - this.startedAt) / 1000;

    for (const snapshot of snapshots) {
      const definition = snapshot.definition;
      const params = definition.streamer;
      const cacheKey = paramsCacheKey(definition.definitionId, params);
      const existing = this.streamers.get(snapshot.bindingKey);
      const needsRebuild =
        !existing ||
        existing.cacheKey !== cacheKey ||
        existing.count !== params.count ||
        existing.length !== params.length ||
        existing.width !== params.width;

      let entry: StreamerEntry;
      if (needsRebuild) {
        if (existing) {
          this.scene.remove(existing.group);
          existing.geometry.dispose();
          this.releaseMaterial(existing.cacheKey);
        }
        const material = this.acquireMaterial(cacheKey, definition);
        // PlaneGeometry: width=streamer width (X), height=streamer length
        // (Y). Translate so root edge sits at local origin and tip at
        // (0, length, 0).
        const geometry = new THREE.PlaneGeometry(params.width, params.length);
        geometry.translate(0, params.length / 2, 0);

        const group = new THREE.Group();
        const meshes: THREE.Mesh[] = [];
        for (let i = 0; i < params.count; i += 1) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false;
          mesh.renderOrder = 20 + snapshot.renderOrder;
          group.add(mesh);
          meshes.push(mesh);
        }
        this.scene.add(group);
        entry = {
          group,
          meshes,
          geometry,
          cacheKey,
          count: params.count,
          length: params.length,
          width: params.width,
          verticalDrift: params.verticalDrift,
          orbitSpeed: params.orbitSpeed,
          easeShape: params.easeShape
        };
        this.streamers.set(snapshot.bindingKey, entry);
        // eslint-disable-next-line no-console
        console.info(
          `[VFX ribbon-streamer] mounted ${definition.displayName} (${snapshot.bindingKey}) — ${params.count} streamers at`,
          snapshot.position
        );
      } else {
        existing.verticalDrift = params.verticalDrift;
        existing.orbitSpeed = params.orbitSpeed;
        entry = existing;
      }

      entry.group.position.set(
        snapshot.position.x,
        snapshot.position.y,
        snapshot.position.z
      );

      const orbitAngle = elapsedSeconds * entry.orbitSpeed;
      for (let i = 0; i < entry.meshes.length; i += 1) {
        const mesh = entry.meshes[i]!;
        const angle = orbitAngle + (i / entry.meshes.length) * Math.PI * 2;
        // Orient: rotate around Y so the streamer extends outward in XZ at
        // angle. Tilt by verticalDrift so the tip drifts upward.
        mesh.rotation.set(
          0,
          angle,
          (entry.verticalDrift / Math.max(0.01, entry.length)) * 0.5
        );
        mesh.renderOrder = 20 + snapshot.renderOrder;
      }
    }
  }

  dispose(): void {
    for (const entry of this.streamers.values()) {
      this.scene.remove(entry.group);
      entry.geometry.dispose();
    }
    this.streamers.clear();
    for (const entry of this.materials.values()) {
      entry.material.dispose();
    }
    this.materials.clear();
  }

  private acquireMaterial(
    cacheKey: string,
    definition: RibbonStreamerDefinition
  ): MeshBasicNodeMaterial {
    const cached = this.materials.get(cacheKey);
    if (cached) {
      cached.refCount += 1;
      return cached.material;
    }

    const params = definition.streamer;
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending:
        params.blendMode === "additive"
          ? THREE.AdditiveBlending
          : THREE.NormalBlending
    });

    // UV.y goes 0 (root) → 1 (tip). Alpha tapers from 1 to 0 along that axis.
    // Edge taper across UV.x makes the ribbon softer-edged.
    const u = uv() as unknown as Vec2NodeLike;
    const tipDist = u.y as unknown as ScalarNodeLike;
    const lengthAlpha = (sub(float(1), tipDist as never) as unknown as ScalarNodeLike);
    const easedLengthAlpha =
      params.easeShape === "ease-out"
        ? (lengthAlpha as unknown as ScalarNodeLike).mul(lengthAlpha as never)
        : lengthAlpha;

    // |u.x - 0.5| → 0 at center, 0.5 at edges. Smoothstep gives soft edge.
    const halfMinusU = sub(float(0.5), u.x as never) as unknown as ScalarNodeLike;
    const edgeDist = halfMinusU.mul(halfMinusU as never);
    const widthAlpha = smoothstep(0.25, 0.0, edgeDist as never);

    const finalAlpha = (easedLengthAlpha as unknown as ScalarNodeLike).mul(
      widthAlpha as never
    );

    material.colorNode = vec3(params.color.r, params.color.g, params.color.b) as never;
    material.opacityNode = finalAlpha as never;

    this.materials.set(cacheKey, {
      material,
      cacheKey,
      refCount: 1
    });
    return material;
  }

  private releaseMaterial(cacheKey: string): void {
    const entry = this.materials.get(cacheKey);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.material.dispose();
      this.materials.delete(cacheKey);
    }
  }
}
