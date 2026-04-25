/**
 * Scatter compute pipeline.
 *
 * Owns Story 36.16's GPU-driven scatter realization: candidate-instance build
 * on WebGPU compute, per-camera visibility culling + compaction, and indirect
 * draw argument updates. It also exports deterministic CPU emulation helpers so
 * tests can verify the pipeline's accepted-count and culling behavior without
 * requiring a live WebGPU device.
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  PI2,
  Return,
  abs,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  cos,
  cross,
  distance,
  float,
  fract,
  instanceIndex,
  mat4,
  max,
  normalize,
  sin,
  storage,
  uniform,
  uint,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import type { ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import type {
  PackedScatterSampleInputs,
  ScatterGpuInstanceBuffers
} from "./instance-buffer";
import {
  createScatterGpuInstanceBuffers,
  packScatterSampleInputs
} from "./instance-buffer";
import type { SurfaceScatterSample } from "./index";

const SCATTER_COMPUTE_WORKGROUP_SIZE = 64;
const DEFAULT_SCATTER_MAX_DRAW_DISTANCE = 96;

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function hashLayerId(layerId: string): number {
  let seed = 17;
  for (let index = 0; index < layerId.length; index += 1) {
    seed += layerId.charCodeAt(index) * (index + 1);
  }
  return seed;
}

function jitterColor(color: number, amount: number, jitter: number): THREE.Color {
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  base.setHSL(
    hsl.h,
    Math.max(0, Math.min(1, hsl.s + jitter * amount * 0.35)),
    Math.max(0, Math.min(1, hsl.l + jitter * amount * 0.25))
  );
  return base;
}

function baseColorForLayer(layer: ResolvedScatterLayer): number {
  if (layer.contentKind === "grass") {
    return (layer.definition as ResolvedScatterLayer["definition"] & {
      tipColor: number;
    }).tipColor;
  }
  if (layer.contentKind === "flowers") {
    return (layer.definition as ResolvedScatterLayer["definition"] & {
      petalColor: number;
    }).petalColor;
  }
  return (layer.definition as ResolvedScatterLayer["definition"] & {
    color: number;
  }).color;
}

function baseBoundingRadius(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingSphere();
  return geometry.boundingSphere?.radius ?? 0.5;
}

function scaleJitterForLayer(layer: ResolvedScatterLayer): [number, number] {
  return layer.definition.scaleJitter;
}

function rotationJitterForLayer(layer: ResolvedScatterLayer): number {
  return layer.definition.rotationJitter;
}

function verticalScaleJitterForLayer(layer: ResolvedScatterLayer): number {
  return layer.contentKind === "grass"
    ? Math.max(
        0,
        (
          layer.definition as ResolvedScatterLayer["definition"] & {
            heightJitter: number;
          }
        ).heightJitter
      )
    : 0;
}

export interface ScatterComputeLayerParams {
  layerId: string;
  seed: number;
  baseColor: number;
  colorJitter: number;
  scaleJitter: [number, number];
  rotationJitter: number;
  verticalScaleJitter: number;
  baseInstanceRadius: number;
  maxDrawDistance: number;
}

export interface ScatterCandidateSnapshot {
  accepted: boolean;
  localPosition: THREE.Vector3;
  liftedLocalPosition: THREE.Vector3;
  radius: number;
  color: THREE.Color;
}

export interface ScatterVisibilitySnapshot {
  visibleIndices: number[];
  worldOriginsXZ: Array<[number, number]>;
}

export interface ScatterComputePipeline {
  /**
   * The renderable mesh — `THREE.InstancedMesh` so we can use Three's
   * built-in mat4-attribute splitting for `instanceMatrix` (WGSL
   * doesn't allow mat4 attributes via `@location` directly; Three
   * special-cases this for InstancedMesh.instanceMatrix and emits the
   * 4-vec4 split). The instance data is GPU-resident: the assigned
   * `instanceMatrix` and `instanceColor` are
   * `StorageInstancedBufferAttribute` instances that compute writes
   * to via storage()-node bindings, and that the render pipeline
   * reads as instance attributes through Three's standard path.
   * Instance count is driven each frame by the indirect-draw-args
   * buffer that the cull/finalize compute passes write.
   */
  readonly mesh: THREE.InstancedMesh;
  readonly buffers: ScatterGpuInstanceBuffers;
  markCandidatesDirty(): void;
  prepareForRender(renderer: WebGPURenderer, camera: THREE.Camera): void;
  readVisibleCount(renderer: WebGPURenderer): Promise<number>;
  readIndirectArgs(renderer: WebGPURenderer): Promise<Uint32Array>;
  readVisibleOrigins(renderer: WebGPURenderer): Promise<Float32Array>;
  dispose(): void;
}

