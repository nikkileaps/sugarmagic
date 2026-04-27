/**
 * Shared surface-scatter realization.
 *
 * Turns a resolved scatter layer plus concrete surface samples into a rendered
 * instanced mesh. This is the single render-web implementation used by both
 * the landscape path and the Surface Library preview.
 */

import * as THREE from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import type {
  ContentLibrarySnapshot,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  LodMeshSpec,
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
  createScatterComputeLayerParams,
  createScatterComputePipeline
} from "./compute-pipeline";
import {
  type ScatterLodBin,
  type ScatterLodRuntimeParams
} from "./lod";
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
  enableGpuCompute?: boolean;
  logger?: {
    warn: (message: string, payload?: Record<string, unknown>) => void;
  };
}

export interface SurfaceScatterBuildResult {
  root: THREE.Group;
  dispose: () => void;
}

export * from "./compute-pipeline";
export * from "./instance-buffer";
export * from "./lod";

interface ScatterLodDefinitionLike {
  lodMeshes: {
    near: LodMeshSpec;
    far?: LodMeshSpec | null;
    billboard?: LodMeshSpec | null;
  };
  lod1Distance: number;
  lod2Distance: number;
  lodTransitionWidth: number;
  distantMeshThreshold: number;
  maxDrawDistance: number;
}

interface ScatterLodBinConfig {
  bin: Exclude<ScatterLodBin, "none">;
  spec: LodMeshSpec;
}

interface ScatterMaterialSetup {
  material: THREE.Material;
  runtimeManagedMaterial: boolean;
}

function scatterLodDefinitionForLayer(
  layer: ResolvedScatterLayer
): ScatterLodDefinitionLike {
  return layer.definition as ResolvedScatterLayer["definition"] & ScatterLodDefinitionLike;
}

function scatterLodParamsForLayer(layer: ResolvedScatterLayer): ScatterLodRuntimeParams {
  const lod = scatterLodDefinitionForLayer(layer);
  return {
    lod1Distance: lod.lod1Distance,
    lod2Distance: lod.lod2Distance,
    lodTransitionWidth: lod.lodTransitionWidth,
    distantMeshThreshold: lod.distantMeshThreshold,
    maxDrawDistance: lod.maxDrawDistance,
    hasFarBin: Boolean(lod.lodMeshes.far),
    hasBillboardBin: Boolean(lod.lodMeshes.billboard)
  };
}

function scatterLodBinConfigs(layer: ResolvedScatterLayer): ScatterLodBinConfig[] {
  const lod = scatterLodDefinitionForLayer(layer);
  const bins: ScatterLodBinConfig[] = [
    {
      bin: "near",
      spec: lod.lodMeshes.near
    }
  ];
  if (lod.lodMeshes.far) {
    bins.push({
      bin: "far",
      spec: lod.lodMeshes.far
    });
  }
  if (lod.lodMeshes.billboard) {
    bins.push({
      bin: "billboard",
      spec: lod.lodMeshes.billboard
    });
  }
  return bins;
}

function createScatterBillboardGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -0.18, 0, 0,
    0.18, 0, 0,
    -0.06, 1, 0,
    0.06, 1, 0
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0
  ]);
  const colors = new Float32Array([
    0.4, 0.6, 0.35,
    0.4, 0.6, 0.35,
    0.8, 0.9, 0.7,
    0.8, 0.9, 0.7
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0.25, 1,
    0.75, 1
  ]);
  const heights = new Float32Array([0, 0, 1, 1]);
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("_tree_height", new THREE.BufferAttribute(heights, 1));
  return geometry;
}

function createScatterGeometryForLodSpec(
  layer: ResolvedScatterLayer,
  spec: LodMeshSpec,
  options: SurfaceScatterBuildOptions
): THREE.BufferGeometry {
  if (spec.kind === "billboard") {
    return createScatterBillboardGeometry();
  }

  const geometryOptions =
    spec.kind === "procedural-reduced"
      ? {
          vertexBudget: spec.vertexBudget
        }
      : {};

  if (spec.kind === "asset-reference") {
    options.logger?.warn?.(
      "[surface-scatter] Asset-reference LOD meshes are not yet realized in render-web scatter; falling back to procedural/default geometry.",
      {
        layerId: layer.layerId,
        contentKind: layer.contentKind,
        assetDefinitionId: spec.assetDefinitionId
      }
    );
  }

  if (layer.contentKind === "grass") {
    return createProceduralGrassGeometry(
      layer.definition as GrassTypeDefinition,
      geometryOptions
    );
  }
  if (layer.contentKind === "flowers") {
    return createProceduralFlowerGeometry(
      layer.definition as FlowerTypeDefinition,
      geometryOptions
    );
  }
  return createProceduralRockGeometry(
    layer.definition as RockTypeDefinition,
    geometryOptions
  );
}

