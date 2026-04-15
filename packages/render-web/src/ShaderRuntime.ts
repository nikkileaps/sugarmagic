/**
 * Web ShaderRuntime.
 *
 * Owns the shared Three/WebGPU shader lifecycle: compile caching, TSL
 * finalization, material template reuse, and post-process composition.
 * runtime-core resolves authored meaning into effective bindings; this module
 * is the single enforcer that turns those bindings into concrete web materials
 * and nodes for both Studio and published web hosts.
 */

import * as THREE from "three";
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial
} from "three/webgpu";
import {
  acesFilmicToneMapping,
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  luminance,
  max,
  min,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  screenUV,
  sin,
  time,
  deltaTime,
  uv,
  vec2,
  vec3,
  vec4,
  vertexColor,
  normalize,
  pow,
  reinhardToneMapping,
  saturate,
  smoothstep,
  uniform,
  viewportLinearDepth
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type {
  ContentLibrarySnapshot,
  ShaderGraphDocument
} from "@sugarmagic/domain";
import { getShaderDefinition } from "@sugarmagic/domain";
import type {
  EffectiveShaderBinding,
  RuntimeCompileProfile,
  ShaderIR,
  ShaderIRDiagnostic,
  ShaderIROp,
  ShaderIRValue
} from "@sugarmagic/runtime-core";
import { compileShaderGraph } from "@sugarmagic/runtime-core";
import type { RuntimeRenderPipeline } from "./render";

export type ShaderApplyTarget =
  | {
      targetKind: "mesh-surface" | "mesh-deform";
      material: THREE.Material;
      geometry: THREE.BufferGeometry;
    }
  | {
      targetKind: "billboard-surface";
      material: MeshBasicNodeMaterial;
      geometry: THREE.BufferGeometry | null;
    }
  | {
      targetKind: "post-process";
      renderPipeline: RuntimeRenderPipeline;
      previousOutputNode?: unknown | null;
    };

interface ShaderRuntimeOptions {
  contentLibrary: ContentLibrarySnapshot;
  compileProfile: RuntimeCompileProfile;
  materialDisposalGraceMs?: number;
  logger?: {
    warn: (message: string, payload?: Record<string, unknown>) => void;
  };
}

interface CachedMaterialEntry {
  cacheKey: string;
  shaderDefinitionId: string;
  material: THREE.Material;
  refCount: number;
  retired: boolean;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

interface FinalizationContext {
  ir: ShaderIR;
  target: ShaderApplyTarget;
  parameterValues: Record<string, unknown>;
  opMap: Map<string, ShaderIROp>;
  opNodeCache: Map<string, unknown>;
  builtinSceneColorNode: unknown | null;
  builtinSceneDepthNode: unknown | null;
  /**
   * Per-binding cache of uniform TSL nodes for parameters. Keyed by
   * parameterId. Reused across applyShader calls for the same binding so that
   * parameter value changes flow through as GPU uniform updates instead of
   * baking new constants into a newly-compiled shader each time. Without this,
   * live-editing fog density (or any other post-process parameter) in Studio
   * had no visible effect because the shader held the old density as a
   * compiled literal. See uniformForParameter() below.
   */
  parameterUniforms: Map<string, UniformNodeLike>;
}

interface UniformNodeLike {
  value: unknown;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function textureSignature(texture: THREE.Texture | null | undefined): string {
  if (!texture) {
    return "none";
  }

  return (
    (texture.source.data as { uuid?: string } | null | undefined)?.uuid ??
    (texture.source as { uuid?: string }).uuid ??
    texture.uuid ??
    texture.name ??
    "texture"
  );
}

function materialCarrierSignature(
  material: THREE.Material,
  geometry: THREE.BufferGeometry | null
): string {
  if (material instanceof THREE.MeshStandardMaterial) {
    return stableStringify({
      kind: "mesh-standard",
      color: material.color.getHexString(),
      emissive: material.emissive.getHexString(),
      roughness: material.roughness,
      metalness: material.metalness,
      transparent: material.transparent,
      alphaTest: material.alphaTest,
      side: material.side,
      vertexColors: material.vertexColors,
      map: textureSignature(material.map),
      alphaMap: textureSignature(material.alphaMap),
      emissiveMap: textureSignature(material.emissiveMap),
      normalMap: textureSignature(material.normalMap),
      hasColorAttribute: Boolean(geometry?.getAttribute("color"))
    });
  }

  if (material instanceof MeshStandardNodeMaterial) {
    return stableStringify({
      kind: "mesh-standard-node",
      color: material.color.getHexString(),
      emissive: material.emissive.getHexString(),
      roughness: material.roughness,
      metalness: material.metalness,
      transparent: material.transparent,
      alphaTest: material.alphaTest,
      side: material.side,
      vertexColors: material.vertexColors,
      map: textureSignature(material.map),
      alphaMap: textureSignature(material.alphaMap),
      emissiveMap: textureSignature(material.emissiveMap),
      normalMap: textureSignature(material.normalMap),
      hasColorAttribute: Boolean(geometry?.getAttribute("color"))
    });
  }

  if (material instanceof MeshBasicNodeMaterial) {
    return stableStringify({
      kind: "mesh-basic-node",
      color: material.color.getHexString(),
      transparent: material.transparent,
      alphaTest: material.alphaTest,
      side: material.side,
      map: textureSignature(material.map),
      alphaMap: textureSignature(material.alphaMap),
      hasColorAttribute: Boolean(geometry?.getAttribute("color"))
    });
  }

  return stableStringify({
    kind: material.type,
    name: material.name,
    transparent: "transparent" in material ? material.transparent : false,
    side: "side" in material ? material.side : THREE.FrontSide,
    hasColorAttribute: Boolean(geometry?.getAttribute("color"))
  });
}

function copySharedMaterialProps(
  source: THREE.Material,
  target: THREE.Material
): void {
  target.name = source.name;
  target.side = source.side;
  target.transparent = source.transparent;
  target.depthWrite = source.depthWrite;
  target.depthTest = source.depthTest;
  target.alphaTest = source.alphaTest;
  target.opacity = source.opacity;
  target.toneMapped = source.toneMapped;
  target.visible = source.visible;
}

function toMeshStandardNodeMaterial(
  material: THREE.Material
): MeshStandardNodeMaterial {
  if (material instanceof MeshStandardNodeMaterial) {
    return material;
  }

  const target = new MeshStandardNodeMaterial();
  copySharedMaterialProps(material, target);

  if (material instanceof THREE.MeshStandardMaterial) {
    target.color.copy(material.color);
    target.emissive.copy(material.emissive);
    target.roughness = material.roughness;
    target.metalness = material.metalness;
    target.map = material.map;
    target.alphaMap = material.alphaMap;
    target.emissiveMap = material.emissiveMap;
    target.normalMap = material.normalMap;
    target.vertexColors = material.vertexColors;
    target.flatShading = material.flatShading;
  }

  target.needsUpdate = true;
  return target;
}

function toMeshBasicNodeMaterial(
  material: THREE.Material
): MeshBasicNodeMaterial {
  if (material instanceof MeshBasicNodeMaterial) {
    return material;
  }

  const target = new MeshBasicNodeMaterial();
  copySharedMaterialProps(material, target);

  if (material instanceof THREE.MeshBasicMaterial) {
    target.color.copy(material.color);
    target.map = material.map;
    target.alphaMap = material.alphaMap;
    target.vertexColors = material.vertexColors;
  } else if (material instanceof THREE.MeshStandardMaterial) {
    target.color.copy(material.color);
    target.map = material.map;
    target.alphaMap = material.alphaMap;
    target.vertexColors = material.vertexColors;
  }

  target.needsUpdate = true;
  return target;
}

function literalNode(dataType: ShaderIRValue["dataType"], value: unknown): unknown {
  switch (dataType) {
    case "float":
      return float(typeof value === "number" ? value : 0);
    case "vec2":
      return Array.isArray(value) ? vec2(value[0] ?? 0, value[1] ?? 0) : vec2(0, 0);
    case "vec3":
    case "color":
      return Array.isArray(value)
        ? vec3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
        : vec3(0, 0, 0);
    case "vec4":
      return Array.isArray(value)
        ? vec4(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0)
        : vec4(0, 0, 0, 0);
    case "bool":
      return float(value ? 1 : 0);
    case "texture2d":
      return float(0);
    default:
      return float(0);
  }
}

function getVertexColorNode(
  geometry: THREE.BufferGeometry | null,
  fallback: [number, number, number, number]
): unknown {
  if (!geometry?.getAttribute("color")) {
    return vec4(...fallback);
  }
  return vertexColor();
}

function materializeBuiltin(
  value: Extract<ShaderIRValue, { kind: "builtin" }>,
  context: FinalizationContext
): unknown {
  const asColorNode = (node: unknown): unknown => {
    if (node && typeof node === "object" && "rgb" in (node as Record<string, unknown>)) {
      return (node as { rgb: unknown }).rgb;
    }
    return node;
  };

  switch (value.name) {
    case "time":
      return time;
    case "deltaTime":
      return deltaTime;
    case "worldPosition":
      return positionWorld;
    case "localPosition":
      return positionLocal;
    case "worldNormal":
      return normalWorld;
    case "localNormal":
      return normalLocal;
    case "uv":
      return uv();
    case "vertexColor":
      return getVertexColorNode(
        "geometry" in context.target ? context.target.geometry : null,
        [1, 1, 1, 1]
      );
    case "vertexWindMask": {
      const channel = String(value.settings?.channel ?? "a");
      const vector = getVertexColorNode(
        "geometry" in context.target ? context.target.geometry : null,
        [0, 0, 0, 0]
      ) as { x: unknown; y: unknown; z: unknown; w: unknown };
      if (channel === "r") return vector.x;
      if (channel === "g") return vector.y;
      if (channel === "b") return vector.z;
      return vector.w;
    }
    case "cameraPosition":
      return cameraPosition;
    case "viewDirection":
      return positionViewDirection;
    case "screenUV":
      return screenUV;
    case "sceneColor":
      return asColorNode(context.builtinSceneColorNode ?? vec3(0, 0, 0));
    case "sceneDepth":
      // Explicit scene-depth node wired from the scenePass (view-space Z
      // distance, in world units). Preferred over the global
      // viewportLinearDepth because that samples whatever depth texture is
      // currently bound — observed to produce different results between
      // Studio's authoring viewport and the runtime host even with
      // otherwise-identical code. Falls back to viewportLinearDepth when no
      // explicit depth node was provided (e.g. non-post-process targets).
      return context.builtinSceneDepthNode ?? viewportLinearDepth;
    default:
      return float(0);
  }
}

function materializeValue(value: ShaderIRValue, context: FinalizationContext): unknown {
  if (value.kind === "literal") {
    return literalNode(value.dataType, value.value);
  }

  if (value.kind === "builtin") {
    return materializeBuiltin(value, context);
  }

  if (value.kind === "parameter") {
    return uniformForParameter(value.parameterId, value.dataType, context);
  }

  return materializeOp(value.opId, context);
}

/**
 * Get or create the uniform TSL node for a parameter, updating its .value to
 * the current parameterValues entry. On the first call for a given parameter,
 * a fresh uniform is created and cached in context.parameterUniforms. On
 * subsequent calls (including after re-running applyShader on the same
 * binding with new parameter values), the cached uniform is reused and its
 * .value is updated — which pushes the new value to the GPU without the
 * shader needing recompilation.
 *
 * This is what makes live parameter editing work. Without it, each
 * applyShader call would bake the parameter value into a new compiled shader
 * as a constant, and the GPU would keep using the previously-compiled shader
 * with the stale value.
 */
function uniformForParameter(
  parameterId: string,
  dataType: ShaderIRValue["dataType"],
  context: FinalizationContext
): unknown {
  const currentValue = context.parameterValues[parameterId] ?? 0;
  const existing = context.parameterUniforms.get(parameterId);
  if (existing) {
    existing.value = uniformValueFromPrimitive(dataType, currentValue);
    return existing;
  }
  const node = (uniform as unknown as (value: unknown) => UniformNodeLike)(
    uniformValueFromPrimitive(dataType, currentValue)
  );
  context.parameterUniforms.set(parameterId, node);
  return node;
}

function uniformValueFromPrimitive(
  dataType: ShaderIRValue["dataType"],
  value: unknown
): unknown {
  switch (dataType) {
    case "float":
      return typeof value === "number" ? value : 0;
    case "vec2":
      if (Array.isArray(value)) {
        return new THREE.Vector2(
          Number(value[0]) || 0,
          Number(value[1]) || 0
        );
      }
      return new THREE.Vector2(0, 0);
    case "vec3":
    case "color":
      if (Array.isArray(value)) {
        return new THREE.Vector3(
          Number(value[0]) || 0,
          Number(value[1]) || 0,
          Number(value[2]) || 0
        );
      }
      return new THREE.Vector3(0, 0, 0);
    case "vec4":
      if (Array.isArray(value)) {
        return new THREE.Vector4(
          Number(value[0]) || 0,
          Number(value[1]) || 0,
          Number(value[2]) || 0,
          Number(value[3]) || 0
        );
      }
      return new THREE.Vector4(0, 0, 0, 0);
    case "bool":
      return value ? 1 : 0;
    default:
      return typeof value === "number" ? value : 0;
  }
}

function materializeOp(opId: string, context: FinalizationContext): unknown {
  if (context.opNodeCache.has(opId)) {
    return context.opNodeCache.get(opId);
  }

  const op = context.opMap.get(opId);
  if (!op) {
    return float(0);
  }

  const input = (portId: string): unknown =>
    materializeValue(op.inputs[portId] ?? { kind: "literal", dataType: "float", value: 0 }, context);

  let result: unknown;
  switch (op.opKind) {
    case "math.add":
      result = (input("a") as { add: (other: unknown) => unknown }).add(input("b"));
      break;
    case "math.subtract":
      result = (input("a") as { sub: (other: unknown) => unknown }).sub(input("b"));
      break;
    case "math.multiply":
      result = (input("a") as { mul: (other: unknown) => unknown }).mul(input("b"));
      break;
    case "math.divide":
      result = (input("a") as { div: (other: unknown) => unknown }).div(input("b"));
      break;
    case "math.pow":
      result = pow(input("a") as never, input("b") as never);
      break;
    case "math.exp":
      result = exp(input("input") as never);
      break;
    case "math.min":
      result = min(input("a") as never, input("b") as never);
      break;
    case "math.max":
      result = max(input("a") as never, input("b") as never);
      break;
    case "math.saturate":
      result = saturate(input("input") as never);
      break;
    case "math.smoothstep":
      result = smoothstep(
        input("edge0") as never,
        input("edge1") as never,
        input("x") as never
      );
      break;
    case "math.distance":
      result = length(
        (input("a") as { sub: (other: unknown) => unknown }).sub(input("b")) as never
      );
      break;
    case "math.sin":
      result = sin(input("input") as never);
      break;
    case "math.cos":
      result = cos(input("input") as never);
      break;
    case "math.abs":
      result = abs(input("input") as never);
      break;
    case "math.clamp":
      result = clamp(input("input") as never, input("min") as never, input("max") as never);
      break;
    case "math.lerp":
      result = mix(input("a") as never, input("b") as never, input("alpha") as never);
      break;
    case "color.luminance":
      result = luminance(input("input") as never);
      break;
    case "color.add":
      result = (input("a") as { add: (other: unknown) => unknown }).add(input("b"));
      break;
    case "color.multiply":
      result = (input("a") as { mul: (other: unknown) => unknown }).mul(input("b"));
      break;
    case "color.divide":
      result = (input("a") as { div: (other: unknown) => unknown }).div(input("b"));
      break;
    case "color.pow":
      result = pow(input("a") as never, input("b") as never);
      break;
    case "math.dot":
      result = dot(input("a") as never, input("b") as never);
      break;
    case "math.normalize":
      result = normalize(input("input") as never);
      break;
    case "math.length":
      result = length(input("input") as never);
      break;
    case "math.combine-vector":
      result =
        op.dataType === "vec2"
          ? vec2(input("x") as never, input("y") as never)
          : op.dataType === "vec3"
            ? vec3(input("x") as never, input("y") as never, input("z") as never)
            : vec4(
                input("x") as never,
                input("y") as never,
                input("z") as never,
                input("w") as never
              );
      break;
    case "math.split-vector": {
      const vector = input("input") as { x: unknown; y: unknown; z: unknown; w: unknown };
      const outputPortId = String(op.settings?.outputPortId ?? "x");
      result =
        outputPortId === "y"
          ? vector.y
          : outputPortId === "z"
            ? vector.z
            : outputPortId === "w"
              ? vector.w
              : vector.x;
      break;
    }
    case "effect.height-falloff": {
      const position = input("position") as { y: unknown };
      const baseHeight = float(Number(op.settings?.baseHeight ?? 0));
      const topHeight = float(Number(op.settings?.topHeight ?? 1));
      const range = (topHeight as { sub: (other: unknown) => unknown }).sub(baseHeight);
      const normalizedHeight = ((position.y as { sub: (other: unknown) => unknown }).sub(
        baseHeight
      ) as { div: (other: unknown) => unknown }).div(range);
      result = clamp(normalizedHeight as never, float(0), float(1));
      break;
    }
    case "effect.fresnel": {
      const normal = normalize(input("normal") as never);
      const viewDirection = normalize(input("viewDirection") as never);
      const facing = clamp(dot(normal as never, viewDirection as never), float(0), float(1));
      const rim = float(1)
        .sub(facing as never)
        .pow(float(Number(op.settings?.power ?? 2)))
        .mul(float(Number(op.settings?.strength ?? 1)));
      result = (input("color") as { mul: (other: unknown) => unknown }).mul(rim);
      break;
    }
    case "effect.bloom-pass":
      result = bloom(
        input("input") as never,
        Number(op.settings?.strength ?? 0.4),
        Number(op.settings?.radius ?? 0.4),
        Number(op.settings?.threshold ?? 0.9)
      );
      break;
    case "effect.tonemap-aces": {
      const exposure =
        input("exposure") ?? float(Number(op.settings?.exposure ?? 1));
      result = acesFilmicToneMapping(
        (input("input") as { mul: (other: unknown) => unknown }).mul(exposure) as never,
        float(1)
      );
      break;
    }
    case "effect.tonemap-reinhard": {
      const exposure =
        input("exposure") ?? float(Number(op.settings?.exposure ?? 1));
      result = reinhardToneMapping(
        (input("input") as { mul: (other: unknown) => unknown }).mul(exposure) as never,
        float(1)
      );
      break;
    }
    case "effect.wind-gust": {
      const gustStrength = float(Number(op.settings?.gustStrength ?? 0.25));
      const gustInterval = float(Number(op.settings?.gustInterval ?? 3));
      const gustDuration = float(Number(op.settings?.gustDuration ?? 0.8));
      const phase = ((input("time") as { div: (other: unknown) => unknown }).div(
        gustInterval
      ) as { mul: (other: unknown) => unknown }).mul(float(Math.PI * 2));
      const pulse = clamp(sin(phase as never), float(0), float(1));
      result = pulse.mul(gustStrength).mul(gustDuration);
      break;
    }
    case "effect.wind-sway": {
      const position = input("position") as { x: unknown; z: unknown; y: unknown; add: (other: unknown) => unknown };
      const direction = normalize(input("direction") as never) as { x: unknown; y: unknown };
      const frequency =
        input("frequency") ??
        float(Number(op.settings?.frequency ?? 1.6));
      const strength =
        input("strength") ??
        float(Number(op.settings?.strength ?? 0.3));
      const spatialScale =
        input("spatialScale") ??
        float(Number(op.settings?.spatialScale ?? 0.35));
      const heightScale =
        input("heightScale") ??
        float(Number(op.settings?.heightScale ?? 1));
      const timedPhase = (input("time") as { mul: (other: unknown) => unknown }).mul(
        frequency
      ) as {
        add: (other: unknown) => unknown;
      };
      const phase = (timedPhase
        .add((position.x as { mul: (other: unknown) => unknown }).mul(spatialScale)) as {
        add: (other: unknown) => unknown;
      }).add((position.z as { mul: (other: unknown) => unknown }).mul(spatialScale));
      const heightMask = clamp(
        ((position.y as { mul: (other: unknown) => unknown }).mul(heightScale) as never),
        float(0),
        float(1)
      );
      const sway = sin(phase as never)
        .mul(strength as never)
        .mul(input("mask") as never)
        .mul(heightMask);
      result = position.add(
        vec3(
          ((direction.x as { mul: (other: unknown) => unknown }).mul(sway) as never),
          0,
          ((direction.y as { mul: (other: unknown) => unknown }).mul(sway) as never)
        )
      );
      break;
    }
    default:
      result = float(0);
      break;
  }

  context.opNodeCache.set(opId, result);
  return result;
}

function applyIRToMaterial(
  ir: ShaderIR,
  binding: EffectiveShaderBinding,
  target: Extract<ShaderApplyTarget, { targetKind: "mesh-surface" | "mesh-deform" | "billboard-surface" }>,
  parameterUniforms: Map<string, UniformNodeLike>
): THREE.Material {
  const material =
    target.targetKind === "billboard-surface"
      ? target.material
      : toMeshStandardNodeMaterial(target.material);
  const allOps =
    ir.targetKind === "mesh-deform"
      ? ir.vertexOps
      : ir.targetKind === "post-process"
        ? ir.postProcessOps
        : [...ir.vertexOps, ...ir.fragmentOps];
  const context: FinalizationContext = {
    ir,
    target,
    parameterValues: binding.parameterValues,
    opMap: new Map(allOps.map((op) => [op.opId, op])),
    opNodeCache: new Map(),
    builtinSceneColorNode: null,
    builtinSceneDepthNode: null,
    parameterUniforms: parameterUniforms
  };

  if (ir.outputs.vertex) {
    (material as MeshStandardNodeMaterial | MeshBasicNodeMaterial).positionNode =
      materializeValue(ir.outputs.vertex, context) as never;
  }
  if (ir.outputs.fragmentColor && "colorNode" in material) {
    material.colorNode = materializeValue(ir.outputs.fragmentColor, context) as never;
  }
  if (ir.outputs.fragmentAlpha && "opacityNode" in material) {
    material.opacityNode = materializeValue(ir.outputs.fragmentAlpha, context) as never;
    material.transparent = true;
  }
  if (ir.outputs.emissive && material instanceof MeshStandardNodeMaterial) {
    material.emissiveNode = materializeValue(ir.outputs.emissive, context) as never;
  }

  material.needsUpdate = true;
  return material;
}

function applyIRToPostProcess(
  ir: ShaderIR,
  binding: EffectiveShaderBinding,
  target: Extract<ShaderApplyTarget, { targetKind: "post-process" }>,
  parameterUniforms: Map<string, UniformNodeLike>
): unknown {
  const baseOutputNode =
    target.previousOutputNode ?? target.renderPipeline.getBaseOutputNode();
  if (!baseOutputNode) {
    return null;
  }

  const context: FinalizationContext = {
    ir,
    target,
    parameterValues: binding.parameterValues,
    opMap: new Map(ir.postProcessOps.map((op) => [op.opId, op])),
    opNodeCache: new Map(),
    builtinSceneColorNode: baseOutputNode,
    // Pull the authoritative scene-depth node from the pipeline. Each binding
    // in the chain reads the SAME scenePass depth — not the global viewport
    // depth, which is what broke fog in Studio but not in the runtime host.
    builtinSceneDepthNode: target.renderPipeline.getSceneDepthNode(),
    parameterUniforms: parameterUniforms
  };
  const nextOutputNode = ir.outputs.postProcessColor
    ? materializeValue(ir.outputs.postProcessColor, context)
    : baseOutputNode;
  target.renderPipeline.setPostProcessOutputNode(nextOutputNode);
  return nextOutputNode;
}

export class ShaderRuntime {
  private static readonly DEFAULT_MATERIAL_DISPOSAL_GRACE_MS = 2000;
  private contentLibrary: ContentLibrarySnapshot;
  private readonly compileProfile: RuntimeCompileProfile;
  private readonly materialDisposalGraceMs: number;
  private readonly logger;
  private readonly compileCache = new Map<string, ShaderIR>();
  private readonly materialCache = new Map<string, CachedMaterialEntry>();
  private readonly materialEntryByMaterial = new WeakMap<THREE.Material, CachedMaterialEntry>();
  private readonly materialEntries = new Set<CachedMaterialEntry>();
  private readonly diagnostics = new Map<string, ShaderIRDiagnostic[]>();
  /**
   * Persistent uniform node cache, keyed by shaderDefinitionId. Each entry is
   * a map from parameterId to the TSL uniform node for that parameter.
   * Reused across applyShader calls for the same binding so live parameter
   * edits become GPU-uniform updates, not shader recompilations. See
   * uniformForParameter() for the reasoning.
   */
  private readonly parameterUniformCache = new Map<string, Map<string, UniformNodeLike>>();
  private disposed = false;

  constructor(options: ShaderRuntimeOptions) {
    this.contentLibrary = options.contentLibrary;
    this.compileProfile = options.compileProfile;
    this.materialDisposalGraceMs =
      options.materialDisposalGraceMs ?? ShaderRuntime.DEFAULT_MATERIAL_DISPOSAL_GRACE_MS;
    this.logger = options.logger ?? { warn() {} };
  }

  /**
   * Swap the content library reference without tearing down compiled IR or
   * material caches. Existing cache keys are keyed by shaderDefinitionId +
   * documentRevision, so a new content library with the same revisions reuses
   * compiled work cleanly; revision bumps invalidate naturally on next lookup.
   *
   * This replaces the previous "dispose the runtime on every state update"
   * pattern, which caused material-disposal errors and destroyed the cached
   * post-process output nodes installed on the render pipeline.
   */
  setContentLibrary(contentLibrary: ContentLibrarySnapshot): void {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }
    this.contentLibrary = contentLibrary;
  }

  applyShader(
    binding: EffectiveShaderBinding,
    target: ShaderApplyTarget
  ): THREE.Material | unknown {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const definition = getShaderDefinition(
      this.contentLibrary,
      binding.shaderDefinitionId
    );
    if (!definition) {
      throw new Error(`Missing shader definition "${binding.shaderDefinitionId}".`);
    }

    if (definition.targetKind !== target.targetKind) {
      throw new Error(
        `Shader "${binding.shaderDefinitionId}" targets "${definition.targetKind}" but was applied to "${target.targetKind}".`
      );
    }

    const ir = this.getCompiledIR(definition);
    if (ir.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      this.logger.warn("Shader graph compiled with errors.", {
        shaderDefinitionId: binding.shaderDefinitionId,
        diagnostics: ir.diagnostics
      });
      return undefined;
    }

    const parameterUniforms = this.getOrCreateParameterUniformCache(binding.shaderDefinitionId);

    if (target.targetKind === "post-process") {
      return applyIRToPostProcess(ir, binding, target, parameterUniforms);
    }

    const cacheKey = [
      binding.shaderDefinitionId,
      binding.documentRevision,
      this.compileProfile,
      target.targetKind,
      materialCarrierSignature(target.material, target.geometry),
      stableStringify(binding.parameterValues)
    ].join("|");

    return this.acquireMaterial(cacheKey, binding.shaderDefinitionId, () =>
      applyIRToMaterial(ir, binding, target, parameterUniforms)
    );
  }

  /**
   * Reuse uniform TSL nodes across applyShader calls for the same binding.
   * The first call materializes a parameter as a new uniform; subsequent
   * calls re-use the cached uniform and update its .value in place. This
   * turns live parameter edits into GPU uniform updates rather than shader
   * recompilations, which is what makes the fog density slider (and any
   * other live-edit control) actually update the viewport instead of
   * silently being overwritten by the cached compiled shader's old constant.
   */
  private getOrCreateParameterUniformCache(
    shaderDefinitionId: string
  ): Map<string, UniformNodeLike> {
    let cache = this.parameterUniformCache.get(shaderDefinitionId);
    if (!cache) {
      cache = new Map();
      this.parameterUniformCache.set(shaderDefinitionId, cache);
    }
    return cache;
  }

  releaseMaterial(material: THREE.Material): void {
    const entry = this.materialEntryByMaterial.get(material);
    if (!entry) {
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) {
      this.scheduleDisposal(entry);
    }
  }

  invalidate(shaderDefinitionId: string): void {
    for (const key of this.compileCache.keys()) {
      if (key.startsWith(`${shaderDefinitionId}|`)) {
        this.compileCache.delete(key);
      }
    }
    this.parameterUniformCache.delete(shaderDefinitionId);
    this.retireMaterials((entry) => entry.shaderDefinitionId === shaderDefinitionId);
  }

  getShaderDiagnostics(shaderDefinitionId: string): ShaderIRDiagnostic[] {
    return [...(this.diagnostics.get(shaderDefinitionId) ?? [])];
  }

  dispose(): void {
    this.disposed = true;
    this.retireMaterials(() => true);
    this.materialCache.clear();
    this.compileCache.clear();
    this.parameterUniformCache.clear();
    this.diagnostics.clear();
  }

  private acquireMaterial(
    cacheKey: string,
    shaderDefinitionId: string,
    createMaterial: () => THREE.Material
  ): THREE.Material {
    const existing = this.materialCache.get(cacheKey);
    if (existing) {
      existing.refCount += 1;
      if (existing.disposeTimer) {
        clearTimeout(existing.disposeTimer);
        existing.disposeTimer = null;
      }
      return existing.material;
    }

    const material = createMaterial();
    const entry: CachedMaterialEntry = {
      cacheKey,
      shaderDefinitionId,
      material,
      refCount: 1,
      retired: false,
      disposeTimer: null
    };
    this.materialCache.set(cacheKey, entry);
    this.materialEntryByMaterial.set(material, entry);
    this.materialEntries.add(entry);
    return material;
  }

  private retireMaterials(predicate: (entry: CachedMaterialEntry) => boolean): void {
    for (const [cacheKey, entry] of this.materialCache.entries()) {
      if (!predicate(entry)) {
        continue;
      }
      entry.retired = true;
      this.materialCache.delete(cacheKey);
      if (entry.refCount === 0) {
        this.scheduleDisposal(entry);
      }
    }
  }

  private scheduleDisposal(entry: CachedMaterialEntry): void {
    if (entry.disposeTimer || entry.refCount > 0) {
      return;
    }

    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null;
      if (entry.refCount > 0) {
        return;
      }
      entry.material.dispose();
      this.materialEntryByMaterial.delete(entry.material);
      this.materialEntries.delete(entry);
      if (this.materialCache.get(entry.cacheKey) === entry) {
        this.materialCache.delete(entry.cacheKey);
      }
    }, this.materialDisposalGraceMs);
  }

  private getCompiledIR(definition: ShaderGraphDocument): ShaderIR {
    const cacheKey = [
      definition.shaderDefinitionId,
      definition.revision,
      this.compileProfile
    ].join("|");
    const existing = this.compileCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const compiled = compileShaderGraph(definition, {
      compileProfile: this.compileProfile
    });
    this.compileCache.set(cacheKey, compiled);
    this.diagnostics.set(definition.shaderDefinitionId, compiled.diagnostics);
    return compiled;
  }
}