export function createScatterComputeLayerParams(
  layer: ResolvedScatterLayer,
  geometry: THREE.BufferGeometry,
  overrides: Partial<Pick<ScatterComputeLayerParams, "maxDrawDistance">> = {}
): ScatterComputeLayerParams {
  return {
    layerId: layer.layerId,
    seed: hashLayerId(layer.layerId),
    baseColor: baseColorForLayer(layer),
    colorJitter: layer.definition.colorJitter,
    scaleJitter: scaleJitterForLayer(layer),
    rotationJitter: rotationJitterForLayer(layer),
    verticalScaleJitter: verticalScaleJitterForLayer(layer),
    baseInstanceRadius: baseBoundingRadius(geometry),
    maxDrawDistance:
      overrides.maxDrawDistance ?? DEFAULT_SCATTER_MAX_DRAW_DISTANCE
  };
}

export function simulateScatterCandidateBuild(
  packedInputs: PackedScatterSampleInputs,
  params: ScatterComputeLayerParams
): ScatterCandidateSnapshot[] {
  const candidates: ScatterCandidateSnapshot[] = [];
  const baseColor = params.baseColor;
  const baseScaleMin = params.scaleJitter[0];
  const baseScaleRange = params.scaleJitter[1] - params.scaleJitter[0];

  for (let index = 0; index < packedInputs.sampleCount; index += 1) {
    const densityWeight = packedInputs.densityWeights[index] ?? 0;
    const acceptSeed = params.seed + index * 11 + 1;
    const accepted =
      densityWeight > 0 && hash01(acceptSeed) <= Math.min(1, densityWeight);

    const localPosition = new THREE.Vector3(
      packedInputs.positions[index * 3] ?? 0,
      packedInputs.positions[index * 3 + 1] ?? 0,
      packedInputs.positions[index * 3 + 2] ?? 0
    );
    const localNormal = new THREE.Vector3(
      packedInputs.normals[index * 3] ?? 0,
      packedInputs.normals[index * 3 + 1] ?? 1,
      packedInputs.normals[index * 3 + 2] ?? 0
    ).normalize();
    const liftedLocalPosition = localPosition.clone().addScaledVector(localNormal, 0.01);

    const baseScale = baseScaleMin + baseScaleRange * hash01(params.seed + index * 13 + 3);
    const verticalScale =
      baseScale *
      (1 +
        (hash01(params.seed + index * 17 + 4) * 2 - 1) * params.verticalScaleJitter);

    const colorJitter = hash01(params.seed + index * 19 + 5) * 2 - 1;
    const color = jitterColor(baseColor, params.colorJitter, colorJitter);
    const radius = params.baseInstanceRadius * Math.max(baseScale, verticalScale);

    candidates.push({
      accepted,
      localPosition,
      liftedLocalPosition,
      radius,
      color
    });
  }

  return candidates;
}

export function simulateScatterVisibility(
  candidates: readonly ScatterCandidateSnapshot[],
  ownerMatrixWorld: THREE.Matrix4,
  camera: THREE.Camera,
  params: ScatterComputeLayerParams
): ScatterVisibilitySnapshot {
  camera.updateMatrixWorld(true);
  const projectionViewMatrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionViewMatrix);
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const worldPosition = new THREE.Vector3();
  const visibleIndices: number[] = [];
  const worldOriginsXZ: Array<[number, number]> = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (!candidate.accepted) {
      continue;
    }

    worldPosition.copy(candidate.liftedLocalPosition).applyMatrix4(ownerMatrixWorld);
    if (worldPosition.distanceTo(cameraPosition) > params.maxDrawDistance) {
      continue;
    }
    const sphere = new THREE.Sphere(worldPosition.clone(), candidate.radius);
    if (!frustum.intersectsSphere(sphere)) {
      continue;
    }

    visibleIndices.push(index);
    worldOriginsXZ.push([worldPosition.x, worldPosition.z]);
  }

  return {
    visibleIndices,
    worldOriginsXZ
  };
}

