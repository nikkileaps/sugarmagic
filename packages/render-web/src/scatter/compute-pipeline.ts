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
import { WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  PI2,
  Return,
  abs,
  clamp,
  cos,
  cross,
  distance,
  dot,
  float,
  fract,
  instanceIndex,
  invocationLocalIndex,
  mat4,
  max,
  normalize,
  sin,
  storage,
  uniform,
  uint,
  vec2,
  vec3,
  vec4,
  workgroupArray,
  workgroupBarrier,
  workgroupId
} from "three/tsl";
import type { ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import {
  computeKeepProbability,
  computeLodBin,
  hashKeep,
  LOD1_KEEP_RATIO,
  LOD2_KEEP_RATIO,
  SCATTER_LOD_BAND_SEEDS,
  type ScatterLodBin,
  type ScatterLodRuntimeParams
} from "./lod";
import type {
  PackedScatterSampleInputs,
  ScatterGpuVisibleBinBuffers
} from "./instance-buffer";
import {
  SCATTER_SCAN_WORKGROUP_SIZE,
  createScatterGpuCandidateBuffers,
  createScatterGpuVisibleBinBuffers,
  packScatterSampleInputs
} from "./instance-buffer";
import type { SurfaceScatterSample } from "./index";

const SCATTER_COMPUTE_WORKGROUP_SIZE = 64;
const DEFAULT_SCATTER_MAX_DRAW_DISTANCE = 96;
/**
 * Per-layer candidate ceiling for the GPU-compaction path. Above this
 * count the single-level partials scan can't cover the workgroup count
 * (ceil(N / SCATTER_SCAN_WORKGROUP_SIZE) > SCATTER_SCAN_WORKGROUP_SIZE
 * means we'd need a recursive partials scan, which v1 doesn't
 * implement). The CPU fallback in scatter/index.ts takes over.
 */
const MAX_GPU_COMPACTION_CANDIDATES =
  SCATTER_SCAN_WORKGROUP_SIZE * SCATTER_SCAN_WORKGROUP_SIZE;

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
  lodBin: Exclude<ScatterLodBin, "none"> | null;
  lod: ScatterLodRuntimeParams;
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
  readonly bins: Array<{
    bin: Exclude<ScatterLodBin, "none">;
    mesh: THREE.InstancedMesh;
    buffers: ScatterGpuVisibleBinBuffers;
  }>;
  markCandidatesDirty(): void;
  prepareForRender(renderer: WebGPURenderer, camera: THREE.Camera): void;
  dispose(): void;
}

