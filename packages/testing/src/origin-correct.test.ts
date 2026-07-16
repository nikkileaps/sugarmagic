/**
 * Asset origin correction (#358).
 *
 * A GLB whose Blender object sat off world-origin bakes that offset into
 * the node transform, so the placement gizmo lands off the mesh. The
 * correction re-pivots to bottom-center (XZ-centered, lowest point at
 * y=0). Verifies the re-pivot, idempotency, multi-mesh handling, and the
 * already-centered no-op -- using a real GLTFExporter -> GLTFLoader round
 * trip so it exercises the actual node-transform baking.
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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { correctAssetOriginToBottomCenter } from "@sugarmagic/studio";

/** Export a scene of unit boxes at the given world positions to a GLB.
 *  Each box's node carries a translation (the baked-offset the
 *  correction must neutralize). */
async function makeBoxesGlb(
  positions: Array<[number, number, number]>
): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  positions.forEach((pos, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: `box-${i}` })
    );
    mesh.name = `box-${i}`;
    mesh.position.set(pos[0], pos[1], pos[2]);
    scene.add(mesh);
  });
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

/** World-space bounds of every mesh in a GLB, as the studio would see it
 *  after dropping the scene root on the placement point (0,0,0). */
async function loadWorldBounds(glb: ArrayBuffer): Promise<THREE.Box3> {
  const gltf = await new GLTFLoader().parseAsync(glb, "");
  gltf.scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(gltf.scene);
}

/** A GLB with no mesh geometry (only a light) -- the degenerate input. */
async function makeLightsOnlyGlb(): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const light = new THREE.PointLight(0xffffff, 1);
  light.position.set(1, 2, 3);
  scene.add(light);
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

/** A GLB carrying an animation clip (a moving box). */
async function makeAnimatedGlb(): Promise<ArrayBuffer> {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = "anim-box";
  const scene = new THREE.Scene();
  scene.add(mesh);
  const track = new THREE.VectorKeyframeTrack(
    "anim-box.position",
    [0, 1],
    [0, 0, 0, 1, 0, 0]
  );
  const clip = new THREE.AnimationClip("move", 1, [track]);
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, {
    binary: true,
    animations: [clip]
  })) as ArrayBuffer;
}

describe("correctAssetOriginToBottomCenter", () => {
  it("re-pivots an off-origin asset to bottom-center", async () => {
    // Unit box centered at world (5, 2, -3): bounds y in [1.5, 2.5].
    const source = await makeBoxesGlb([[5, 2, -3]]);
    const result = await correctAssetOriginToBottomCenter(source);

    expect(result.changed).toBe(true);
    // Offset moves XZ-center to origin and the box's floor (y=1.5) to 0.
    expect(result.offset[0]).toBeCloseTo(-5, 3);
    expect(result.offset[1]).toBeCloseTo(-1.5, 3);
    expect(result.offset[2]).toBeCloseTo(3, 3);

    const box = await loadWorldBounds(result.glb);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 3);
    expect(center.z).toBeCloseTo(0, 3);
    expect(box.min.y).toBeCloseTo(0, 3); // sits on the ground
  });

  it("is idempotent: a corrected asset reports no further change", async () => {
    const source = await makeBoxesGlb([[5, 2, -3]]);
    const once = await correctAssetOriginToBottomCenter(source);
    const twice = await correctAssetOriginToBottomCenter(once.glb);

    expect(twice.changed).toBe(false);
    expect(twice.offset[0]).toBeCloseTo(0, 3);
    expect(twice.offset[1]).toBeCloseTo(0, 3);
    expect(twice.offset[2]).toBeCloseTo(0, 3);
  });

  it("treats an already bottom-centered asset as a no-op, returning the input unchanged", async () => {
    // Unit box whose floor is already at y=0 and centered on XZ.
    const source = await makeBoxesGlb([[0, 0.5, 0]]);
    const result = await correctAssetOriginToBottomCenter(source);
    expect(result.changed).toBe(false);
    // Contract: the no-op path returns the input buffer, not a re-emit.
    expect(result.glb).toBe(source);
  });

  it("throws on an asset with no measurable geometry", async () => {
    const glb = await makeLightsOnlyGlb();
    await expect(correctAssetOriginToBottomCenter(glb)).rejects.toThrow(
      /no measurable geometry/
    );
  });

  it("refuses an animated asset rather than silently stripping its clips", async () => {
    const glb = await makeAnimatedGlb();
    await expect(correctAssetOriginToBottomCenter(glb)).rejects.toThrow(
      /animation clip/
    );
  });

  it("re-pivots a multi-mesh asset as a single unit", async () => {
    // Two boxes: combined XZ span x[3.5, 8.5] (center 6), z[-3.5,-2.5]
    // (center -3); combined floor y=1.5.
    const source = await makeBoxesGlb([
      [4, 2, -3],
      [8, 2, -3]
    ]);
    const result = await correctAssetOriginToBottomCenter(source);

    expect(result.changed).toBe(true);
    expect(result.offset[0]).toBeCloseTo(-6, 3);
    expect(result.offset[1]).toBeCloseTo(-1.5, 3);
    expect(result.offset[2]).toBeCloseTo(3, 3);

    const box = await loadWorldBounds(result.glb);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 3);
    expect(center.z).toBeCloseTo(0, 3);
    expect(box.min.y).toBeCloseTo(0, 3);
    // Both boxes preserved: combined width still 5 (x span 3.5..8.5).
    expect(box.max.x - box.min.x).toBeCloseTo(5, 3);
  });
});