function canUseScatterComputeAtBuildTime(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function nodeHash01(seedNode: ReturnType<typeof float>) {
  return fract(sin(seedNode.mul(float(12.9898)).add(float(78.233))).mul(float(43758.5453123)));
}

export function createScatterComputePipeline(options: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  samples: readonly SurfaceScatterSample[];
  densityWeights: readonly number[];
  params: ScatterComputeLayerParams;
}): ScatterComputePipeline | null {
  if (!canUseScatterComputeAtBuildTime()) {
    return null;
  }

  const packedInputs = packScatterSampleInputs(options.samples, options.densityWeights);
  const buffers = createScatterGpuInstanceBuffers(packedInputs);
  const { geometry, material, params } = options;
  /* eslint-disable @typescript-eslint/no-explicit-any -- three/tsl's current
   * storage-node types collapse to `never` for storage-instanced mat4/indirect
   * buffers even though the underlying runtime path is valid. Keep the casts
   * tightly scoped to the storage-node construction seam. */
  const storageAny = storage as any;

  // Use a plain THREE.Mesh, NOT InstancedMesh. Instancing is driven by the
  // indirect-draw args buffer that the compute pass writes; per-instance
  // matrix/color/origin are read from storage buffers in the vertex shader
  // via `instanceIndex`. This is the canonical Three.js TSL compute-scatter
  // pattern (cf. Codrops "False Earth", `webgpu_compute_birds`). The earlier
  // approach of overriding `mesh.instanceMatrix` / `mesh.instanceColor` with
  // storage attributes fights Three's InstancedMesh abstraction (which
  // expects CPU-driven `setMatrixAt` + `needsUpdate`) and was the root cause
  // of the scatter not rendering — the renderer's instancing path didn't
  // route through the storage buffers correctly even though the casts were
  // structurally type-safe.
  // Use THREE.InstancedMesh so we get Three's automatic mat4-attribute
  // handling: `mesh.instanceMatrix` is special-cased by the WebGPU
  // backend to split the mat4 into 4 vec4 vertex attribute locations
  // in the generated WGSL — WGSL doesn't allow mat4 attributes via
  // `@location` directly, only scalars and vectors. A plain THREE.Mesh
  // with `setAttribute("instanceMatrix", visibleMatrices)` does NOT
  // get that splitting and produces the WGSL validation error
  // "@location must only be applied to declarations of numeric scalar
  // or numeric vector type" on the mat4x4 attribute.
  //
  // Storage-driven instancing still works through the InstancedMesh
  // path: `StorageInstancedBufferAttribute` extends
  // `InstancedBufferAttribute`, so assigning it to `mesh.instanceMatrix`
  // routes through Three's optimized mat4-splitting code path AND
  // remains writable from compute via the storage()-node bindings
  // declared further down. One GPU buffer, two binding views —
  // compute writes via storage, render reads via instance attribute.
  //
  // Instance count is driven by `setIndirect` (the indirect-draw-args
  // buffer's instanceCount field, written each frame by the
  // finalize-indirect compute pass).
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    packedInputs.sampleCount
  );
  mesh.name = `surface-scatter:${params.layerId}:gpu`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  mesh.instanceMatrix =
    buffers.visibleMatrices as unknown as THREE.InstancedBufferAttribute;
  mesh.instanceColor =
    buffers.visibleColors as unknown as THREE.InstancedBufferAttribute;
  mesh.geometry.setAttribute(
    "instanceOrigin",
    buffers.visibleOrigins as unknown as THREE.BufferAttribute
  );
  mesh.geometry.setIndirect(buffers.indirectDrawArgs, 0);
  // mesh.count is the upper bound; the actual draw count comes from
  // indirectDrawArgs[1] which the cull pass writes each frame.
  mesh.count = packedInputs.sampleCount;

  const samplePositionsNode: any = storageAny(
    buffers.samplePositions,
    "vec3",
    packedInputs.sampleCount
  ).toReadOnly();
  const sampleNormalsNode: any = storageAny(
    buffers.sampleNormals,
    "vec3",
    packedInputs.sampleCount
  ).toReadOnly();
  const sampleDensityNode: any = storageAny(
    buffers.sampleDensityWeights,
    "float",
    packedInputs.sampleCount
  ).toReadOnly();

  const candidateActiveNode: any = storageAny(
    buffers.candidateActive,
    "uint",
    packedInputs.sampleCount
  );
  const candidatePositionNode: any = storageAny(
    buffers.candidatePositions,
    "vec3",
    packedInputs.sampleCount
  );
  const candidateMatrixNode: any = storageAny(
    buffers.candidateMatrices,
    null,
    packedInputs.sampleCount
  );
  const candidateColorNode: any = storageAny(
    buffers.candidateColors,
    "vec3",
    packedInputs.sampleCount
  );
  const candidateRadiusNode: any = storageAny(
    buffers.candidateRadii,
    "float",
    packedInputs.sampleCount
  );

  const visibleCountNode: any = storageAny(buffers.visibleCount, "uint", 1).toAtomic();
  const visibleMatrixNode: any = storageAny(
    buffers.visibleMatrices,
    null,
    packedInputs.sampleCount
  );
  const visibleColorNode: any = storageAny(
    buffers.visibleColors,
    "vec3",
    packedInputs.sampleCount
  );
  const visibleOriginNode: any = storageAny(
    buffers.visibleOrigins,
    "vec2",
    packedInputs.sampleCount
  );
  const indirectArgsNode: any = storageAny(buffers.indirectDrawArgs, "uint", 5);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Per-instance position and color come from `mesh.instanceMatrix` and
  // `mesh.instanceColor` (set above) via Three's automatic InstancedMesh
  // attribute path. We do NOT wrap material.positionNode / colorNode
  // here — Three composes the model × instanceMatrix × position
  // transform internally for InstancedMesh. The `material` is whatever
  // the deform shader (foliage-wind) authored; its `positionNode` is
  // the local-space position with wind deformation, which Three then
  // multiplies by the per-instance matrix.

  const layerSeedUniform = uniform(float(params.seed));
  const scaleMinUniform = uniform(float(params.scaleJitter[0]));
  const scaleRangeUniform = uniform(float(params.scaleJitter[1] - params.scaleJitter[0]));
  const rotationJitterUniform = uniform(float(params.rotationJitter));
  const verticalScaleJitterUniform = uniform(float(params.verticalScaleJitter));
  const colorJitterUniform = uniform(float(params.colorJitter));
  const baseColorUniform = uniform(new THREE.Color(params.baseColor));
  const baseRadiusUniform = uniform(float(params.baseInstanceRadius));
  const maxDrawDistanceUniform = uniform(float(params.maxDrawDistance));
  const viewProjectionUniform = uniform(new THREE.Matrix4());
  const ownerMatrixWorldUniform = uniform(new THREE.Matrix4());
  const cameraPositionUniform = uniform(new THREE.Vector3());
  const indexedGeometry = geometry.index !== null;
  const indexCountUniform = uniform(uint(indexedGeometry ? geometry.index!.count : geometry.getAttribute("position").count));
  const firstIndexUniform = uniform(uint(0));

  const buildCandidatesCompute = Fn(() => {
    const sampleIndex = instanceIndex.toVar();
    const densityWeight = sampleDensityNode.element(sampleIndex).toVar();
    const localPosition = samplePositionsNode.element(sampleIndex).toVar();
    const sampleNormal = normalize(sampleNormalsNode.element(sampleIndex)).toVar();
    const acceptRandom = nodeHash01(layerSeedUniform.add(sampleIndex).add(float(1))).toVar();
    const accepted = densityWeight.greaterThan(float(0)).and(
      acceptRandom.lessThanEqual(densityWeight)
    );

    const referenceAxis = abs(sampleNormal.y)
      .greaterThan(float(0.95))
      .select(vec3(1, 0, 0), vec3(0, 1, 0))
      .toVar();
    const tangent = normalize(
      cross(referenceAxis as never, sampleNormal as never)
    ).toVar();
    const bitangent = normalize(cross(sampleNormal as never, tangent as never)).toVar();

    const spinRandom = nodeHash01(layerSeedUniform.add(sampleIndex).add(float(2)))
      .sub(float(0.5))
      .mul(float(PI2))
      .mul(rotationJitterUniform)
      .toVar();
    const spinCos = cos(spinRandom).toVar();
    const spinSin = sin(spinRandom).toVar();
    const rotatedTangent = tangent.mul(spinCos).add(bitangent.mul(spinSin)).toVar();
    const rotatedBitangent = bitangent.mul(spinCos).sub(tangent.mul(spinSin)).toVar();

    const baseScale = scaleMinUniform.add(
      scaleRangeUniform.mul(nodeHash01(layerSeedUniform.add(sampleIndex).add(float(3))))
    ).toVar();
    const verticalScale = baseScale.mul(
      float(1).add(
        nodeHash01(layerSeedUniform.add(sampleIndex).add(float(4)))
          .mul(float(2))
          .sub(float(1))
          .mul(verticalScaleJitterUniform)
      )
    ).toVar();
    const liftedLocalPosition = localPosition.add(sampleNormal.mul(float(0.01))).toVar();
    const jitter = nodeHash01(layerSeedUniform.add(sampleIndex).add(float(5)))
      .mul(float(2))
      .sub(float(1))
      .toVar();
    const colorScale = clamp(
      float(1).add(jitter.mul(colorJitterUniform).mul(float(0.18))),
      float(0),
      float(1.5)
    ).toVar();

    const instanceMatrix = mat4(
      vec4(rotatedTangent.mul(baseScale), 0),
      vec4(sampleNormal.mul(verticalScale), 0),
      vec4(rotatedBitangent.mul(baseScale), 0),
      vec4(liftedLocalPosition, 1)
    ).toVar();

    candidateActiveNode
      .element(sampleIndex)
      .assign(accepted.select(uint(1), uint(0)));
    candidatePositionNode.element(sampleIndex).assign(localPosition);
    candidateMatrixNode.element(sampleIndex).assign(instanceMatrix);
    candidateColorNode
      .element(sampleIndex)
      .assign(baseColorUniform.mul(colorScale));
    candidateRadiusNode
      .element(sampleIndex)
      .assign(baseRadiusUniform.mul(max(baseScale, verticalScale)));
  })()
    .compute(packedInputs.sampleCount, [SCATTER_COMPUTE_WORKGROUP_SIZE])
    .setName("Scatter Build Candidates");

  const resetVisibleCompute = Fn(() => {
    atomicStore(visibleCountNode.element(uint(0)), uint(0));
    indirectArgsNode.element(uint(0)).assign(indexCountUniform);
    indirectArgsNode.element(uint(1)).assign(uint(0));
    indirectArgsNode.element(uint(2)).assign(firstIndexUniform);
    indirectArgsNode.element(uint(3)).assign(uint(0));
    indirectArgsNode.element(uint(4)).assign(uint(0));
  })()
    .compute(1)
    .setName("Scatter Reset Visible");

  const cullVisibleCompute = Fn(() => {
    const sampleIndex = instanceIndex.toVar();
    const active = candidateActiveNode.element(sampleIndex).toVar();
    If(active.equal(uint(0)), () => {
      Return();
    });

    const localPosition = candidatePositionNode.element(sampleIndex).toVar();
    const localPosition4 = vec4(localPosition, 1).toVar();
    const worldPosition4 = ownerMatrixWorldUniform.mul(localPosition4).toVar();
    const worldPosition = worldPosition4.xyz.toVar();
    const clipPosition = viewProjectionUniform.mul(vec4(worldPosition, 1)).toVar();
    const radius = candidateRadiusNode.element(sampleIndex).toVar();
    const insideFrustum = clipPosition.w.greaterThan(float(0))
      .and(abs(clipPosition.x).lessThanEqual(clipPosition.w.add(radius)))
      .and(abs(clipPosition.y).lessThanEqual(clipPosition.w.add(radius)))
      // `-radius` here would be JS unary minus on a TSL node, which
      // returns NaN and emits the literal `NaN.0` into WGSL — invalid.
      // Use `.negate()` to negate the node value at GPU time.
      .and(clipPosition.z.greaterThanEqual(radius.negate()))
      .and(clipPosition.z.lessThanEqual(clipPosition.w.add(radius)));
    const insideDistance = distance(worldPosition, cameraPositionUniform).lessThanEqual(
      maxDrawDistanceUniform
    );

    If(insideFrustum.and(insideDistance), () => {
      const visibleIndex = atomicAdd(visibleCountNode.element(uint(0)), uint(1));
      visibleMatrixNode
        .element(visibleIndex)
        .assign(candidateMatrixNode.element(sampleIndex));
      visibleColorNode
        .element(visibleIndex)
        .assign(candidateColorNode.element(sampleIndex));
      visibleOriginNode
        .element(visibleIndex)
        .assign(vec2(worldPosition.x, worldPosition.z));
    });
  })()
    .compute(packedInputs.sampleCount, [SCATTER_COMPUTE_WORKGROUP_SIZE])
    .setName("Scatter Cull Visible");

  const finalizeIndirectCompute = Fn(() => {
    indirectArgsNode
      .element(uint(1))
      .assign(atomicLoad(visibleCountNode.element(uint(0))));
  })()
    .compute(1)
    .setName("Scatter Finalize Indirect");

  let candidatesDirty = true;
  const lastPreparedFrameByCamera = new Map<string, number>();

  function updateCullingUniforms(camera: THREE.Camera): void {
    camera.updateMatrixWorld(true);
    viewProjectionUniform.value.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    ownerMatrixWorldUniform.value.copy(mesh.matrixWorld);
    cameraPositionUniform.value.setFromMatrixPosition(camera.matrixWorld);
  }

  return {
    mesh,
    buffers,
    markCandidatesDirty() {
      candidatesDirty = true;
      lastPreparedFrameByCamera.clear();
    },
    prepareForRender(renderer: WebGPURenderer, camera: THREE.Camera) {
      const frameId = renderer.info.frame;
      const cameraKey = `${camera.uuid}:${frameId}`;
      if (lastPreparedFrameByCamera.has(cameraKey)) {
        return;
      }

      if (candidatesDirty) {
        renderer.compute(buildCandidatesCompute);
        candidatesDirty = false;
      }

      updateCullingUniforms(camera);
      renderer.compute(resetVisibleCompute);
      renderer.compute(cullVisibleCompute);
      renderer.compute(finalizeIndirectCompute);
      lastPreparedFrameByCamera.set(cameraKey, frameId);
    },
    async readVisibleCount(renderer: WebGPURenderer): Promise<number> {
      const buffer = await renderer.getArrayBufferAsync(buffers.visibleCount);
      return new Uint32Array(buffer)[0] ?? 0;
    },
    async readIndirectArgs(renderer: WebGPURenderer): Promise<Uint32Array> {
      const buffer = await renderer.getArrayBufferAsync(buffers.indirectDrawArgs);
      return new Uint32Array(buffer);
    },
    async readVisibleOrigins(renderer: WebGPURenderer): Promise<Float32Array> {
      const visibleCount = await this.readVisibleCount(renderer);
      const buffer = await renderer.getArrayBufferAsync(buffers.visibleOrigins);
      return new Float32Array(buffer).slice(0, visibleCount * 2);
    },
    dispose() {
      buildCandidatesCompute.dispose();
      resetVisibleCompute.dispose();
      cullVisibleCompute.dispose();
      finalizeIndirectCompute.dispose();
      buffers.dispose();
      // Don't manually deleteAttribute("instanceOrigin") here — by the
      // time this runs, the caller (scatter/index.ts) has already
      // disposed the mesh's geometry, which fires Three's normal
      // attribute cleanup. Manually deleting before geometry.dispose
      // leaves a stale RenderObject slot that crashes onDispose
      // ("Cannot read properties of undefined (reading 'id')").
    }
  };
}
