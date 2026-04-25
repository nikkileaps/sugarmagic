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

export interface PackedScatterSampleInputs {
  sampleCount: number;
  positions: Float32Array;
  normals: Float32Array;
  densityWeights: Float32Array;
}

export interface ScatterGpuInstanceBuffers {
  readonly sampleCount: number;
  readonly samplePositions: StorageBufferAttribute;
  readonly sampleNormals: StorageBufferAttribute;
  readonly sampleDensityWeights: StorageBufferAttribute;
  readonly candidateActive: StorageBufferAttribute;
  readonly candidatePositions: StorageBufferAttribute;
  readonly candidateMatrices: StorageInstancedBufferAttribute;
  readonly candidateColors: StorageInstancedBufferAttribute;
  readonly candidateRadii: StorageBufferAttribute;
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

export function createScatterGpuInstanceBuffers(
  packedInputs: PackedScatterSampleInputs
): ScatterGpuInstanceBuffers {
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
    samplePositions,
    sampleNormals,
    sampleDensityWeights,
    candidateActive,
    candidatePositions,
    candidateMatrices,
    candidateColors,
    candidateRadii,
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
