/**
 * Scatter GPU instance buffers.
 *
 * Owns the storage-buffer lifecycle for Story 36.16. This module is the
 * single render-web owner of the raw WebGPU/Three storage attributes used by
 * the scatter compute pipeline: uploaded sample inputs, candidate buffers,
 * visible buffers, and indirect draw arguments.
 *
 * The higher-level scatter pipeline decides what gets written into these
 * buffers. This file only owns allocation, resize, typed-array upload, and
 * disposal wiring.
 */

import * as THREE from "three";
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute
} from "three/webgpu";
import type { SurfaceScatterSample } from "./index";

/**
 * Workgroup size for the per-frame scan + compaction kernels.
 *
 * WebGPU requires support for compute workgroup sizes up to 256.
 * Sizing the scan kernels at 256 lets a single second-level partials
 * scan handle up to SCAN_WORKGROUP_SIZE * SCAN_WORKGROUP_SIZE = 65,536
 * candidates per scatter layer with no recursion.
 *
 * If you raise the per-layer candidate cap above 65,536 you must also
 * extend the partials scan with another level of recursion (or use
 * subgroup intrinsics on Chrome 134+). Today's pipeline returns null
 * from createScatterComputePipeline above this ceiling — see
 * MAX_GPU_COMPACTION_CANDIDATES in compute-pipeline.ts — and the CPU
 * fallback in scatter/index.ts takes over.
 */
export const SCATTER_SCAN_WORKGROUP_SIZE = 256;

export interface PackedScatterSampleInputs {
  sampleCount: number;
  positions: Float32Array;
  normals: Float32Array;
  densityWeights: Float32Array;
}

export interface ScatterGpuCandidateBuffers {
  readonly sampleCount: number;
  /** Number of workgroups in the per-frame scan: ceil(sampleCount / SCATTER_SCAN_WORKGROUP_SIZE). */
  readonly scanWorkgroupCount: number;
  readonly samplePositions: StorageBufferAttribute;
  readonly sampleNormals: StorageBufferAttribute;
  readonly sampleDensityWeights: StorageBufferAttribute;
  readonly candidateActive: StorageBufferAttribute;
  readonly candidatePositions: StorageBufferAttribute;
  readonly candidateMatrices: StorageInstancedBufferAttribute;
  readonly candidateColors: StorageInstancedBufferAttribute;
  readonly candidateRadii: StorageBufferAttribute;
  dispose: () => void;
}

export interface ScatterGpuVisibleBinBuffers {
  readonly sampleCount: number;
  readonly scanWorkgroupCount: number;
  /**
   * Per-frame visibility flag set by the markVisible compute pass.
   * `1` if the candidate passed frustum + distance + density culling
   * for the current camera, else `0`. Distinct from `candidateActive`,
   * which is the build-time density-acceptance flag computed once and
   * persisted across frames.
   */
  readonly frameActive: StorageBufferAttribute;
  /**
   * Per-thread exclusive offset within its workgroup, written by the
   * scanLocal pass. Combined with workgroupOffsets[wgid] in the
   * scatterCompact pass to produce the final compacted output index.
   */
  readonly localOffsets: StorageBufferAttribute;
  /**
   * Per-workgroup total visible count, written by scanLocal as
   * scratch[WG-1] of the inclusive scan. Read by scanPartials.
   */
  readonly workgroupPartials: StorageBufferAttribute;
  /**
   * Per-workgroup exclusive prefix offset over workgroupPartials,
   * written by scanPartials. Tells each workgroup where its first
   * compacted output element lands in visibleMatrices/Colors/Origins.
   */
  readonly workgroupOffsets: StorageBufferAttribute;
  readonly visibleCount: StorageBufferAttribute;
  readonly visibleMatrices: StorageInstancedBufferAttribute;
  readonly visibleColors: StorageInstancedBufferAttribute;
  readonly visibleOrigins: StorageInstancedBufferAttribute;
  readonly indirectDrawArgs: IndirectStorageBufferAttribute;
  dispose: () => void;
}

function markStorageAttributeNeedsUpload(
  attribute:
    | StorageBufferAttribute
    | StorageInstancedBufferAttribute
    | IndirectStorageBufferAttribute
): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, attribute.array.length);
  attribute.needsUpdate = true;
}

export function packScatterSampleInputs(
  samples: readonly SurfaceScatterSample[],
  densityWeights: readonly number[]
): PackedScatterSampleInputs {
  const sampleCount = samples.length;
  const positions = new Float32Array(sampleCount * 3);
  const normals = new Float32Array(sampleCount * 3);
  const packedDensityWeights = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = samples[index]!;
    positions[index * 3] = sample.position[0];
    positions[index * 3 + 1] = sample.position[1];
    positions[index * 3 + 2] = sample.position[2];

    normals[index * 3] = sample.normal[0];
    normals[index * 3 + 1] = sample.normal[1];
    normals[index * 3 + 2] = sample.normal[2];

    packedDensityWeights[index] = densityWeights[index] ?? 0;
  }

  return {
    sampleCount,
    positions,
    normals,
    densityWeights: packedDensityWeights
  };
}