function createScatterMaterialForGeometry(
  layer: ResolvedScatterLayer,
  geometry: THREE.BufferGeometry,
  options: SurfaceScatterBuildOptions
): ScatterMaterialSetup {
  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide
  });
  let appliedMaterial: THREE.Material = material;

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
  }

  return {
    material: appliedMaterial,
    runtimeManagedMaterial: false
  };
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
  const lodBinConfigs = scatterLodBinConfigs(layer);
  const lodParams = scatterLodParamsForLayer(layer);

  const warnedMaskKinds = new Set<Mask["kind"]>();
  const densityWeights = samples.map((sample) =>
    Math.max(
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
    )
  );
  const hasAnyDensity = densityWeights.some((value) => value > 0);

  if (!hasAnyDensity) {
    return {
      root,
      dispose() {}
    };
  }

  const canUseGpuCompute = options.enableGpuCompute ?? true;
  if (canUseGpuCompute) {
    const gpuBins: Array<{
      bin: Exclude<ScatterLodBin, "none">;
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      runtimeManagedMaterial: boolean;
      mesh: THREE.InstancedMesh;
    }> = [];
    const gpuBinInputs: Array<{
      bin: Exclude<ScatterLodBin, "none">;
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      runtimeManagedMaterial: boolean;
    }> = [];

    for (const lodBinConfig of lodBinConfigs) {
      const geometry = createScatterGeometryForLodSpec(
        layer,
        lodBinConfig.spec,
        options
      );
      const materialSetup = createScatterMaterialForGeometry(
        layer,
        geometry,
        options
      );
      gpuBinInputs.push({
        bin: lodBinConfig.bin,
        geometry,
        material: materialSetup.material,
        runtimeManagedMaterial: materialSetup.runtimeManagedMaterial
      });
    }

    const sharedComputePipeline = createScatterComputePipeline({
      bins: gpuBinInputs.map((bin) => ({
        bin: bin.bin,
        geometry: bin.geometry,
        material: bin.material
      })),
      samples,
      densityWeights,
      params: createScatterComputeLayerParams(layer, gpuBinInputs[0]!.geometry, {
        maxDrawDistance: lodParams.maxDrawDistance
      })
    });

    if (sharedComputePipeline && sharedComputePipeline.bins.length > 0) {
      for (const [index, computeBin] of sharedComputePipeline.bins.entries()) {
        const gpuBinInput = gpuBinInputs[index]!;
        const scatterMesh = computeBin.mesh;
        scatterMesh.name = `${root.name}:${gpuBinInput.bin}`;
        scatterMesh.onBeforeRender = (renderer, _scene, camera) => {
          if (renderer instanceof WebGPURenderer) {
            sharedComputePipeline.prepareForRender(renderer, camera);
          }
        };
        root.add(scatterMesh);
        gpuBins.push({
          ...gpuBinInput,
          mesh: scatterMesh
        });
      }

      return {
        root,
        dispose() {
          for (const gpuBin of gpuBins) {
            root.remove(gpuBin.mesh);
            gpuBin.geometry.dispose();
            if (gpuBin.runtimeManagedMaterial && options.shaderRuntime) {
              options.shaderRuntime.releaseMaterial(gpuBin.material);
            } else {
              gpuBin.material.dispose();
            }
          }
          sharedComputePipeline.dispose();
        }
      };
    }

    for (const gpuBinInput of gpuBinInputs) {
      gpuBinInput.geometry.dispose();
      if (gpuBinInput.runtimeManagedMaterial && options.shaderRuntime) {
        options.shaderRuntime.releaseMaterial(gpuBinInput.material);
      } else {
        gpuBinInput.material.dispose();
      }
    }

    options.logger?.warn?.(
      "[surface-scatter] GPU scatter LOD unavailable for this layer; falling back to CPU near-mesh instancing.",
      {
        layerId: layer.layerId,
        contentKind: layer.contentKind
      }
    );
  }

  const nearGeometry = createScatterGeometryForLodSpec(
    layer,
    lodBinConfigs[0]!.spec,
    options
  );
  const nearMaterialSetup = createScatterMaterialForGeometry(
    layer,
    nearGeometry,
    options
  );
  const acceptedSamples: SurfaceScatterSample[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const densityScale = densityWeights[index] ?? 0;
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
        nearGeometry.dispose();
        if (nearMaterialSetup.runtimeManagedMaterial && options.shaderRuntime) {
          options.shaderRuntime.releaseMaterial(nearMaterialSetup.material);
        } else {
          nearMaterialSetup.material.dispose();
        }
      }
    };
  }

  const instancedMesh = new THREE.InstancedMesh(
    nearGeometry,
    nearMaterialSetup.material,
    acceptedSamples.length
  );
  instancedMesh.name = `${root.name}:instances`;
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  // Per-instance world-XZ origin. Each blade (instance) carries its own
  // placement in world space so vertex-stage shaders (wind sway, etc.)
  // can vary their phase across the field. We bake this as a custom
  // InstancedBufferAttribute because TSL's positionWorld in vertex
  // stage doesn't include the per-instance matrix on our NodeMaterial
  // path — it evaluates to the same value for every blade, which is why
  // wind looked like a metronome instead of a wave sweeping across the
  // field. With this attribute, the wind shader reads each blade's own
  // world XZ and produces real spatial variation.
  const instanceOriginData = new Float32Array(acceptedSamples.length * 2);
  for (let index = 0; index < acceptedSamples.length; index += 1) {
    const sample = acceptedSamples[index]!;
    instanceOriginData[index * 2] = sample.position[0];
    instanceOriginData[index * 2 + 1] = sample.position[2];
  }
  const instanceOriginAttribute = new THREE.InstancedBufferAttribute(
    instanceOriginData,
    2
  );
  nearGeometry.setAttribute("instanceOrigin", instanceOriginAttribute);

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
      nearGeometry.dispose();
      if (nearMaterialSetup.runtimeManagedMaterial && options.shaderRuntime) {
        options.shaderRuntime.releaseMaterial(nearMaterialSetup.material);
      } else {
        nearMaterialSetup.material.dispose();
      }
    }
  };
}
