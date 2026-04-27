/**
 * Surface preview samplers.
 *
 * Preview-only CPU samplers for the Surface Library preview geometry. These
 * turn Stage 1 scatter density into concrete sample points for plane, cube,
 * and sphere preview primitives. They are intentionally editor-local and do
 * not replace the shared landscape scatter sampler in render-web.
 */

import * as THREE from "three";
import type { SurfaceScatterSample } from "@sugarmagic/render-web";

export type SurfacePreviewGeometryKind = "plane" | "cube" | "sphere";

export interface SurfacePreviewGeometrySpec {
  mesh: THREE.Mesh;
  scatterSamplesForDensity: (densityPerSquareMeter: number) => SurfaceScatterSample[];
}

function hash01(seed: number): number {
  const x = Math.sin(seed * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function createPlaneSpec(): SurfacePreviewGeometrySpec {
  const size = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.001;
  mesh.receiveShadow = true;

  return {
    mesh,
    scatterSamplesForDensity(densityPerSquareMeter) {
      if (!Number.isFinite(densityPerSquareMeter) || densityPerSquareMeter <= 0) {
        return [];
      }
      const spacing = 1 / Math.sqrt(densityPerSquareMeter);
      const steps = Math.max(1, Math.round(size / Math.max(spacing, 0.01)));
      const cellSize = size / steps;
      const samples: SurfaceScatterSample[] = [];
      for (let zIndex = 0; zIndex < steps; zIndex += 1) {
        for (let xIndex = 0; xIndex < steps; xIndex += 1) {
          const jitterX =
            (hash01((xIndex + 1) * 97.13 + (zIndex + 1) * 13.71) - 0.5) *
            cellSize *
            0.8;
          const jitterZ =
            (hash01((xIndex + 1) * 43.17 + (zIndex + 1) * 59.91) - 0.5) *
            cellSize *
            0.8;
          const x = -size / 2 + (xIndex + 0.5) * cellSize + jitterX;
          const z = -size / 2 + (zIndex + 0.5) * cellSize + jitterZ;
          const u = Math.max(0, Math.min(1, x / size + 0.5));
          const v = Math.max(0, Math.min(1, z / size + 0.5));
          samples.push({
            position: [x, 0.001, z],
            normal: [0, 1, 0],
            uv: [u, v],
            height: 0.001,
            splatmapWeights: [1, 1, 1, 1]
          });
        }
      }
      return samples;
    }
  };
}

function buildFaceSamples(
  densityPerSquareMeter: number,
  size: number,
  transform: THREE.Matrix4,
  normal: THREE.Vector3,
  seedOffset: number
): SurfaceScatterSample[] {
  if (!Number.isFinite(densityPerSquareMeter) || densityPerSquareMeter <= 0) {
    return [];
  }

  const spacing = 1 / Math.sqrt(densityPerSquareMeter);
  const steps = Math.max(1, Math.round(size / Math.max(spacing, 0.01)));
  const cellSize = size / steps;
  const samples: SurfaceScatterSample[] = [];
  const point = new THREE.Vector3();
  const transformedPoint = new THREE.Vector3();
  const transformedNormal = normal.clone().transformDirection(transform).normalize();

  for (let yIndex = 0; yIndex < steps; yIndex += 1) {
    for (let xIndex = 0; xIndex < steps; xIndex += 1) {
      const jitterX =
        (hash01((xIndex + 1) * 97.13 + (yIndex + 1) * 13.71 + seedOffset) - 0.5) *
        cellSize *
        0.8;
      const jitterY =
        (hash01((xIndex + 1) * 43.17 + (yIndex + 1) * 59.91 + seedOffset) - 0.5) *
        cellSize *
        0.8;
      const localX = -size / 2 + (xIndex + 0.5) * cellSize + jitterX;
      const localY = -size / 2 + (yIndex + 0.5) * cellSize + jitterY;
      point.set(localX, localY, 0);
      transformedPoint.copy(point).applyMatrix4(transform);
      samples.push({
        position: [transformedPoint.x, transformedPoint.y, transformedPoint.z],
        normal: [transformedNormal.x, transformedNormal.y, transformedNormal.z],
        uv: [Math.max(0, Math.min(1, localX / size + 0.5)), Math.max(0, Math.min(1, localY / size + 0.5))],
        height: transformedPoint.y,
        splatmapWeights: [1, 1, 1, 1]
      });
    }
  }

  return samples;
}

function createCubeSpec(): SurfacePreviewGeometrySpec {
  const size = 3;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  mesh.receiveShadow = true;
  const half = size / 2;

  const faceTransforms = [
    new THREE.Matrix4().makeTranslation(0, 0, half),
    new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeTranslation(0, 0, half)),
    new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0, 0, half)),
    new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0, 0, half)),
    new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0, 0, half)),
    new THREE.Matrix4().makeRotationX(Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0, 0, half))
  ];

  return {
    mesh,
    scatterSamplesForDensity(densityPerSquareMeter) {
      return faceTransforms.flatMap((transform, index) =>
        buildFaceSamples(
          densityPerSquareMeter,
          size,
          transform,
          new THREE.Vector3(0, 0, 1),
          index * 1000
        )
      );
    }
  };
}

function createSphereSpec(): SurfacePreviewGeometrySpec {
  const radius = 1.75;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32));
  mesh.receiveShadow = true;

  return {
    mesh,
    scatterSamplesForDensity(densityPerSquareMeter) {
      if (!Number.isFinite(densityPerSquareMeter) || densityPerSquareMeter <= 0) {
        return [];
      }
      const surfaceArea = 4 * Math.PI * radius * radius;
      const sampleCount = Math.max(1, Math.round(surfaceArea * densityPerSquareMeter));
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const samples: SurfaceScatterSample[] = [];

      for (let index = 0; index < sampleCount; index += 1) {
        const y = 1 - (2 * (index + 0.5)) / sampleCount;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = index * goldenAngle;
        const x = Math.cos(theta) * radiusAtY;
        const z = Math.sin(theta) * radiusAtY;
        const normal = new THREE.Vector3(x, y, z).normalize();
        const position = normal.clone().multiplyScalar(radius);
        const u = 0.5 + Math.atan2(normal.z, normal.x) / (2 * Math.PI);
        const v = 0.5 - Math.asin(normal.y) / Math.PI;
        samples.push({
          position: [position.x, position.y, position.z],
          normal: [normal.x, normal.y, normal.z],
          uv: [u, v],
          height: position.y,
          splatmapWeights: [1, 1, 1, 1]
        });
      }

      return samples;
    }
  };
}

export function createSurfacePreviewGeometry(
  kind: SurfacePreviewGeometryKind
): SurfacePreviewGeometrySpec {
  switch (kind) {
    case "cube":
      return createCubeSpec();
    case "sphere":
      return createSphereSpec();
    case "plane":
    default:
      return createPlaneSpec();
  }
}