export function createScatterGpuCandidateBuffers(
  packedInputs: PackedScatterSampleInputs
): ScatterGpuCandidateBuffers {
  const { sampleCount } = packedInputs;

  const samplePositions = new StorageBufferAttribute(
    packedInputs.positions,
    3
  );
  const sampleNormals = new StorageBufferAttribute(
    packedInputs.normals,
    3
  );
  const sampleDensityWeights = new StorageBufferAttribute(
    packedInputs.densityWeights,
    1
  );

  const candidateActive = new StorageBufferAttribute(
    new Uint32Array(sampleCount),
    1
  );
  const candidatePositions = new StorageBufferAttribute(
    new Float32Array(sampleCount * 3),
    3
  );
  const candidateMatrices = new StorageInstancedBufferAttribute(
    new Float32Array(sampleCount * 16),
    16
  );
  const candidateColors = new StorageInstancedBufferAttribute(
    new Float32Array(sampleCount * 3),
    3
  );
  const candidateRadii = new StorageBufferAttribute(
    new Float32Array(sampleCount),
    1
  );
  const scanWorkgroupCount = Math.max(
    1,
    Math.ceil(sampleCount / SCATTER_SCAN_WORKGROUP_SIZE)
  );

  markStorageAttributeNeedsUpload(samplePositions);
  markStorageAttributeNeedsUpload(sampleNormals);
  markStorageAttributeNeedsUpload(sampleDensityWeights);

  const resourceCarrier = new THREE.BufferGeometry();
  resourceCarrier.setAttribute(
    "scatter-sample-position",
    samplePositions as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-sample-normal",
    sampleNormals as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-sample-density",
    sampleDensityWeights as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-candidate-active",
    candidateActive as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-candidate-position",
    candidatePositions as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-candidate-radius",
    candidateRadii as unknown as THREE.BufferAttribute
  );

  return {
    sampleCount,
    scanWorkgroupCount,
    samplePositions,
    sampleNormals,
    sampleDensityWeights,
    candidateActive,
    candidatePositions,
    candidateMatrices,
    candidateColors,
    candidateRadii,
    dispose() {
      resourceCarrier.dispose();
    }
  };
}

export function createScatterGpuVisibleBinBuffers(
  sampleCount: number,
  scanWorkgroupCount: number
): ScatterGpuVisibleBinBuffers {
  const frameActive = new StorageBufferAttribute(
    new Uint32Array(Math.max(1, sampleCount)),
    1
  );
  const localOffsets = new StorageBufferAttribute(
    new Uint32Array(Math.max(1, sampleCount)),
    1
  );
  const workgroupPartials = new StorageBufferAttribute(
    new Uint32Array(scanWorkgroupCount),
    1
  );
  const workgroupOffsets = new StorageBufferAttribute(
    new Uint32Array(scanWorkgroupCount),
    1
  );
  const visibleCount = new StorageBufferAttribute(new Uint32Array(1), 1);
  const visibleMatrices = new StorageInstancedBufferAttribute(
    new Float32Array(sampleCount * 16),
    16
  );
  const visibleColors = new StorageInstancedBufferAttribute(
    new Float32Array(sampleCount * 3),
    3
  );
  const visibleOrigins = new StorageInstancedBufferAttribute(
    new Float32Array(sampleCount * 2),
    2
  );
  const indirectDrawArgs = new IndirectStorageBufferAttribute(
    new Uint32Array(5),
    1
  );

  const resourceCarrier = new THREE.BufferGeometry();
  resourceCarrier.setAttribute(
    "scatter-frame-active",
    frameActive as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-local-offsets",
    localOffsets as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-workgroup-partials",
    workgroupPartials as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-workgroup-offsets",
    workgroupOffsets as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-visible-count",
    visibleCount as unknown as THREE.BufferAttribute
  );
  resourceCarrier.setAttribute(
    "scatter-indirect-args",
    indirectDrawArgs as unknown as THREE.BufferAttribute
  );

  return {
    sampleCount,
    scanWorkgroupCount,
    frameActive,
    localOffsets,
    workgroupPartials,
    workgroupOffsets,
    visibleCount,
    visibleMatrices,
    visibleColors,
    visibleOrigins,
    indirectDrawArgs,
    dispose() {
      resourceCarrier.dispose();
    }
  };
}
