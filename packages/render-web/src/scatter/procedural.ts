/**
 * Procedural scatter geometry.
 *
 * Owns Stage 1 procedural tuft / flower meshes for scatter layers. These
 * geometries are reused by both the landscape path and the Surface Library
 * preview so the visual primitive for built-in grass/flowers stays shared.
 */

import * as THREE from "three";
import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  RockTypeDefinition
} from "@sugarmagic/domain";

function rgbTuple(color: number): [number, number, number] {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255
  ];
}

function pushVertex(
  positions: number[],
  normals: number[],
  colors: number[],
  heights: number[],
  position: THREE.Vector3,
  normal: THREE.Vector3,
  color: [number, number, number],
  treeHeight: number
): void {
  positions.push(position.x, position.y, position.z);
  normals.push(normal.x, normal.y, normal.z);
  colors.push(color[0], color[1], color[2]);
  heights.push(treeHeight);
}

export function createProceduralGrassGeometry(
  definition: GrassTypeDefinition
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];
  const bladeCount = Math.max(1, definition.tuft.kind === "procedural" ? definition.tuft.bladesPerTuft : 4);
  const width = definition.tuft.kind === "procedural" ? definition.tuft.widthBase : 0.05;
  const bend = definition.tuft.kind === "procedural" ? definition.tuft.bendAmount : 0.25;
  const baseColor = rgbTuple(definition.baseColor);
  const tipColor = rgbTuple(definition.tipColor);

  for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
    const angle = (bladeIndex / bladeCount) * Math.PI * 2;
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).normalize();
    const left = new THREE.Vector3(-width * 0.5, 0, 0).applyQuaternion(rotation);
    const right = new THREE.Vector3(width * 0.5, 0, 0).applyQuaternion(rotation);
    const topOffset = new THREE.Vector3(0, 1, bend).applyQuaternion(rotation);
    const topLeft = new THREE.Vector3(-width * 0.15, 0, 0)
      .applyQuaternion(rotation)
      .add(topOffset);
    const topRight = new THREE.Vector3(width * 0.15, 0, 0)
      .applyQuaternion(rotation)
      .add(topOffset);
    const vertexOffset = positions.length / 3;

    pushVertex(positions, normals, colors, heights, left, normal, baseColor, 0);
    pushVertex(positions, normals, colors, heights, right, normal, baseColor, 0);
    pushVertex(positions, normals, colors, heights, topLeft, normal, tipColor, 1);
    pushVertex(positions, normals, colors, heights, topRight, normal, tipColor, 1);

    indices.push(
      vertexOffset,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 3
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute(
    "_tree_height",
    new THREE.Float32BufferAttribute(heights, 1)
  );
  return geometry;
}

export function createProceduralFlowerGeometry(
  definition: FlowerTypeDefinition
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];
  const petalCount = Math.max(4, definition.head.kind === "procedural" ? definition.head.petalCount : 6);
  const radius = definition.head.kind === "procedural" ? definition.head.radius : 0.08;
  const stemColor = rgbTuple(0x5c7d3a);
  const petalColor = rgbTuple(definition.petalColor);
  const centerColor = rgbTuple(definition.centerColor);
  const stemWidth = radius * 0.18;
  const stemHeight = 0.72;

  const stemNormal = new THREE.Vector3(0, 0, 1);
  const stemOffset = positions.length / 3;
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    new THREE.Vector3(-stemWidth, 0, 0),
    stemNormal,
    stemColor,
    0
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    new THREE.Vector3(stemWidth, 0, 0),
    stemNormal,
    stemColor,
    0
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    new THREE.Vector3(-stemWidth * 0.5, stemHeight, 0),
    stemNormal,
    stemColor,
    0.75
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    new THREE.Vector3(stemWidth * 0.5, stemHeight, 0),
    stemNormal,
    stemColor,
    0.75
  );
  indices.push(
    stemOffset,
    stemOffset + 2,
    stemOffset + 1,
    stemOffset + 1,
    stemOffset + 2,
    stemOffset + 3
  );

  const centerIndex = positions.length / 3;
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 1, 0),
    centerColor,
    1
  );

  for (let petalIndex = 0; petalIndex < petalCount; petalIndex += 1) {
    const startAngle = (petalIndex / petalCount) * Math.PI * 2;
    const endAngle = ((petalIndex + 1) / petalCount) * Math.PI * 2;
    const start = new THREE.Vector3(
      Math.cos(startAngle) * radius,
      1,
      Math.sin(startAngle) * radius
    );
    const end = new THREE.Vector3(
      Math.cos(endAngle) * radius,
      1,
      Math.sin(endAngle) * radius
    );
    const vertexOffset = positions.length / 3;
    pushVertex(
      positions,
      normals,
      colors,
      heights,
      start,
      new THREE.Vector3(0, 1, 0),
      petalColor,
      1
    );
    pushVertex(
      positions,
      normals,
      colors,
      heights,
      end,
      new THREE.Vector3(0, 1, 0),
      petalColor,
      1
    );
    indices.push(centerIndex, vertexOffset, vertexOffset + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute(
    "_tree_height",
    new THREE.Float32BufferAttribute(heights, 1)
  );
  return geometry;
}

export function createProceduralRockGeometry(
  definition: RockTypeDefinition
): THREE.BufferGeometry {
  const source =
    definition.source.kind === "procedural"
      ? definition.source
      : {
          radiusRange: [0.08, 0.18] as [number, number],
          heightRatioRange: [0.45, 0.9] as [number, number],
          facetCount: 8
        };
  const radius = (source.radiusRange[0] + source.radiusRange[1]) / 2;
  const heightRatio =
    (source.heightRatioRange[0] + source.heightRatioRange[1]) / 2;
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  geometry.scale(1, heightRatio, 1);
  const colorTuple = rgbTuple(definition.color);
  const vertexCount = geometry.getAttribute("position").count;
  const colors = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < vertexCount; index += 1) {
    colors[index * 3] = colorTuple[0];
    colors[index * 3 + 1] = colorTuple[1];
    colors[index * 3 + 2] = colorTuple[2];
    heights[index] = position.getY(index) / Math.max(radius * heightRatio * 2, 0.0001);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("_tree_height", new THREE.BufferAttribute(heights, 1));
  return geometry;
}
