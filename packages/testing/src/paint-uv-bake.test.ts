/**
 * Paint UV bake glue tests (Plan 068.8).
 *
 * Exercises the GLB -> unwrap -> re-emit pipeline with an injected
 * stub unwrapper (the real xatlas worker cannot run under node): the
 * baked GLB must carry TEXCOORD_1, preserve authored UVs, and leave
 * meshes that already have a paint channel untouched.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

// GLTFExporter drives FileReader; node has Blob but no FileReader.
// Minimal shim covering the readAsArrayBuffer/onloadend contract the
// exporter uses.
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
import { bakePaintUvsIntoGlb } from "@sugarmagic/studio";

/** Stub "unwrap": paint channel = authored uv shifted, same layout
 *  (a real unwrap may split vertices; the glue must not care). */
async function stubUnwrap(geometry: THREE.BufferGeometry): Promise<void> {
  const uv = geometry.getAttribute("uv");
  const painted = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i += 1) {
    painted[i * 2] = uv.getX(i) * 0.5;
    painted[i * 2 + 1] = uv.getY(i) * 0.5;
  }
  geometry.setAttribute("uv1", new THREE.BufferAttribute(painted, 2));
}

async function makeGlb(withPaintUvs: boolean): Promise<ArrayBuffer> {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  if (withPaintUvs) {
    await stubUnwrap(geometry);
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ name: "stone" })
  );
  mesh.name = "test-mesh";
  const scene = new THREE.Scene();
  scene.add(mesh);
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

async function loadFirstGeometry(glb: ArrayBuffer): Promise<THREE.BufferGeometry> {
  const gltf = await new GLTFLoader().parseAsync(glb, "");
  let geometry: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((child) => {
    if (!geometry && child instanceof THREE.Mesh) {
      geometry = child.geometry as THREE.BufferGeometry;
    }
  });
  expect(geometry).not.toBeNull();
  return geometry!;
}

describe("paint UV bake", () => {
  it("bakes TEXCOORD_1 into a GLB whose meshes have none, preserving authored UVs", async () => {
    const source = await makeGlb(false);
    const result = await bakePaintUvsIntoGlb(source, {}, stubUnwrap);

    expect(result.unwrappedMeshCount).toBe(1);
    expect(result.skippedExistingCount).toBe(0);

    const geometry = await loadFirstGeometry(result.glb);
    const uv = geometry.getAttribute("uv");
    const paint = geometry.getAttribute("uv1");
    expect(uv).toBeTruthy();
    expect(paint).toBeTruthy();
    // Paint channel = authored * 0.5 by stub construction.
    expect(paint.getX(0)).toBeCloseTo(uv.getX(0) * 0.5, 5);
  });

  it("strips the normalized flag from float attributes (WebGPU has no normalized float formats)", async () => {
    const source = await makeGlb(false);
    // Reproduce the xatlas wrapper's bug: rebuilt normals flagged
    // normalized. The bake must sanitize or WebGPU's
    // createRenderPipeline dies on format: undefined.
    const result = await bakePaintUvsIntoGlb(source, {}, async (geometry) => {
      await stubUnwrap(geometry);
      geometry.getAttribute("normal").normalized = true;
    });

    const geometry = await loadFirstGeometry(result.glb);
    expect(geometry.getAttribute("normal").normalized).toBe(false);
    expect(geometry.getAttribute("uv1")).toBeTruthy();
  });

  it("leaves meshes that already carry a paint channel alone (bring-your-own wins)", async () => {
    const source = await makeGlb(true);
    const result = await bakePaintUvsIntoGlb(source, {}, async () => {
      throw new Error("must not unwrap a mesh that already has paint UVs");
    });

    expect(result.unwrappedMeshCount).toBe(0);
    expect(result.skippedExistingCount).toBe(1);
    const geometry = await loadFirstGeometry(result.glb);
    expect(geometry.getAttribute("uv1")).toBeTruthy();
  });
});
