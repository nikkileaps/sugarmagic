/**
 * Asset collider bounds bake (Plan 069.1).
 *
 * computeAssetColliderBounds measures a GLB's local AABB (Box3). Verifies
 * a known box's bounds, the empty-geometry null, and that origin
 * correction moves the bounds (the "rebake after a GLB rewrite" case the
 * studio handler performs).
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

// GLTFExporter drives FileReader; node has Blob but no FileReader.
if (typeof globalThis.FileReader === "undefined") {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then(
        (buffer) => {
          this.result = buffer;
          this.onload?.();
          this.onloadend?.();
        },
        (error) => this.onerror?.(error)
      );
    }
    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then(
        (buffer) => {
          this.result = `data:application/octet-stream;base64,${Buffer.from(
            buffer
          ).toString("base64")}`;
          this.onload?.();
          this.onloadend?.();
        },
        (error) => this.onerror?.(error)
      );
    }
  }
  (globalThis as Record<string, unknown>).FileReader = NodeFileReader;
}
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import {
  computeAssetColliderBounds,
  correctAssetOriginToBottomCenter
} from "@sugarmagic/studio";

/** A GLB with a single unit box centered at `position`. */
async function makeBoxGlb(
  position: [number, number, number] = [0, 0, 0]
): Promise<ArrayBuffer> {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = "box";
  mesh.position.set(...position);
  const scene = new THREE.Scene();
  scene.add(mesh);
  return (await new GLTFExporter().parseAsync(scene, {
    binary: true
  })) as ArrayBuffer;
}

describe("computeAssetColliderBounds", () => {
  it("measures a unit box's local AABB", async () => {
    const bounds = await computeAssetColliderBounds(await makeBoxGlb());
    expect(bounds).not.toBeNull();
    expect(bounds!.min[0]).toBeCloseTo(-0.5, 4);
    expect(bounds!.min[1]).toBeCloseTo(-0.5, 4);
    expect(bounds!.max[0]).toBeCloseTo(0.5, 4);
    expect(bounds!.max[2]).toBeCloseTo(0.5, 4);
  });

  it("returns null for a GLB with no measurable geometry", async () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.PointLight(0xffffff, 1));
    const glb = (await new GLTFExporter().parseAsync(scene, {
      binary: true
    })) as ArrayBuffer;
    expect(await computeAssetColliderBounds(glb)).toBeNull();
  });

  it("bounds follow the geometry after an origin correction (rebake case)", async () => {
    // Box centered at world (5, 2, -3): its bounds are off-origin.
    const source = await makeBoxGlb([5, 2, -3]);
    const before = await computeAssetColliderBounds(source);
    expect(before!.min[0]).toBeCloseTo(4.5, 3); // off to the side

    const corrected = await correctAssetOriginToBottomCenter(source);
    expect(corrected.changed).toBe(true);
    const after = await computeAssetColliderBounds(corrected.glb);

    // Re-pivoted to bottom-center: XZ-centered, floor at y=0.
    expect((after!.min[0] + after!.max[0]) / 2).toBeCloseTo(0, 3);
    expect((after!.min[2] + after!.max[2]) / 2).toBeCloseTo(0, 3);
    expect(after!.min[1]).toBeCloseTo(0, 3);
  });
});
