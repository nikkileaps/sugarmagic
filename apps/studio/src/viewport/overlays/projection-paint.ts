/**
 * Shared world-space projection paint core.
 *
 * The mask-paint overlay (Plan 068.4/068.11) and the Surface Brush
 * (Plan 068.9) both paint into a mask canvas by projecting a WORLD-space
 * brush onto a mesh's paint-UV footprint. A texture-space circle is wrong
 * on a fragmented paint-UV atlas (smears across islands, or shrinks to
 * nothing); instead we walk the hit mesh's triangles, keep the ones
 * within the brush's world radius, and rasterize THOSE triangles' UV
 * footprints -- each texel valued by its real world distance to the
 * brush center. One source of truth for that math lives here.
 */

import * as THREE from "three";
import { SCENE_OBJECT_MARKER_KEY } from "@sugarmagic/workspaces";

export interface ProjectionBrushSettings {
  /** Brush radius in world meters. */
  radius: number;
  /** Peak paint value 0..1. */
  strength: number;
  /** Edge falloff 0..1 (0 = hard, 1 = feathered to nothing). */
  falloff: number;
  mode: "paint" | "erase";
}

export interface SceneObjectMetadata {
  instanceId: string;
  assetDefinitionId: string | null;
  kind: string;
}

/** Walk up to the nearest SceneObject marker (instance + asset id). */
export function findSceneObjectMetadata(
  object: THREE.Object3D
): SceneObjectMetadata | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const metadata = current.userData[SCENE_OBJECT_MARKER_KEY];
    if (metadata) {
      return metadata as SceneObjectMetadata;
    }
    current = current.parent;
  }
  return null;
}

/** Brush affordance: a ring hugging the painted surface. World size is
 *  an APPROXIMATION -- it signals where, not exactly how wide. */
export function createPaintBrushRing(color = 0xf9e2af): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 40),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
  );
  ring.renderOrder = 1001;
  ring.visible = false;
  ring.name = "projection-paint-brush-ring";
  ring.raycast = () => {};
  return ring;
}

/**
 * World-space projection brush. Paints `hit`'s mesh triangles within the
 * brush's world radius into `canvas` (the mask, paint UVs, V flipped to
 * match the CPU scatter sampler). paint accumulates (add, clamp 1); erase
 * subtracts (clamp 0).
 */
export function stampWorldSpaceBrush(
  canvas: HTMLCanvasElement,
  hit: THREE.Intersection<THREE.Object3D>,
  settings: ProjectionBrushSettings
): void {
  const mesh = hit.object as THREE.Mesh;
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return;
  }
  const posAttr = geometry.getAttribute("position");
  const uvAttr = geometry.getAttribute("uv1") ?? geometry.getAttribute("uv");
  if (!posAttr || !uvAttr) {
    return;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return;
  }

  const center = hit.point;
  const radius = Math.max(0.001, settings.radius);
  const radiusSq = radius * radius;
  const edge = 1 - Math.max(0, Math.min(1, settings.falloff));
  const width = canvas.width;
  const height = canvas.height;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const matrixWorld = mesh.matrixWorld;
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : posAttr.count / 3;

  const wa = new THREE.Vector3();
  const wb = new THREE.Vector3();
  const wc = new THREE.Vector3();
  const uva = new THREE.Vector2();
  const uvb = new THREE.Vector2();
  const uvc = new THREE.Vector2();
  const triangle = new THREE.Triangle();
  const closest = new THREE.Vector3();

  for (let t = 0; t < triangleCount; t += 1) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    wa.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia)).applyMatrix4(matrixWorld);
    wb.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib)).applyMatrix4(matrixWorld);
    wc.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic)).applyMatrix4(matrixWorld);

    // Accurate near-check: closest point on the triangle to the brush.
    triangle.set(wa, wb, wc);
    triangle.closestPointToPoint(center, closest);
    if (closest.distanceToSquared(center) > radiusSq) {
      continue;
    }

    uva.set(uvAttr.getX(ia), uvAttr.getY(ia));
    uvb.set(uvAttr.getX(ib), uvAttr.getY(ib));
    uvc.set(uvAttr.getX(ic), uvAttr.getY(ic));

    const ax = uva.x * width;
    const ay = (1 - uva.y) * height;
    const bx = uvb.x * width;
    const by = (1 - uvb.y) * height;
    const cx = uvc.x * width;
    const cy = (1 - uvc.y) * height;

    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) {
      continue;
    }

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        const l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / denom;
        const l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / denom;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) {
          continue;
        }
        const wx = wa.x * l1 + wb.x * l2 + wc.x * l3;
        const wy = wa.y * l1 + wb.y * l2 + wc.y * l3;
        const wz = wa.z * l1 + wb.z * l2 + wc.z * l3;
        const dx = wx - center.x;
        const dy = wy - center.y;
        const dz = wz - center.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > radiusSq) {
          continue;
        }
        const normalized = Math.sqrt(distSq) / radius;
        const falloff =
          normalized <= edge
            ? 1
            : Math.max(0, 1 - (normalized - edge) / Math.max(1e-4, 1 - edge));
        const value = settings.strength * falloff;
        const offset = (py * width + px) * 4;
        const current = data[offset]! / 255;
        const next =
          settings.mode === "erase"
            ? Math.max(0, current - value)
            : Math.min(1, current + value);
        const byteValue = Math.round(next * 255);
        data[offset] = byteValue;
        data[offset + 1] = byteValue;
        data[offset + 2] = byteValue;
        data[offset + 3] = 255;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

export interface DiscoveredAssetSlotHit {
  instanceId: string;
  assetDefinitionId: string;
  slotName: string;
  hit: THREE.Intersection<THREE.Object3D>;
}

/**
 * Surface Brush hit discovery (Plan 068.9). Unlike the mask-paint
 * overlay -- which matches strokes against a KNOWN armed target -- the
 * Surface Brush discovers whatever asset slot the ray lands on (the
 * nearest paintable one), so it can set that slot up on first touch. A
 * mesh is paintable when it carries paint UVs, a SceneObject marker with
 * an asset id, and a named material slot for the hit face.
 */
export function discoverAssetSlotHit(
  hits: THREE.Intersection<THREE.Object3D>[]
): DiscoveredAssetSlotHit | null {
  for (const hit of hits) {
    const paintUv = hit.uv1 ?? hit.uv;
    if (!(hit.object instanceof THREE.Mesh) || !paintUv) {
      continue;
    }
    const metadata = findSceneObjectMetadata(hit.object);
    if (!metadata || !metadata.assetDefinitionId) {
      continue;
    }
    const slotMetadata = hit.object.userData.sugarmagicMaterialSlots as
      | Array<{ slotName: string; slotIndex: number } | null>
      | undefined;
    if (!slotMetadata?.length) {
      continue;
    }
    const materialIndex = hit.face?.materialIndex ?? 0;
    const slot = slotMetadata[materialIndex] ?? slotMetadata[0] ?? null;
    if (!slot) {
      continue;
    }
    return {
      instanceId: metadata.instanceId,
      assetDefinitionId: metadata.assetDefinitionId,
      slotName: slot.slotName,
      hit
    };
  }
  return null;
}
