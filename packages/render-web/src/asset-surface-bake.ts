/**
 * Asset surface bake (Plan 068.11 v3).
 *
 * The landscape ground-bake, generalized to one placed asset: render
 * the slot's COMPOSITED surface (the same TSL color nodes the real
 * material uses -- no second compositor) TOP-DOWN over the asset's
 * world-XZ bounds into a plain DataTexture, and let scatter blades
 * sample it by their world XZ -- the EXACT mechanism landscape grass
 * uses to inherit the floor color (instanceOrigin -> worldUv). This
 * is how grass painted on a rock inherits the rock's own compiled
 * layers (a deliberate green coat, gradients, scuffs) instead of the
 * terrain.
 *
 * WHY top-down world space (not paint-UV space): the blade already
 * carries its world XZ in `instanceOrigin`, which the shared GPU
 * scatter pipeline populates for free. Sampling by world XZ means the
 * GPU path is untouched -- no new per-instance attribute, no CPU
 * forcing (the paint-UV approach needed both and broke landscape
 * grass, 2026-07-13). Grass grows on upward-facing surfaces, which
 * are precisely the topmost surface at each XZ -- what a top-down
 * bake captures.
 *
 * Ground-bake conventions applied verbatim (see RuntimeLandscapeMesh):
 * - Blades sample a plain DataTexture, NEVER the render target.
 * - up=(0,0,-1) + top/bottom flip so texel (u,v) tracks (+x,+z).
 * - Readback rows arrive top-first; row-flip during the copy.
 * - DoubleSide bake material (projection can flip winding).
 *
 * Caveat: a top-down projection samples the TOPMOST surface at each
 * XZ, so grass under an overhang inherits the overhang's color. Fine
 * for grass-on-top-of-rock (the case); revisit if overhang foliage
 * ever matters (would need the paint-UV bake + pipeline work).
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import type { ResolvedSurfaceStack } from "@sugarmagic/runtime-core";
import type { ShaderRuntime } from "./ShaderRuntime";

export const ASSET_SURFACE_BAKE_RESOLUTION = 512;

export interface AssetSurfaceBakeMap {
  texture: THREE.DataTexture;
  /** World-XZ min corner of the baked bounds; blade uv = (worldXZ -
   *  offset) / size. */
  offset: [number, number];
  size: [number, number];
}

export interface AssetSurfaceBake {
  map: AssetSurfaceBakeMap;
  /** Run in the RenderView pre-pass (sugarmagicScatterPrepare slot).
   *  One-shot: bakes once, then no-ops. */
  prepare: (renderer: unknown) => void;
  dispose: () => void;
}

