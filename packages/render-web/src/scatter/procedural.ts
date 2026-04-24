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
  uvs: number[],
  position: THREE.Vector3,
  normal: THREE.Vector3,
  color: [number, number, number],
  treeHeight: number,
  uv: [number, number]
): void {
  positions.push(position.x, position.y, position.z);
  normals.push(normal.x, normal.y, normal.z);
  colors.push(color[0], color[1], color[2]);
  heights.push(treeHeight);
  uvs.push(uv[0], uv[1]);
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

export function createProceduralGrassGeometry(
  definition: GrassTypeDefinition
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const heights: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bladeCount = Math.max(1, definition.tuft.kind === "procedural" ? definition.tuft.bladesPerTuft : 4);
  const width = definition.tuft.kind === "procedural" ? definition.tuft.widthBase : 0.05;
  const bend = definition.tuft.kind === "procedural" ? definition.tuft.bendAmount : 0.25;
  const heightRange =
    definition.tuft.kind === "procedural" ? definition.tuft.heightRange : ([0.35, 0.7] as [number, number]);
  const bladeProfile =
    definition.tuft.kind === "procedural" ? definition.tuft.bladeProfile ?? "flat" : "flat";
  const baseColor = rgbTuple(definition.baseColor);
  const tipColor = rgbTuple(definition.tipColor);

  // Force every blade vertex normal to point straight up. This is the
  // stylized-grass "Set Vertex Normals X=0 Y=1 Z=0" trick: all blades in a
  // tuft compute identical `dot(normal, sunDir)` regardless of their
  // per-blade rotation, which collapses the per-blade lighting noise that
  // reads as "spiky" under directional light. The geometric face normal of
  // a blade's quad is irrelevant for stylized grass; the silhouette and
  // root-to-tip gradient carry the visual, not the face lighting.
  const upNormal = new THREE.Vector3(0, 1, 0);

  // Stylized-grass tuft radius: spread blades across a small disk instead
  // of spawning them all from the tuft origin. Without this, N blades at one
  // XZ point with varied rotations read as a "sunburst" — lots of blades
  // radiating from a single spike. Spread gives the tuft volume and lets
  // adjacent blades overlap like real grass clumps.
  const tuftRadius = width * 1.4;

  for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
    const heightMix = hash01(bladeIndex + 1);
    const widthMix = hash01(bladeIndex + 11);
    const bendMix = hash01(bladeIndex + 23);
    const leanMix = hash01(bladeIndex + 37);
    const offsetAngleMix = hash01(bladeIndex + 53);
    const offsetRadiusMix = hash01(bladeIndex + 79);
    const rotationMix = hash01(bladeIndex + 97);
    const tiltDirectionMix = hash01(bladeIndex + 113);
    const tiltAmountMix = hash01(bladeIndex + 127);
    // Two independent rotations:
    //   1. Face rotation (Y-axis): which compass direction the blade's flat
    //      side faces. Randomized so the viewer sees different silhouettes
    //      across the tuft, not all blades edge-on or all blades facing the
    //      same way.
    //   2. Tilt rotation (arbitrary horizontal axis): the small lean off
    //      vertical. Direction chosen INDEPENDENTLY of face rotation so
    //      blades don't all lean outward from the tuft origin — grass grows
    //      straight up with slight random tilts, not in a sunburst.
    const faceRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rotationMix * Math.PI * 2
    );
    const tiltAxis = new THREE.Vector3(
      Math.cos(tiltDirectionMix * Math.PI * 2),
      0,
      Math.sin(tiltDirectionMix * Math.PI * 2)
    );
    // bend (default 0.7) drives the max tilt magnitude. 0.6 × 0.7 ≈ 0.42 rad
    // ≈ 24°; per-blade jitter keeps each blade tilted 30-100% of that max.
    const tiltAngle = bend * 0.6 * (0.3 + tiltAmountMix * 0.7);
    const tiltRotation = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tiltAngle);
    const rotation = tiltRotation.clone().multiply(faceRotation);
    const normal = upNormal;
    const bladeHeight =
      heightRange[0] + (heightRange[1] - heightRange[0]) * heightMix;
    const bladeWidth = width * (0.82 + widthMix * 0.42);
    // Internal leaf curve is now subtle — the blade silhouette still bends
    // forward slightly (base narrow → mid wide → tip pointy, all curving
    // in local Z), but the MAJORITY of the off-vertical lean comes from
    // the tilt rotation above, not the leaf's internal shape.
    const bladeBend = bend * 0.15 * (0.8 + bendMix * 0.45);
    const bladeLean = (leanMix - 0.5) * bladeWidth * 0.35;
    const offsetAngle = offsetAngleMix * Math.PI * 2;
    const offsetRadius = Math.sqrt(offsetRadiusMix) * tuftRadius;
    const rootOffset = new THREE.Vector3(
      Math.cos(offsetAngle) * offsetRadius,
      0,
      Math.sin(offsetAngle) * offsetRadius
    );
    const vertexOffset = positions.length / 3;

    if (bladeProfile === "tapered") {
      // Grass-blade silhouette: nearly-uniform-width ribbon with a subtle
      // mid taper and a pointy tip. Not a leaf-belly shape — grass is a
      // strap, not a rugby ball. Base at 50% width, mid at 55% width
      // (slight widening ~10% for an organic non-geometric feel), tip
      // at a point. The mid-segment is offset in +Z by ~35% of bladeBend
      // and the tip by the full bladeBend so the strap curves gently
      // forward instead of standing as a flat rectangle.
      const baseHalfWidth = bladeWidth * 0.5;
      const midHalfWidth = bladeWidth * 0.55;
      const baseLocalY = 0;
      const midLocalY = bladeHeight * 0.55;
      const tipLocalY = bladeHeight;
      const midBendZ = bladeBend * 0.35;
      const tipBendZ = bladeBend;
      const left = new THREE.Vector3(-baseHalfWidth, baseLocalY, 0)
        .applyQuaternion(rotation)
        .add(rootOffset);
      const right = new THREE.Vector3(baseHalfWidth, baseLocalY, 0)
        .applyQuaternion(rotation)
        .add(rootOffset);
      const midLeft = new THREE.Vector3(
        -midHalfWidth,
        midLocalY,
        midBendZ
      )
        .applyQuaternion(rotation)
        .add(rootOffset);
      const midRight = new THREE.Vector3(
        midHalfWidth,
        midLocalY,
        midBendZ
      )
        .applyQuaternion(rotation)
        .add(rootOffset);
      const tip = new THREE.Vector3(bladeLean, tipLocalY, tipBendZ)
        .applyQuaternion(rotation)
        .add(rootOffset);
      const midColor: [number, number, number] = [
        baseColor[0] * 0.35 + tipColor[0] * 0.65,
        baseColor[1] * 0.35 + tipColor[1] * 0.65,
        baseColor[2] * 0.35 + tipColor[2] * 0.65
      ];

      pushVertex(positions, normals, colors, heights, uvs, left, normal, baseColor, 0, [0.35, 0]);
      pushVertex(positions, normals, colors, heights, uvs, right, normal, baseColor, 0, [0.65, 0]);
      pushVertex(positions, normals, colors, heights, uvs, midLeft, normal, midColor, 0.55, [0.05, 0.55]);
      pushVertex(positions, normals, colors, heights, uvs, midRight, normal, midColor, 0.55, [0.95, 0.55]);
      pushVertex(positions, normals, colors, heights, uvs, tip, normal, tipColor, 1, [0.5, 1]);

      indices.push(
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 1,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset + 3,
        vertexOffset + 2,
        vertexOffset + 4,
        vertexOffset + 3
      );
    } else {
      const left = new THREE.Vector3(-bladeWidth * 0.5, 0, 0)
        .applyQuaternion(rotation)
        .add(rootOffset);
      const right = new THREE.Vector3(bladeWidth * 0.5, 0, 0)
        .applyQuaternion(rotation)
        .add(rootOffset);
      const topOffset = new THREE.Vector3(bladeLean, bladeHeight, bladeBend).applyQuaternion(rotation);
      const topLeft = new THREE.Vector3(-bladeWidth * 0.15, 0, 0)
        .applyQuaternion(rotation)
        .add(topOffset)
        .add(rootOffset);
      const topRight = new THREE.Vector3(bladeWidth * 0.15, 0, 0)
        .applyQuaternion(rotation)
        .add(topOffset)
        .add(rootOffset);

      pushVertex(positions, normals, colors, heights, uvs, left, normal, baseColor, 0, [0, 0]);
      pushVertex(positions, normals, colors, heights, uvs, right, normal, baseColor, 0, [1, 0]);
      pushVertex(positions, normals, colors, heights, uvs, topLeft, normal, tipColor, 1, [0.15, 1]);
      pushVertex(positions, normals, colors, heights, uvs, topRight, normal, tipColor, 1, [0.85, 1]);

      indices.push(
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 1,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset + 3
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
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
  const uvs: number[] = [];
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
    uvs,
    new THREE.Vector3(-stemWidth, 0, 0),
    stemNormal,
    stemColor,
    0,
    [0, 0]
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    uvs,
    new THREE.Vector3(stemWidth, 0, 0),
    stemNormal,
    stemColor,
    0,
    [1, 0]
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    uvs,
    new THREE.Vector3(-stemWidth * 0.5, stemHeight, 0),
    stemNormal,
    stemColor,
    0.75,
    [0.25, 0.75]
  );
  pushVertex(
    positions,
    normals,
    colors,
    heights,
    uvs,
    new THREE.Vector3(stemWidth * 0.5, stemHeight, 0),
    stemNormal,
    stemColor,
    0.75,
    [0.75, 0.75]
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
    uvs,
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 1, 0),
    centerColor,
    1,
    [0.5, 1]
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
      uvs,
      start,
      new THREE.Vector3(0, 1, 0),
      petalColor,
      1,
      [0, 1]
    );
    pushVertex(
      positions,
      normals,
      colors,
      heights,
      uvs,
      end,
      new THREE.Vector3(0, 1, 0),
      petalColor,
      1,
      [1, 1]
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
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
