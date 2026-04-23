/**
 * Shared surface-scatter realization.
 *
 * Turns a resolved scatter layer plus concrete surface samples into a rendered
 * instanced mesh. This is the single render-web implementation used by both
 * the landscape path and the Surface Library preview.
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type {
  ContentLibrarySnapshot,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Mask
} from "@sugarmagic/domain";
import type { ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import type { ShaderRuntime } from "../ShaderRuntime";
import {
  createProceduralFlowerGeometry,
  createProceduralGrassGeometry
} from "./procedural";

export interface SurfaceScatterSample {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  height: number;
  coverageWeight?: number;
  splatmapWeights?: readonly number[] | null;
  vertexColor?: readonly [number, number, number, number] | null;
}

export interface SurfaceScatterBuildOptions {
  contentLibrary: ContentLibrarySnapshot;
  assetResolver: AuthoredAssetResolver;
  shaderRuntime?: ShaderRuntime | null;
  logger?: {
    warn: (message: string, payload?: Record<string, unknown>) => void;
  };
}

export interface SurfaceScatterBuildResult {
  root: THREE.Group;
  dispose: () => void;
}

function smoothstep(min: number, max: number, value: number): number {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function hashVectorSeed(
  layerId: string,
  sample: SurfaceScatterSample,
  salt: number
): number {
  let seed = salt;
  for (let index = 0; index < layerId.length; index += 1) {
    seed += layerId.charCodeAt(index) * (index + 1);
  }
  seed +=
    sample.position[0] * 13.17 +
    sample.position[1] * 7.31 +
    sample.position[2] * 19.91 +
    sample.uv[0] * 97.17 +
    sample.uv[1] * 43.11;
  return seed;
}

function jitterColor(
  color: number,
  amount: number,
  jitter: number
): THREE.Color {
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

function evaluateScatterMask(
  mask: Mask,
  sample: SurfaceScatterSample,
  logger?: SurfaceScatterBuildOptions["logger"],
  warnedMaskKinds?: Set<Mask["kind"]>
): number {
  switch (mask.kind) {
    case "always":
      return 1;
    case "height":
      return smoothstep(mask.min - mask.fade, mask.max + mask.fade, sample.height);
    case "splatmap-channel":
      return sample.splatmapWeights?.[mask.channelIndex] ?? 1;
    case "vertex-color-channel": {
      const channelIndex = { r: 0, g: 1, b: 2, a: 3 }[mask.channel];
      return sample.vertexColor?.[channelIndex] ?? 1;
    }
    case "texture":
    case "fresnel":
      if (!warnedMaskKinds?.has(mask.kind)) {
        warnedMaskKinds?.add(mask.kind);
        logger?.warn?.("[surface-scatter] Unsupported Stage 1 scatter mask; using full density.", {
          maskKind: mask.kind
        });
      }
      return 1;
  }
}

export function buildSurfaceScatterLayer(
  layer: ResolvedScatterLayer,
  samples: readonly SurfaceScatterSample[],
  options: SurfaceScatterBuildOptions
): SurfaceScatterBuildResult {
  const root = new THREE.Group();
  root.name = `surface-scatter:${layer.layerId}`;

  if (!layer.enabled || samples.length === 0) {
    return {
      root,
      dispose() {}
    };
  }

  const isGrassLayer = layer.contentKind === "grass";
  const grassDefinition = isGrassLayer
    ? (layer.definition as GrassTypeDefinition)
    : null;
  const flowerDefinition = isGrassLayer
    ? null
    : (layer.definition as FlowerTypeDefinition);
  const geometry = isGrassLayer
    ? createProceduralGrassGeometry(grassDefinition!)
    : createProceduralFlowerGeometry(flowerDefinition!);

  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  let appliedMaterial: THREE.Material = material;
  let runtimeManagedMaterial = false;

  if (layer.wind && options.shaderRuntime) {
    appliedMaterial = options.shaderRuntime.applyShaderSet(
      {
        surface: null,
        deform: layer.wind,
        effect: null
      },
      {
        material,
        geometry
      }
    );
    runtimeManagedMaterial = true;
  }

  const acceptedSamples: SurfaceScatterSample[] = [];
  const warnedMaskKinds = new Set<Mask["kind"]>();
  for (const sample of samples) {
    const densityScale = Math.max(
      0,
      Math.min(
        1,
        (sample.coverageWeight ?? 1) *
          evaluateScatterMask(
            layer.mask,
            sample,
            options.logger,
            warnedMaskKinds
          ) *
          layer.opacity
      )
    );
    if (densityScale <= 0) {
      continue;
    }
    const acceptSeed = hashVectorSeed(layer.layerId, sample, 1);
    if (hash01(acceptSeed) <= densityScale) {
      acceptedSamples.push(sample);
    }
  }

  if (acceptedSamples.length === 0) {
    return {
      root,
      dispose() {
        geometry.dispose();
        if (runtimeManagedMaterial && options.shaderRuntime) {
          options.shaderRuntime.releaseMaterial(appliedMaterial);
        } else {
          appliedMaterial.dispose();
        }
      }
    };
  }

  const instancedMesh = new THREE.InstancedMesh(
    geometry,
    appliedMaterial,
    acceptedSamples.length
  );
  instancedMesh.name = `${root.name}:instances`;
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  const up = new THREE.Vector3(0, 1, 0);
  const samplePosition = new THREE.Vector3();
  const sampleNormal = new THREE.Vector3();
  const alignRotation = new THREE.Quaternion();
  const spinRotation = new THREE.Quaternion();
  const composedRotation = new THREE.Quaternion();
  const instanceMatrix = new THREE.Matrix4();
  const instanceScale = new THREE.Vector3(1, 1, 1);
  const instanceColor = new THREE.Color();

  for (let index = 0; index < acceptedSamples.length; index += 1) {
    const sample = acceptedSamples[index]!;
    samplePosition.fromArray(sample.position);
    sampleNormal.fromArray(sample.normal).normalize();
    alignRotation.setFromUnitVectors(up, sampleNormal);

    const rotationSeed = hashVectorSeed(layer.layerId, sample, 2);
    const rotationJitter = layer.definition.rotationJitter;
    spinRotation.setFromAxisAngle(
      sampleNormal,
      (hash01(rotationSeed) - 0.5) * Math.PI * 2 * rotationJitter
    );
    composedRotation.copy(alignRotation).multiply(spinRotation);

    const scaleSeed = hashVectorSeed(layer.layerId, sample, 3);
    const heightSeed = hashVectorSeed(layer.layerId, sample, 4);
    const colorSeed = hashVectorSeed(layer.layerId, sample, 5);
    const scaleRange = layer.definition.scaleJitter;
    const baseScale =
      scaleRange[0] + (scaleRange[1] - scaleRange[0]) * hash01(scaleSeed);
    const verticalScale =
      layer.contentKind === "grass"
        ? baseScale *
          (1 +
            (hash01(heightSeed) * 2 - 1) *
              Math.max(0, grassDefinition!.heightJitter))
        : baseScale;
    instanceScale.set(baseScale, verticalScale, baseScale);
    samplePosition.addScaledVector(sampleNormal, 0.01);
    instanceMatrix.compose(samplePosition, composedRotation, instanceScale);
    instancedMesh.setMatrixAt(index, instanceMatrix);

    if (isGrassLayer) {
      instanceColor.copy(
        jitterColor(
          grassDefinition!.tipColor,
          grassDefinition!.colorJitter,
          hash01(colorSeed) * 2 - 1
        )
      );
    } else {
      instanceColor.copy(
        jitterColor(
          flowerDefinition!.petalColor,
          flowerDefinition!.colorJitter,
          hash01(colorSeed) * 2 - 1
        )
      );
    }
    instancedMesh.setColorAt(index, instanceColor);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }
  root.add(instancedMesh);

  return {
    root,
    dispose() {
      root.remove(instancedMesh);
      geometry.dispose();
      if (runtimeManagedMaterial && options.shaderRuntime) {
        options.shaderRuntime.releaseMaterial(appliedMaterial);
      } else {
        appliedMaterial.dispose();
      }
    }
  };
}
