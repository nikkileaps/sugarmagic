/**
 * Mesh triangle sampler.
 *
 * Shared CPU helper for Stage 2 asset-slot scatter. It samples triangle
 * surfaces in the renderable's local space so asset-slot scatter can reuse the
 * same instanced-scatter builder as landscape and preview surfaces.
 */

import * as THREE from "three";
import type { SurfaceScatterSample } from "./scatter";

interface TriangleRecord {
  aIndex: number;
  bIndex: number;
  cIndex: number;
  area: number;
}

function readVertexColor(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number
): [number, number, number, number] | null {
  if (!attribute) {
    return null;
  }
  if (attribute.itemSize >= 4) {
    return [
      attribute.getX(index),
      attribute.getY(index),
      attribute.getZ(index),
      attribute.getW(index)
    ];
  }
  if (attribute.itemSize >= 3) {
    return [
      attribute.getX(index),
      attribute.getY(index),
      attribute.getZ(index),
      1
    ];
  }
  return null;
}

function readUv(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  target: THREE.Vector2
): THREE.Vector2 {
  target.set(attribute.getX(index), attribute.getY(index));
  return target;
}

export function sampleMeshTrianglesForDensity(options: {
  mesh: THREE.Mesh;
  root: THREE.Object3D;
  density: number;
  materialIndex: number | null;
}): SurfaceScatterSample[] {
  const { mesh, root, density, materialIndex } = options;
  if (!(mesh.geometry instanceof THREE.BufferGeometry) || density <= 0) {
    return [];
  }

  mesh.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);

  const geometry = mesh.geometry;
  const positionAttribute = geometry.getAttribute("position");
  const normalAttribute = geometry.getAttribute("normal");
  const uvAttribute = geometry.getAttribute("uv");
  const colorAttribute = geometry.getAttribute("color");
  if (!positionAttribute || !normalAttribute || !uvAttribute) {
    return [];
  }

  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(
    rootInverse,
    mesh.matrixWorld
  );
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(localMatrix);
  const worldMatrix = mesh.matrixWorld.clone();

  const indexed = geometry.index;
  const records: TriangleRecord[] = [];
  const positionA = new THREE.Vector3();
  const positionB = new THREE.Vector3();
  const positionC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  let totalArea = 0;

  const pushTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
    positionA.fromBufferAttribute(positionAttribute, aIndex);
    positionB.fromBufferAttribute(positionAttribute, bIndex);
    positionC.fromBufferAttribute(positionAttribute, cIndex);
    const area =
      edgeAB
        .subVectors(positionB, positionA)
        .cross(edgeAC.subVectors(positionC, positionA))
        .length() * 0.5;
    if (area <= 0) {
      return;
    }
    totalArea += area;
    records.push({
      aIndex,
      bIndex,
      cIndex,
      area
    });
  };

  if (materialIndex !== null && geometry.groups.length > 0) {
    for (const group of geometry.groups) {
      if (group.materialIndex !== materialIndex) {
        continue;
      }
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const aIndex = indexed ? indexed.getX(offset) : offset;
        const bIndex = indexed ? indexed.getX(offset + 1) : offset + 1;
        const cIndex = indexed ? indexed.getX(offset + 2) : offset + 2;
        pushTriangle(aIndex, bIndex, cIndex);
      }
    }
  } else {
    const triangleCount = indexed
      ? indexed.count / 3
      : positionAttribute.count / 3;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const base = triangleIndex * 3;
      const aIndex = indexed ? indexed.getX(base) : base;
      const bIndex = indexed ? indexed.getX(base + 1) : base + 1;
      const cIndex = indexed ? indexed.getX(base + 2) : base + 2;
      pushTriangle(aIndex, bIndex, cIndex);
    }
  }

  if (records.length === 0 || totalArea <= 0) {
    return [];
  }

  const sampleCount = Math.max(1, Math.round(totalArea * density));
  const cumulativeAreas: number[] = [];
  let runningArea = 0;
  for (const record of records) {
    runningArea += record.area;
    cumulativeAreas.push(runningArea);
  }

  const localPosition = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  const localNormal = new THREE.Vector3();
  const uvA = new THREE.Vector2();
  const uvB = new THREE.Vector2();
  const uvC = new THREE.Vector2();
  const normalA = new THREE.Vector3();
  const normalB = new THREE.Vector3();
  const normalC = new THREE.Vector3();
  const sampleUv = new THREE.Vector2();
  const transformedPosition = new THREE.Vector3();
  const transformedNormal = new THREE.Vector3();
  const colorA = new THREE.Vector4();
  const colorB = new THREE.Vector4();
  const colorC = new THREE.Vector4();
  const sampleColor = new THREE.Vector4();
  const samples: SurfaceScatterSample[] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const areaPick = Math.random() * totalArea;
    let recordIndex = cumulativeAreas.findIndex((value) => value >= areaPick);
    if (recordIndex < 0) {
      recordIndex = cumulativeAreas.length - 1;
    }
    const record = records[recordIndex]!;
    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);
    const baryA = 1 - sqrtR1;
    const baryB = r2 * sqrtR1;
    const baryC = 1 - baryA - baryB;

    positionA.fromBufferAttribute(positionAttribute, record.aIndex);
    positionB.fromBufferAttribute(positionAttribute, record.bIndex);
    positionC.fromBufferAttribute(positionAttribute, record.cIndex);
    localPosition
      .copy(positionA)
      .multiplyScalar(baryA)
      .add(positionB.clone().multiplyScalar(baryB))
      .add(positionC.clone().multiplyScalar(baryC));
    worldPosition.copy(localPosition).applyMatrix4(worldMatrix);
    transformedPosition.copy(localPosition).applyMatrix4(localMatrix);

    normalA.fromBufferAttribute(normalAttribute, record.aIndex);
    normalB.fromBufferAttribute(normalAttribute, record.bIndex);
    normalC.fromBufferAttribute(normalAttribute, record.cIndex);
    localNormal
      .copy(normalA)
      .multiplyScalar(baryA)
      .add(normalB.clone().multiplyScalar(baryB))
      .add(normalC.clone().multiplyScalar(baryC))
      .normalize();
    transformedNormal.copy(localNormal).applyMatrix3(normalMatrix).normalize();

    readUv(uvAttribute, record.aIndex, uvA);
    readUv(uvAttribute, record.bIndex, uvB);
    readUv(uvAttribute, record.cIndex, uvC);
    sampleUv
      .copy(uvA)
      .multiplyScalar(baryA)
      .add(uvB.clone().multiplyScalar(baryB))
      .add(uvC.clone().multiplyScalar(baryC));

    const vertexColorA = readVertexColor(colorAttribute, record.aIndex);
    const vertexColorB = readVertexColor(colorAttribute, record.bIndex);
    const vertexColorC = readVertexColor(colorAttribute, record.cIndex);
    if (vertexColorA && vertexColorB && vertexColorC) {
      colorA.fromArray(vertexColorA);
      colorB.fromArray(vertexColorB);
      colorC.fromArray(vertexColorC);
      sampleColor
        .copy(colorA)
        .multiplyScalar(baryA)
        .add(colorB.clone().multiplyScalar(baryB))
        .add(colorC.clone().multiplyScalar(baryC));
    }

    samples.push({
      position: transformedPosition.toArray() as [number, number, number],
      normal: transformedNormal.toArray() as [number, number, number],
      uv: [sampleUv.x, sampleUv.y],
      height: worldPosition.y,
      vertexColor:
        vertexColorA && vertexColorB && vertexColorC
          ? [sampleColor.x, sampleColor.y, sampleColor.z, sampleColor.w]
          : null
    });
  }

  return samples;
}
