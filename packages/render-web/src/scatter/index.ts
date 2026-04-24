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
  Mask,
  MaskTextureDefinition,
  TextureDefinition,
  RockTypeDefinition
} from "@sugarmagic/domain";
import {
  getMaskTextureDefinition,
  getTextureDefinition,
  samplePerlinNoise2d
} from "@sugarmagic/domain";
import type { ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import type { ShaderRuntime } from "../ShaderRuntime";
import {
  createProceduralFlowerGeometry,
  createProceduralGrassGeometry,
  createProceduralRockGeometry
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

interface TextureSampleCacheEntry {
  version: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const textureSampleCache = new WeakMap<THREE.Texture, TextureSampleCacheEntry>();

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

function channelIndex(channel: "r" | "g" | "b" | "a"): number {
  switch (channel) {
    case "r":
      return 0;
    case "g":
      return 1;
    case "b":
      return 2;
    case "a":
      return 3;
  }
}

function getTextureSampleCacheEntry(
  texture: THREE.Texture
): TextureSampleCacheEntry | null {
  const cached = textureSampleCache.get(texture);
  if (cached && cached.version === texture.version) {
    return cached;
  }
  const image = texture.image;
  if (
    !image ||
    typeof document === "undefined" ||
    typeof (image as { width?: unknown }).width !== "number" ||
    typeof (image as { height?: unknown }).height !== "number"
  ) {
    return null;
  }
  const width = (image as { width: number }).width;
  const height = (image as { height: number }).height;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image as CanvasImageSource, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const entry: TextureSampleCacheEntry = {
    version: texture.version,
    width,
    height,
    data: imageData.data
  };
  textureSampleCache.set(texture, entry);
  return entry;
}

function sampleTextureChannel(
  texture: THREE.Texture,
  uv: [number, number],
  channel: "r" | "g" | "b" | "a"
): number | null {
  const entry = getTextureSampleCacheEntry(texture);
  if (!entry) {
    return null;
  }
  const wrappedU = ((uv[0] % 1) + 1) % 1;
  const wrappedV = ((uv[1] % 1) + 1) % 1;
  const pixelX = Math.min(entry.width - 1, Math.max(0, Math.floor(wrappedU * entry.width)));
  const pixelY = Math.min(
    entry.height - 1,
    Math.max(0, Math.floor((1 - wrappedV) * entry.height))
  );
  const offset = (pixelY * entry.width + pixelX) * 4;
  return entry.data[offset + channelIndex(channel)]! / 255;
}

function sampleDefinitionTextureMask(
  definition: TextureDefinition,
  sample: SurfaceScatterSample,
  options: SurfaceScatterBuildOptions,
  channel: "r" | "g" | "b" | "a"
): number | null {
  const texture = options.assetResolver.resolveTextureDefinition(definition);
  return sampleTextureChannel(texture, sample.uv, channel);
}

function samplePaintedMask(
  definition: MaskTextureDefinition,
  sample: SurfaceScatterSample,
  options: SurfaceScatterBuildOptions
): number | null {
  const texture = options.assetResolver.resolveMaskTextureDefinition(definition);
  return sampleTextureChannel(texture, sample.uv, "r");
}

function evaluateScatterMask(
  mask: Mask,
  sample: SurfaceScatterSample,
  options: SurfaceScatterBuildOptions,
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
    case "perlin-noise": {
      const noise = samplePerlinNoise2d({
        x: (sample.uv[0] + mask.offset[0]) * mask.scale,
        y: (sample.uv[1] + mask.offset[1]) * mask.scale
      });
      return smoothstep(mask.threshold - mask.fade, mask.threshold + mask.fade, noise);
    }
    case "voronoi": {
      const x = sample.uv[0] / Math.max(mask.cellSize, 0.001);
      const y = sample.uv[1] / Math.max(mask.cellSize, 0.001);
      const fractX = x - Math.floor(x);
      const fractY = y - Math.floor(y);
      const edgeDistance = Math.min(
        Math.min(fractX, 1 - fractX),
        Math.min(fractY, 1 - fractY)
      );
      return 1 - smoothstep(0, Math.max(mask.borderWidth, 0.0001), edgeDistance);
    }
    case "world-position-gradient": {
      const axisValue =
        mask.axis === "x"
          ? sample.position[0]
          : mask.axis === "y"
            ? sample.position[1]
            : sample.position[2];
      return smoothstep(mask.min - mask.fade, mask.max + mask.fade, axisValue);
    }
    case "fresnel": {
      const dotUp = Math.max(
        0,
        Math.min(
          1,
          sample.normal[0] * 0 + sample.normal[1] * 1 + sample.normal[2] * 0
        )
      );
      return Math.pow(1 - dotUp, Math.max(mask.power, 0.0001)) * mask.strength;
    }
    case "texture": {
      const definition = getTextureDefinition(
        options.contentLibrary,
        mask.textureDefinitionId
      );
      if (!definition) {
        return 0;
      }
      const sampled = sampleDefinitionTextureMask(
        definition,
        sample,
        options,
        mask.channel
      );
      if (sampled !== null) {
        return sampled;
      }
      break;
    }
    case "painted": {
      if (!mask.maskTextureId) {
        return 0;
      }
      const definition = getMaskTextureDefinition(
        options.contentLibrary,
        mask.maskTextureId
      );
      if (!definition) {
        return 0;
      }
      const sampled = samplePaintedMask(definition, sample, options);
      if (sampled !== null) {
        return sampled;
      }
      break;
    }
    default:
      break;
  }
  if (!warnedMaskKinds?.has(mask.kind)) {
    warnedMaskKinds?.add(mask.kind);
    options.logger?.warn?.("[surface-scatter] Unsupported CPU scatter mask; using zero density until the source is ready.", {
      maskKind: mask.kind
    });
  }
  return 0;
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
  const isFlowerLayer = layer.contentKind === "flowers";
  const grassDefinition = isGrassLayer
    ? (layer.definition as GrassTypeDefinition)
    : null;
  const flowerDefinition = isFlowerLayer
    ? (layer.definition as FlowerTypeDefinition)
    : null;
  const rockDefinition =
    layer.contentKind === "rocks"
      ? (layer.definition as RockTypeDefinition)
      : null;
  const geometry = isGrassLayer
    ? createProceduralGrassGeometry(grassDefinition!)
    : isFlowerLayer
      ? createProceduralFlowerGeometry(flowerDefinition!)
      : createProceduralRockGeometry(rockDefinition!);

  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  let appliedMaterial: THREE.Material = material;
  let runtimeManagedMaterial = false;

  if ((layer.appearanceBinding || layer.wind) && options.shaderRuntime) {
    appliedMaterial = options.shaderRuntime.applyShaderSet(
      {
        surface: layer.appearanceBinding,
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
            options,
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
    } else if (isFlowerLayer) {
      instanceColor.copy(
        jitterColor(
          flowerDefinition!.petalColor,
          flowerDefinition!.colorJitter,
          hash01(colorSeed) * 2 - 1
        )
      );
    } else {
      instanceColor.copy(
        jitterColor(
          rockDefinition!.color,
          rockDefinition!.colorJitter,
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
