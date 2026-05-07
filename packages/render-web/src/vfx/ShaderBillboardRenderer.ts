/**
 * ShaderBillboardRenderer.
 *
 * Realizes RuntimeVFXShaderBillboardSnapshot entries as 3D spheres with a
 * volumetric-feeling fragment shader: cosine palette over multi-octave
 * noise to produce swirling color clouds, soft fresnel-like edge fade,
 * slow time-driven motion. Inspired by raymarched orb references but
 * implemented as a surface shader on real geometry to compose cleanly with
 * our scene's transparent pass + depth budget.
 *
 * One material per active definition (cached). One mesh per binding,
 * parented to host position. Static parameters bake into the TSL graph as
 * literals (per ShaderRuntime.ts:803). Param edits trigger material
 * rebuild.
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cos,
  float,
  mx_noise_float,
  positionLocal,
  saturate,
  time,
  vec3
} from "three/tsl";
import type {
  ShaderBillboardDefinition,
  ShaderBillboardParams
} from "@sugarmagic/domain";
import type { RuntimeVFXShaderBillboardSnapshot } from "@sugarmagic/runtime-core";

interface MaterialEntry {
  material: MeshBasicNodeMaterial;
  cacheKey: string;
  refCount: number;
}

interface BillboardEntry {
  mesh: THREE.Mesh;
  geometry: THREE.SphereGeometry;
  cacheKey: string;
}

interface ScalarNodeLike {
  add: (other: unknown) => ScalarNodeLike;
  sub: (other: unknown) => ScalarNodeLike;
  mul: (other: unknown) => ScalarNodeLike;
  pow: (other: unknown) => ScalarNodeLike;
}

interface Vec3NodeLike {
  add: (other: unknown) => Vec3NodeLike;
  mul: (other: unknown) => Vec3NodeLike;
}

function paramsCacheKey(definitionId: string, params: ShaderBillboardParams): string {
  const c = params.coreColor;
  const h = params.haloColor;
  return [
    definitionId,
    c.r.toFixed(3),
    c.g.toFixed(3),
    c.b.toFixed(3),
    h.r.toFixed(3),
    h.g.toFixed(3),
    h.b.toFixed(3),
    params.coreRadius.toFixed(4),
    params.haloRadius.toFixed(4),
    params.pulseRate.toFixed(4),
    params.blendMode
  ].join("|");
}

export class ShaderBillboardRenderer {
  private readonly scene: THREE.Scene;
  private readonly materials = new Map<string, MaterialEntry>();
  private readonly billboards = new Map<string, BillboardEntry>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(
    snapshots: RuntimeVFXShaderBillboardSnapshot[],
    _camera: THREE.Camera | null
  ): void {
    void _camera;
    const liveKeys = new Set(snapshots.map((s) => s.bindingKey));

    for (const [bindingKey, entry] of this.billboards.entries()) {
      if (!liveKeys.has(bindingKey)) {
        this.scene.remove(entry.mesh);
        entry.geometry.dispose();
        this.releaseMaterial(entry.cacheKey);
        this.billboards.delete(bindingKey);
      }
    }

    for (const snapshot of snapshots) {
      const definition = snapshot.definition;
      const params = definition.billboard;
      const cacheKey = paramsCacheKey(definition.definitionId, params);
      let entry = this.billboards.get(snapshot.bindingKey);

      if (!entry || entry.cacheKey !== cacheKey) {
        if (entry) {
          this.scene.remove(entry.mesh);
          entry.geometry.dispose();
          this.releaseMaterial(entry.cacheKey);
        }
        const material = this.acquireMaterial(cacheKey, definition);
        const geometry = new THREE.SphereGeometry(0.5, 32, 24);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 20 + snapshot.renderOrder;
        this.scene.add(mesh);
        entry = { mesh, geometry, cacheKey };
        this.billboards.set(snapshot.bindingKey, entry);
        // eslint-disable-next-line no-console
        console.info(
          `[VFX shader-billboard] mounted ${definition.displayName} (${snapshot.bindingKey}) at`,
          snapshot.position
        );
      }

      entry.mesh.position.set(
        snapshot.position.x,
        snapshot.position.y,
        snapshot.position.z
      );
      entry.mesh.scale.set(params.size, params.size, params.size);
      entry.mesh.renderOrder = 20 + snapshot.renderOrder;
    }
  }

  dispose(): void {
    for (const entry of this.billboards.values()) {
      this.scene.remove(entry.mesh);
      entry.geometry.dispose();
    }
    this.billboards.clear();
    for (const entry of this.materials.values()) {
      entry.material.dispose();
    }
    this.materials.clear();
  }

  private acquireMaterial(
    cacheKey: string,
    definition: ShaderBillboardDefinition
  ): MeshBasicNodeMaterial {
    const cached = this.materials.get(cacheKey);
    if (cached) {
      cached.refCount += 1;
      return cached.material;
    }

    const params = definition.billboard;
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

    // Cosine palette in the IQ style: color = 0.5 + 0.5 * cos(2π * (t * freq
    // + phase)). Three independent phases (one per channel) produce shifting
    // hues. Driven by a noise-based "depth" so different parts of the sphere
    // pick different palette positions, and animated by time.
    //
    // We use the authored coreColor and haloColor as palette anchors: where
    // the noise is high we lean to coreColor, where low we lean to haloColor.
    // A pink/magenta accent is mixed in at high-frequency noise peaks for
    // the multi-color "wisp" feel from the reference orb.

    // Time scrolled through noise input — three independent rates so the
    // result doesn't feel like a single drift.
    const animX = (time as unknown as ScalarNodeLike).mul(float(0.25));
    const animY = (time as unknown as ScalarNodeLike).mul(float(0.18));
    const animZ = (time as unknown as ScalarNodeLike).mul(float(0.13));
    const animOffset = vec3(animX as never, animY as never, animZ as never);

    // Multi-octave noise of the local sphere position. Three octaves so the
    // surface shows big color regions, mid-frequency wisps, and fine
    // sparkle — surface-shader stand-in for the codepen's volumetric depth.
    const o1Input = (positionLocal as unknown as Vec3NodeLike)
      .mul(float(2.0) as never)
      .add(animOffset as never);
    const o2Input = (positionLocal as unknown as Vec3NodeLike)
      .mul(float(4.5) as never)
      .add(
        ((animOffset as unknown as Vec3NodeLike).mul(float(1.4) as never)) as never
      );
    const o3Input = (positionLocal as unknown as Vec3NodeLike)
      .mul(float(9.0) as never)
      .add(
        ((animOffset as unknown as Vec3NodeLike).mul(float(2.1) as never)) as never
      );
    const n1 = mx_noise_float(o1Input as never, 1, 0);
    const n2 = mx_noise_float(o2Input as never, 1, 0);
    const n3 = mx_noise_float(o3Input as never, 1, 0);
    const combined = (n1 as unknown as ScalarNodeLike)
      .mul(float(0.55) as never)
      .add(((n2 as unknown as ScalarNodeLike).mul(float(0.3) as never)) as never)
      .add(((n3 as unknown as ScalarNodeLike).mul(float(0.15) as never)) as never);

    // Codepen's palette: `1.0 + cos(depth + phases)`, range 0..2, NOT
    // clamped. The phases (5.8, 4.1, 2.8) are tuned to produce vibrant
    // complementary colors — magenta/cyan/yellow shifts. Drive the
    // "depth" argument with noise * a wide range so different parts of the
    // sphere sample different palette positions.
    const PHASE_R = 5.8;
    const PHASE_G = 4.1;
    const PHASE_B = 2.8;
    // Noise scaled to a wide range so the palette cycles MULTIPLE times
    // across the surface, not just half a cosine wave. This is what
    // produces the swirly multi-color wisps.
    const depthLike = (combined as unknown as ScalarNodeLike).mul(float(4.5));
    // Add slow time drift so the palette cycles even on static parts.
    const driftedDepth = (depthLike as unknown as ScalarNodeLike).add(
      ((time as unknown as ScalarNodeLike).mul(float(0.35))) as never
    );

    const palR = (cos(
      ((driftedDepth as unknown as ScalarNodeLike).add(float(PHASE_R))) as never
    ) as unknown as ScalarNodeLike).add(float(1));
    const palG = (cos(
      ((driftedDepth as unknown as ScalarNodeLike).add(float(PHASE_G))) as never
    ) as unknown as ScalarNodeLike).add(float(1));
    const palB = (cos(
      ((driftedDepth as unknown as ScalarNodeLike).add(float(PHASE_B))) as never
    ) as unknown as ScalarNodeLike).add(float(1));
    // Range 0..2; multiply by a brightness factor and let it pop. With
    // additive blending we can let values exceed 1 — the renderer will clip
    // gracefully and the bright peaks dominate against the scene.
    const paletteColor = vec3(palR as never, palG as never, palB as never);

    // Tint toward authored colors so user-set palette anchors influence
    // the hue (warm core / cool halo).
    const tintR = float(0.65 + params.coreColor.r * 0.5);
    const tintG = float(0.65 + params.coreColor.g * 0.5);
    const tintB = float(0.65 + params.haloColor.b * 0.5);
    const tintNode = vec3(tintR as never, tintG as never, tintB as never);
    const tintedPalette = (paletteColor as unknown as Vec3NodeLike).mul(
      tintNode as never
    );

    // Wisp mask: colors only appear where high-frequency noise peaks.
    // Everywhere else fades to black. This is the contrast that makes the
    // codepen orb read as wisps-on-darkness rather than uniform brightness.
    // Detail noise (n3) drives the mask; bias so most of the surface is
    // dim and only ~30-40% reads as bright.
    const wispMask = saturate(
      ((n3 as unknown as ScalarNodeLike).add(float(0.1))).mul(
        float(1.6) as never
      ) as never
    );

    // Final color: tinted palette gated by wisp mask. Multiplying by mask
    // (0..1) drives dim regions to black while bright regions retain the
    // saturated palette color.
    const finalColor = (tintedPalette as unknown as Vec3NodeLike).mul(
      wispMask as never
    );

    // Slow overall pulse for the "breathing" feel.
    const pulseRateValue = Math.max(0, params.pulseRate);
    const pulse =
      pulseRateValue > 0
        ? ((cos(
            (time as unknown as ScalarNodeLike).mul(
              float(Math.PI * 2 * pulseRateValue) as never
            ) as never
          ) as unknown as ScalarNodeLike)
            .mul(float(0.12))
            .add(float(0.88)) as never)
        : (float(1) as never);

    // Alpha: noise-modulated only, no fresnel. The sphere's silhouette is
    // the orb boundary; additive blending naturally softens it against the
    // scene. Floor of 0.55 so the orb always reads as a coherent body;
    // peaks of ~1.0 where noise is high.
    //
    // (Earlier versions tried `dot(normalView, positionViewDirection)` for
    // fresnel; that chain compiled to alpha→0 silently. Skipping it here.)
    const noiseAlpha = (combined as unknown as ScalarNodeLike)
      .add(float(1) as never)
      .mul(float(0.225) as never)
      .add(float(0.55) as never);

    const finalAlpha = (noiseAlpha as unknown as ScalarNodeLike).mul(
      pulse as never
    );

    material.colorNode = finalColor as never;
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