export function createAssetSurfaceBake(options: {
  meshes: THREE.Mesh[];
  surfaceStack: ResolvedSurfaceStack;
  shaderRuntime: ShaderRuntime;
  resolution?: number;
}): AssetSurfaceBake | null {
  const resolution = options.resolution ?? ASSET_SURFACE_BAKE_RESOLUTION;
  const bakeable = options.meshes.filter((mesh) =>
    Boolean(mesh.geometry.getAttribute("uv1"))
  );
  if (bakeable.length === 0) {
    // No paint UVs -> no painting set up; fall back to terrain map.
    return null;
  }

  // World-XZ bounds of the slot meshes -> bake framing + blade uv.
  const bounds = new THREE.Box3();
  for (const mesh of bakeable) {
    mesh.updateWorldMatrix(true, false);
    bounds.expandByObject(mesh);
  }
  if (!Number.isFinite(bounds.min.x) || bounds.isEmpty()) {
    return null;
  }
  // A little padding so blades at the very edge stay inside the map.
  const pad = 0.05 * Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 0.1);
  const minX = bounds.min.x - pad;
  const minZ = bounds.min.z - pad;
  const sizeX = Math.max(0.001, bounds.max.x - bounds.min.x + pad * 2);
  const sizeZ = Math.max(0.001, bounds.max.z - bounds.min.z + pad * 2);
  const centerX = minX + sizeX / 2;
  const centerZ = minZ + sizeZ / 2;

  const bakeMaterial = new MeshBasicNodeMaterial();
  bakeMaterial.side = THREE.DoubleSide;

  const nodeSet = options.shaderRuntime.evaluateLayerStackToNodeSet(
    options.surfaceStack,
    {
      geometry: bakeable[0]!.geometry,
      carrierMaterial: bakeMaterial
    }
  );
  if (!nodeSet?.colorNode) {
    bakeMaterial.dispose();
    return null;
  }
  bakeMaterial.colorNode = nodeSet.colorNode as never;

  // Bake meshes ride the source meshes' WORLD transforms (frozen) so
  // the top-down camera frames them in world XZ.
  const bakeScene = new THREE.Scene();
  for (const mesh of bakeable) {
    const bakeMesh = new THREE.Mesh(mesh.geometry, bakeMaterial);
    bakeMesh.matrixAutoUpdate = false;
    bakeMesh.matrix.copy(mesh.matrixWorld);
    bakeMesh.frustumCulled = false;
    bakeScene.add(bakeMesh);
  }

  const topY = bounds.max.y + 1;
  const depth = bounds.max.y - bounds.min.y + 2;
  // top/bottom flipped, up=(0,0,-1): matches the ground bake so texel
  // (u,v) tracks world (+x, +z).
  const bakeCamera = new THREE.OrthographicCamera(
    -sizeX / 2,
    sizeX / 2,
    -sizeZ / 2,
    sizeZ / 2,
    0.1,
    depth + 1
  );
  bakeCamera.position.set(centerX, topY, centerZ);
  bakeCamera.up.set(0, 0, -1);
  bakeCamera.lookAt(centerX, bounds.min.y, centerZ);

  const target = new THREE.RenderTarget(resolution, resolution);
  target.texture.name = "asset-surface-bake-rt";
  const dataTexture = new THREE.DataTexture(
    new Uint8Array(resolution * resolution * 4),
    resolution,
    resolution,
    THREE.RGBAFormat
  );
  dataTexture.name = "asset-surface-bake-map";
  dataTexture.minFilter = THREE.LinearFilter;
  dataTexture.magFilter = THREE.LinearFilter;
  dataTexture.wrapS = THREE.ClampToEdgeWrapping;
  dataTexture.wrapT = THREE.ClampToEdgeWrapping;
  dataTexture.needsUpdate = true;

  let baked = false;
  let readbackInFlight = false;
  let disposed = false;

  return {
    map: {
      texture: dataTexture,
      offset: [minX, minZ],
      size: [sizeX, sizeZ]
    },
    prepare(renderer: unknown) {
      if (baked || readbackInFlight || disposed) {
        return;
      }
      const gpuRenderer = renderer as WebGPURenderer;
      const previousTarget = gpuRenderer.getRenderTarget();
      gpuRenderer.setRenderTarget(target);
      gpuRenderer.render(bakeScene, bakeCamera);
      gpuRenderer.setRenderTarget(previousTarget);
      readbackInFlight = true;
      gpuRenderer
        .readRenderTargetPixelsAsync(target, 0, 0, resolution, resolution)
        .then((pixels) => {
          readbackInFlight = false;
          if (disposed) {
            return;
          }
          const source = pixels as unknown as Uint8Array;
          const data = dataTexture.image.data as Uint8Array;
          const rowBytes = resolution * 4;
          for (let row = 0; row < resolution; row += 1) {
            const sourceOffset = row * rowBytes;
            const targetOffset = (resolution - 1 - row) * rowBytes;
            data.set(
              source.subarray(sourceOffset, sourceOffset + rowBytes),
              targetOffset
            );
          }
          dataTexture.needsUpdate = true;
          baked = true;
        })
        .catch(() => {
          readbackInFlight = false;
        });
    },
    dispose() {
      disposed = true;
      bakeScene.clear();
      bakeMaterial.dispose();
      target.dispose();
      dataTexture.dispose();
    }
  };
}
