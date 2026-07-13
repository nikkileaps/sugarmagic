/**
 * Paint UV channel tests (Plan 068.8).
 *
 * Painted masks sample TEXCOORD_1 ("uv1") -- the engine-generated or
 * authored paint channel -- never the authored uv0, which overlaps on
 * real assets (the outcrop: 6.4x coverage, one stroke = confetti).
 * The triangle sampler must interpolate the channel per sample and
 * fall back to null when the mesh has none.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { sampleMeshTrianglesForDensity } from "@sugarmagic/render-web";

function makeMesh(withPaintUv: boolean): { mesh: THREE.Mesh; root: THREE.Object3D } {
  const geometry = new THREE.PlaneGeometry(4, 4, 1, 1);
  if (withPaintUv) {
    // A paint channel deliberately DIFFERENT from uv0: shifted +0.25
    // so any sample proves which channel was read.
    const uv = geometry.getAttribute("uv");
    const paint = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i += 1) {
      paint[i * 2] = uv.getX(i) * 0.5 + 0.25;
      paint[i * 2 + 1] = uv.getY(i) * 0.5 + 0.25;
    }
    geometry.setAttribute("uv1", new THREE.BufferAttribute(paint, 2));
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Object3D();
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { mesh, root };
}

describe("paint UV channel sampling", () => {
  it("interpolates uv1 into paintUv when the mesh carries the channel", () => {
    const { mesh, root } = makeMesh(true);
    const samples = sampleMeshTrianglesForDensity({
      mesh,
      root,
      density: 4,
      materialIndex: 0
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.paintUv).not.toBeNull();
      const [pu, pv] = sample.paintUv!;
      const [u, v] = sample.uv;
      // paint = uv * 0.5 + 0.25 by construction
      expect(pu).toBeCloseTo(u * 0.5 + 0.25, 5);
      expect(pv).toBeCloseTo(v * 0.5 + 0.25, 5);
    }
  });

  it("reports paintUv null when the mesh has no paint channel", () => {
    const { mesh, root } = makeMesh(false);
    const samples = sampleMeshTrianglesForDensity({
      mesh,
      root,
      density: 4,
      materialIndex: 0
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.paintUv ?? null).toBeNull();
    }
  });
});