export function createScatterComputeLayerParams(
  layer: ResolvedScatterLayer,
  geometry: THREE.BufferGeometry,
  overrides: Partial<
    Pick<ScatterComputeLayerParams, "maxDrawDistance" | "lodBin">
  > = {}
): ScatterComputeLayerParams {
  const definition = layer.definition as ResolvedScatterLayer["definition"] & {
    lod1Distance: number;
    lod2Distance: number;
    lodTransitionWidth: number;
    distantMeshThreshold: number;
    maxDrawDistance: number;
    lodMeshes?: {
      far?: unknown;
      billboard?: unknown;
    };
  };
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
      overrides.maxDrawDistance ??
      definition.maxDrawDistance ??
      DEFAULT_SCATTER_MAX_DRAW_DISTANCE,
    lodBin: overrides.lodBin ?? null,
    lod: {
      lod1Distance: definition.lod1Distance,
      lod2Distance: definition.lod2Distance,
      lodTransitionWidth: definition.lodTransitionWidth,
      distantMeshThreshold: definition.distantMeshThreshold,
      maxDrawDistance:
        overrides.maxDrawDistance ??
        definition.maxDrawDistance ??
        DEFAULT_SCATTER_MAX_DRAW_DISTANCE,
      hasFarBin: Boolean(definition.lodMeshes?.far),
      hasBillboardBin: Boolean(definition.lodMeshes?.billboard)
    }
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
    const distanceToCamera = worldPosition.distanceTo(cameraPosition);
    if (distanceToCamera > params.maxDrawDistance) {
      continue;
    }
    const sphere = new THREE.Sphere(worldPosition.clone(), candidate.radius);
    if (!frustum.intersectsSphere(sphere)) {
      continue;
    }

    if (params.lodBin) {
      const lodBin = computeLodBin(distanceToCamera, params.lod);
      if (lodBin !== params.lodBin) {
        continue;
      }
      const keepProbability = computeKeepProbability(distanceToCamera, params.lod);
      if (!hashKeep(index, SCATTER_LOD_BAND_SEEDS[params.lodBin], keepProbability)) {
        continue;
      }
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
  bins: Array<{
    bin: Exclude<ScatterLodBin, "none">;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }>;
  samples: readonly SurfaceScatterSample[];
  densityWeights: readonly number[];
  params: ScatterComputeLayerParams;
}): ScatterComputePipeline | null {
  if (!canUseScatterComputeAtBuildTime()) {
    return null;
  }
  if (options.samples.length > MAX_GPU_COMPACTION_CANDIDATES) {
    // Single-level partials scan can't cover ceil(N/WG) > WG. Recursive
    // partials scan would let us scale further but isn't implemented in
    // v1; the CPU fallback in scatter/index.ts handles oversize layers.
    console.warn(
      `[surface-scatter] GPU compute pipeline declined for layer with ${options.samples.length} samples (above the ${MAX_GPU_COMPACTION_CANDIDATES}-candidate cap for single-level partials scan). Falling back to CPU instancing.`
    );
    return null;
  }
  if (options.bins.length === 0) {
    return null;
  }

  const packedInputs = packScatterSampleInputs(options.samples, options.densityWeights);
  const candidateBuffers = createScatterGpuCandidateBuffers(packedInputs);
  const { params } = options;
  /* eslint-disable @typescript-eslint/no-explicit-any -- three/tsl's current
   * storage-node types collapse to `never` for storage-instanced mat4/indirect
   * buffers even though the underlying runtime path is valid. Keep the casts
   * tightly scoped to the storage-node construction seam. */
  const storageAny = storage as any;

  const samplePositionsNode: any = storageAny(
    candidateBuffers.samplePositions,
    "vec3",
    packedInputs.sampleCount
  ).toReadOnly();
  const sampleNormalsNode: any = storageAny(
    candidateBuffers.sampleNormals,
    "vec3",
    packedInputs.sampleCount
  ).toReadOnly();
  const sampleDensityNode: any = storageAny(
    candidateBuffers.sampleDensityWeights,
    "float",
    packedInputs.sampleCount
  ).toReadOnly();

  const candidateActiveNode: any = storageAny(
    candidateBuffers.candidateActive,
    "uint",
    packedInputs.sampleCount
  );
  const candidatePositionNode: any = storageAny(
    candidateBuffers.candidatePositions,
    "vec3",
    packedInputs.sampleCount
  );
  const candidateMatrixNode: any = storageAny(
    candidateBuffers.candidateMatrices,
    null,
    packedInputs.sampleCount
  );
  const candidateColorNode: any = storageAny(
    candidateBuffers.candidateColors,
    "vec3",
    packedInputs.sampleCount
  );
  const candidateRadiusNode: any = storageAny(
    candidateBuffers.candidateRadii,
    "float",
    packedInputs.sampleCount
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const sampleCountUniform = uniform(uint(packedInputs.sampleCount));
  const scanWorkgroupCountUniform = uniform(uint(candidateBuffers.scanWorkgroupCount));

  const layerSeedUniform = uniform(float(params.seed));
  const scaleMinUniform = uniform(float(params.scaleJitter[0]));
  const scaleRangeUniform = uniform(float(params.scaleJitter[1] - params.scaleJitter[0]));
  const rotationJitterUniform = uniform(float(params.rotationJitter));
  const verticalScaleJitterUniform = uniform(float(params.verticalScaleJitter));
  const colorJitterUniform = uniform(float(params.colorJitter));
  const baseColorUniform = uniform(new THREE.Color(params.baseColor));
  const baseRadiusUniform = uniform(float(params.baseInstanceRadius));
  const maxDrawDistanceUniform = uniform(float(params.maxDrawDistance));
  const lod1DistanceUniform = uniform(float(params.lod.lod1Distance));
  const lod2DistanceUniform = uniform(float(params.lod.lod2Distance));
  const lodTransitionWidthUniform = uniform(float(params.lod.lodTransitionWidth));
  const distantMeshThresholdUniform = uniform(float(params.lod.distantMeshThreshold));
  const hasFarBinUniform = uniform(uint(params.lod.hasFarBin ? 1 : 0));
  const hasBillboardBinUniform = uniform(uint(params.lod.hasBillboardBin ? 1 : 0));
  const lodNearBandSeedUniform = uniform(float(SCATTER_LOD_BAND_SEEDS.near));
  const lodFarBandSeedUniform = uniform(float(SCATTER_LOD_BAND_SEEDS.far));
  const lodBillboardBandSeedUniform = uniform(float(SCATTER_LOD_BAND_SEEDS.billboard));
  const viewProjectionUniform = uniform(new THREE.Matrix4());
  const ownerMatrixWorldUniform = uniform(new THREE.Matrix4());
  const cameraLocalPositionUniform = uniform(new THREE.Vector3());
  const cameraPositionUniform = uniform(new THREE.Vector3());

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

  // ============================================================
  // Per-frame compaction pipeline (Option B):
  //   markVisible  -> writes 0/1 visibility flag per candidate
  //   scanLocal    -> per-workgroup inclusive scan of flags
  //                   writes localOffsets[tid] (exclusive within wg)
  //                   writes workgroupPartials[wgid] (wg total)
  //   scanPartials -> single workgroup scans the partials array
  //                   writes workgroupOffsets[wgid] (exclusive across wgs)
  //                   writes visibleCount[0] AND indirectDrawArgs[1]
  //                   (so indirect-draw kicks the right instanceCount)
  //   scatterCompact -> visible candidates write their matrix/color/
  //                   origin to visible*[workgroupOffsets[wgid] +
  //                   localOffsets[tid]]. Output order is deterministic
  //                   (sampleIndex order), no atomicAdd race.
  // ============================================================

  // Hillis-Steele inclusive scan inside a workgroup. The validated
  // pattern from the prefix-sum spike: read scratch[tid] AND
  // scratch[tid - stride] into per-thread vars, barrier, then write
  // back to scratch[tid]. Writes happen ONLY after every reader has
  // captured the prior value — eliminates the read-write race that a
  // single-buffer inclusive scan would otherwise have.
  /* eslint-disable @typescript-eslint/no-explicit-any -- TSL
   * WorkgroupInfoNode element access types collapse on chained ops. */
  function emitWorkgroupInclusiveScan(scratch: any, lid: any): void {
    for (let stride = 1; stride < SCATTER_SCAN_WORKGROUP_SIZE; stride *= 2) {
      const strideUint = uint(stride);
      const me = scratch.element(lid).toVar();
      const newValue = me.toVar();
      If(lid.greaterThanEqual(strideUint), () => {
        const left = scratch.element(lid.sub(strideUint));
        newValue.assign(me.add(left));
      });
      workgroupBarrier();
      scratch.element(lid).assign(newValue);
      workgroupBarrier();
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let candidatesDirty = true;
  const lastPreparedFrameByCamera = new Map<string, number>();
  const ownerObject = new THREE.Object3D();

  function updateCullingUniforms(
    camera: THREE.Camera,
    ownerMatrixWorldSource: THREE.Object3D
  ): void {
    camera.updateMatrixWorld(true);
    viewProjectionUniform.value.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    ownerMatrixWorldUniform.value.copy(ownerMatrixWorldSource.matrixWorld);
    cameraPositionUniform.value.setFromMatrixPosition(camera.matrixWorld);
    cameraLocalPositionUniform.value
      .copy(cameraPositionUniform.value)
      .applyMatrix4(
        new THREE.Matrix4().copy(ownerMatrixWorldSource.matrixWorld).invert()
      );
  }

  const binStates = options.bins.map((binConfig) => {
    const buffers = createScatterGpuVisibleBinBuffers(
      packedInputs.sampleCount,
      candidateBuffers.scanWorkgroupCount
    );
    const mesh = new THREE.InstancedMesh(
      binConfig.geometry,
      binConfig.material,
      packedInputs.sampleCount
    );
    mesh.name = `surface-scatter:${params.layerId}:gpu:${binConfig.bin}`;
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
    mesh.count = packedInputs.sampleCount;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const visibleCountNode: any = storageAny(buffers.visibleCount, "uint", 1);
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
    const frameActiveNode: any = storageAny(
      buffers.frameActive,
      "uint",
      packedInputs.sampleCount
    );
    const localOffsetsNode: any = storageAny(
      buffers.localOffsets,
      "uint",
      packedInputs.sampleCount
    );
    const workgroupPartialsNode: any = storageAny(
      buffers.workgroupPartials,
      "uint",
      candidateBuffers.scanWorkgroupCount
    );
    const workgroupOffsetsNode: any = storageAny(
      buffers.workgroupOffsets,
      "uint",
      candidateBuffers.scanWorkgroupCount
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const indexedGeometry = binConfig.geometry.index !== null;
    const indexCountUniform = uniform(
      uint(
        indexedGeometry
          ? binConfig.geometry.index!.count
          : binConfig.geometry.getAttribute("position").count
      )
    );
    const firstIndexUniform = uniform(uint(0));
    const lodBinUniform = uniform(
      uint(binConfig.bin === "near" ? 1 : binConfig.bin === "far" ? 2 : 3)
    );

    const initIndirectArgsCompute = Fn(() => {
      indirectArgsNode.element(uint(0)).assign(indexCountUniform);
      indirectArgsNode.element(uint(1)).assign(uint(0));
      indirectArgsNode.element(uint(2)).assign(firstIndexUniform);
      indirectArgsNode.element(uint(3)).assign(uint(0));
      indirectArgsNode.element(uint(4)).assign(uint(0));
    })()
      .compute(1)
      .setName(`Scatter Init Indirect Args (${binConfig.bin})`);

    const markVisibleCompute = Fn(() => {
      const sampleIndex = instanceIndex.toVar();
      If(sampleIndex.greaterThanEqual(sampleCountUniform), () => {
        Return();
      });

      const active = candidateActiveNode.element(sampleIndex).toVar();
      const localPosition = candidatePositionNode.element(sampleIndex).toVar();
      const localPosition4 = vec4(localPosition, 1).toVar();
      const worldPosition4 = ownerMatrixWorldUniform.mul(localPosition4).toVar();
      const worldPosition = worldPosition4.xyz.toVar();
      const clipPosition = viewProjectionUniform.mul(vec4(worldPosition, 1)).toVar();
      const radius = candidateRadiusNode.element(sampleIndex).toVar();
      const distanceToCamera = distance(worldPosition, cameraPositionUniform).toVar();
      const insideFrustum = clipPosition.w.greaterThan(float(0))
        .and(abs(clipPosition.x).lessThanEqual(clipPosition.w.add(radius)))
        .and(abs(clipPosition.y).lessThanEqual(clipPosition.w.add(radius)))
        .and(clipPosition.z.greaterThanEqual(radius.negate()))
        .and(clipPosition.z.lessThanEqual(clipPosition.w.add(radius)));
      const insideDistance = distanceToCamera.lessThanEqual(maxDrawDistanceUniform);

      const visible = uint(0).toVar();
      If(
        active.notEqual(uint(0)).and(insideFrustum).and(insideDistance),
        () => {
          const halfTransition = lodTransitionWidthUniform.mul(float(0.5)).toVar();
          const lod1Blend = clamp(
            distanceToCamera
              .sub(lod1DistanceUniform.sub(halfTransition))
              .div(max(lodTransitionWidthUniform, float(0.0001))),
            float(0),
            float(1)
          ).toVar();
          const lod1Smooth = lod1Blend
            .mul(lod1Blend)
            .mul(float(3).sub(lod1Blend.mul(float(2))))
            .toVar();
          const lod2Blend = clamp(
            distanceToCamera
              .sub(lod2DistanceUniform.sub(halfTransition))
              .div(max(lodTransitionWidthUniform, float(0.0001))),
            float(0),
            float(1)
          ).toVar();
          const lod2Smooth = lod2Blend
            .mul(lod2Blend)
            .mul(float(3).sub(lod2Blend.mul(float(2))))
            .toVar();
          const keepAfterLod1 = float(1)
            .add(float(LOD1_KEEP_RATIO - 1).mul(lod1Smooth))
            .toVar();
          const keepProbability = keepAfterLod1
            .add(float(LOD2_KEEP_RATIO).sub(keepAfterLod1).mul(lod2Smooth))
            .toVar();

          const selectedBin = uint(1).toVar();
          If(
            hasBillboardBinUniform.equal(uint(1)).and(
              distanceToCamera.greaterThanEqual(distantMeshThresholdUniform)
            ),
            () => {
              selectedBin.assign(uint(3));
            }
          ).ElseIf(
            hasFarBinUniform.equal(uint(1)).and(
              distanceToCamera.greaterThanEqual(lod1DistanceUniform)
            ),
            () => {
              selectedBin.assign(uint(2));
            }
          ).Else(() => {
            selectedBin.assign(uint(1));
          });

          const bandSeed = float(11).toVar();
          If(lodBinUniform.equal(uint(2)), () => {
            bandSeed.assign(lodFarBandSeedUniform);
          }).ElseIf(lodBinUniform.equal(uint(3)), () => {
            bandSeed.assign(lodBillboardBandSeedUniform);
          }).Else(() => {
            bandSeed.assign(lodNearBandSeedUniform);
          });
          const keepRandom = fract(
            sin(
              sampleIndex.toFloat().mul(float(12.9898)).add(
                bandSeed.mul(float(78.233))
              )
            ).mul(float(43758.5453))
          ).toVar();

          visible.assign(
            selectedBin
              .equal(lodBinUniform)
              .and(keepRandom.lessThanEqual(keepProbability))
              .select(uint(1), uint(0))
          );
        }
      );

      frameActiveNode.element(sampleIndex).assign(visible);
    })()
      .compute(packedInputs.sampleCount, [SCATTER_SCAN_WORKGROUP_SIZE])
      .setName(`Scatter Mark Visible (${binConfig.bin})`);

    const scanLocalCompute = Fn(() => {
      const tid = instanceIndex.toVar();
      const lid = invocationLocalIndex.toVar();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       * Three TSL's workgroupId typing does not expose swizzle accessors. */
      const wgid = (workgroupId as any).x.toVar();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       * TSL workgroup arrays collapse to `any` for element access here. */
      const scratch: any = workgroupArray("uint", SCATTER_SCAN_WORKGROUP_SIZE);
      const flag = uint(0).toVar();
      If(tid.lessThan(sampleCountUniform), () => {
        flag.assign(frameActiveNode.element(tid));
      });
      scratch.element(lid).assign(flag);
      workgroupBarrier();
      emitWorkgroupInclusiveScan(scratch, lid);
      If(tid.lessThan(sampleCountUniform), () => {
        const inclusive = scratch.element(lid);
        localOffsetsNode.element(tid).assign(inclusive.sub(flag));
      });
      If(lid.equal(uint(SCATTER_SCAN_WORKGROUP_SIZE - 1)), () => {
        workgroupPartialsNode.element(wgid).assign(scratch.element(lid));
      });
    })()
      .compute(packedInputs.sampleCount, [SCATTER_SCAN_WORKGROUP_SIZE])
      .setName(`Scatter Scan Local (${binConfig.bin})`);

    const scanPartialsCompute = Fn(() => {
      const lid = invocationLocalIndex.toVar();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       * TSL workgroup arrays collapse to `any` for element access here. */
      const scratch: any = workgroupArray("uint", SCATTER_SCAN_WORKGROUP_SIZE);
      const partial = uint(0).toVar();
      If(lid.lessThan(scanWorkgroupCountUniform), () => {
        partial.assign(workgroupPartialsNode.element(lid));
      });
      scratch.element(lid).assign(partial);
      workgroupBarrier();
      emitWorkgroupInclusiveScan(scratch, lid);
      If(lid.lessThan(scanWorkgroupCountUniform), () => {
        const inclusive = scratch.element(lid);
        workgroupOffsetsNode.element(lid).assign(inclusive.sub(partial));
      });
      If(lid.equal(uint(0)), () => {
        const total = scratch.element(uint(SCATTER_SCAN_WORKGROUP_SIZE - 1));
        visibleCountNode.element(uint(0)).assign(total);
        indirectArgsNode.element(uint(1)).assign(total);
      });
    })()
      .compute(SCATTER_SCAN_WORKGROUP_SIZE, [SCATTER_SCAN_WORKGROUP_SIZE])
      .setName(`Scatter Scan Partials (${binConfig.bin})`);

    const scatterCompactCompute = Fn(() => {
      const tid = instanceIndex.toVar();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
       * Three TSL's workgroupId typing does not expose swizzle accessors. */
      const wgid = (workgroupId as any).x.toVar();
      If(tid.greaterThanEqual(sampleCountUniform), () => {
        Return();
      });
      const flag = frameActiveNode.element(tid).toVar();
      If(flag.equal(uint(0)), () => {
        Return();
      });
      const outputIdx = workgroupOffsetsNode
        .element(wgid)
        .add(localOffsetsNode.element(tid))
        .toVar();
      if (binConfig.bin === "billboard") {
        const localPosition = candidatePositionNode.element(tid).toVar();
        const sampleNormal = normalize(sampleNormalsNode.element(tid)).toVar();
        const liftedLocalPosition = localPosition
          .add(sampleNormal.mul(float(0.01)))
          .toVar();
        const toCamera = cameraLocalPositionUniform
          .sub(liftedLocalPosition)
          .toVar();
        const forward = normalize(
          toCamera.sub(sampleNormal.mul(dot(toCamera as never, sampleNormal as never)))
        ).toVar();
        const right = normalize(cross(sampleNormal as never, forward as never)).toVar();
        const billboardForward = normalize(cross(right as never, sampleNormal as never)).toVar();
        const baseScale = scaleMinUniform.add(
          scaleRangeUniform.mul(nodeHash01(layerSeedUniform.add(tid).add(float(3))))
        ).toVar();
        const verticalScale = baseScale.mul(
          float(1).add(
            nodeHash01(layerSeedUniform.add(tid).add(float(4)))
              .mul(float(2))
              .sub(float(1))
              .mul(verticalScaleJitterUniform)
          )
        ).toVar();
        visibleMatrixNode.element(outputIdx).assign(
          mat4(
            vec4(right.mul(baseScale), 0),
            vec4(sampleNormal.mul(verticalScale), 0),
            vec4(billboardForward.mul(baseScale), 0),
            vec4(liftedLocalPosition, 1)
          )
        );
      } else {
        visibleMatrixNode.element(outputIdx).assign(candidateMatrixNode.element(tid));
      }
      visibleColorNode.element(outputIdx).assign(candidateColorNode.element(tid));
      const localPosition = candidatePositionNode.element(tid).toVar();
      const worldPosition4 = ownerMatrixWorldUniform.mul(vec4(localPosition, 1));
      visibleOriginNode
        .element(outputIdx)
        .assign(vec2(worldPosition4.x, worldPosition4.z));
    })()
      .compute(packedInputs.sampleCount, [SCATTER_SCAN_WORKGROUP_SIZE])
      .setName(`Scatter Compact (${binConfig.bin})`);

    return {
      bin: binConfig.bin,
      mesh,
      buffers,
      initIndirectArgsCompute,
      markVisibleCompute,
      scanLocalCompute,
      scanPartialsCompute,
      scatterCompactCompute,
      indirectArgsInitialized: false
    };
  });

  const ownerMatrixWorldSource = binStates[0]?.mesh ?? ownerObject;

  return {
    bins: binStates.map((state) => ({
      bin: state.bin,
      mesh: state.mesh,
      buffers: state.buffers
    })),
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

      updateCullingUniforms(camera, ownerMatrixWorldSource);
      for (const state of binStates) {
        if (!state.indirectArgsInitialized) {
          renderer.compute(state.initIndirectArgsCompute);
          state.indirectArgsInitialized = true;
        }
        renderer.compute(state.markVisibleCompute);
        renderer.compute(state.scanLocalCompute);
        renderer.compute(state.scanPartialsCompute);
        renderer.compute(state.scatterCompactCompute);
      }
      lastPreparedFrameByCamera.set(cameraKey, frameId);
    },
    dispose() {
      buildCandidatesCompute.dispose();
      candidateBuffers.dispose();
      for (const state of binStates) {
        state.initIndirectArgsCompute.dispose();
        state.markVisibleCompute.dispose();
        state.scanLocalCompute.dispose();
        state.scanPartialsCompute.dispose();
        state.scatterCompactCompute.dispose();
        state.buffers.dispose();
      }
    }
  };
}
