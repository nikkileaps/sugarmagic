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
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  clamp,
  cos,
  attribute as tslAttribute,
  dot,
  exp,
  float,
  modelWorldMatrix,
  select,
  transformDirection,
  transformNormal,
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
  texture as textureNode,
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
  EffectiveShaderBindingSet,
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
  sunDirectionUniform: UniformNodeLike;
  /**
   * Per-binding cache of effect nodes whose wrapped Three helpers take JS
   * primitives (not TSL nodes) for scalar parameters — notably bloom(), which
   * wraps strength/radius/threshold into its own internal uniforms at
   * construction. Those internal uniforms are snapshots of the value at
   * construction time; later calls with different numeric args would create a
   * new BloomNode, but in a long-lived pipeline Three's TSL caches the
   * compiled shader by graph structure and reuses it, so the updated values
   * never reach the GPU. Caching the node itself and mutating its internal
   * uniforms in place is what makes live parameter edits work in viewports
   * that don't get a fresh compile each frame.
   *
   * Keyed by op id so each bloom/effect op in the graph gets its own cached
   * instance. First call constructs the node; subsequent calls reuse it and
   * mutate its internal uniforms.
   */
  effectNodes: Map<string, EffectNodeCacheEntry>;
}

interface UniformNodeLike {
  value: unknown;
}

interface EffectNodeCacheEntry {
  node: unknown;
  kind: "bloom";
}

interface MeshShaderSetApplyTarget {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
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

function sampleMaterialTextureNode(
  target: Extract<
    ShaderApplyTarget,
    { targetKind: "mesh-surface" | "mesh-deform" | "billboard-surface" }
  >,
  output: "color" | "alpha"
): unknown {
  const map = "map" in target.material ? target.material.map : null;
  if (!map) {
    return output === "color" ? vec3(1, 1, 1) : float(1);
  }
  const sample = textureNode(map, uv());
  return output === "color"
    ? (sample as { rgb: unknown }).rgb
    : (sample as { a: unknown }).a;
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
      if (context.target.targetKind === "post-process") {
        return reconstructPostProcessWorldPosition(context);
      }
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
    case "sunDirection":
      return context.sunDirectionUniform;
    case "sphereNormal": {
      // KNOWN-BROKEN WORKAROUND. Falls back to `normalWorld`. See note below.
      //
      // ── Background ──────────────────────────────────────────────────────
      // The FoilageMaker export bakes a per-vertex local-space "sphere
      // normal" (`_SPHERE_NORMAL`, lowercased to `_sphere_normal` by
      // GLTFLoader) that's intended to let each leaf cluster shade as if it
      // were a smooth volumetric sphere. The shading math wants this vector
      // in world space, which requires rotating the local attribute through
      // the object's world transform.
      //
      // ── Bug we hit ──────────────────────────────────────────────────────
      // Any TSL matrix-math path applied to the custom attribute returns
      // zero in the authoring viewport WHEN the active environment uses a
      // non-flat ambient (HemisphereLight-based: noon, late_afternoon,
      // golden_hour, night). Under the "default" preset (flat AmbientLight)
      // the same math returns correct results. Same asset, same transform,
      // same attribute data, same shader — only the scene lighting differs.
      // Observed failure modes (all returned zero at non-default presets):
      //   - modelNormalMatrix.mul(localSphereNormal).normalize()
      //   - modelWorldMatrix.mul(vec4(localSphereNormal, 0)).xyz.normalize()
      //   - transformDirection(localSphereNormal, modelWorldMatrix)
      //   - transformNormal(localSphereNormal, modelWorldMatrix)
      // A diagnostic that returned the raw attribute with zero math
      // rendered correctly at ALL presets, proving the attribute read path
      // is fine; the failure is specific to TSL matrix ops applied to it.
      // `normalWorld` (which internally uses modelNormalMatrix on the
      // standard `normal` attribute) works at all presets, so Three's core
      // normal path handles this case — only user-custom attributes through
      // matrix uniforms misbehave on material recompile after a light-setup
      // swap. Best guess: Three's WebGPU pipeline drops/zeroes the
      // custom-attribute + per-object matrix uniform binding during the
      // recompile that fires when scene lights change shape (AmbientLight
      // → HemisphereLight).
      //
      // ── Where we stopped ───────────────────────────────────────────────
      // Next steps if we come back to this:
      //   1. Instrument the compiled WGSL for foliage-surface under the
      //      default vs noon preset and diff them — if the noon version
      //      is missing the modelNormalMatrix uniform binding or the
      //      `_sphere_normal` vertex attribute binding, that's the smoking
      //      gun.
      //   2. Try baking the sphere normal in WORLD SPACE (FoilageMaker
      //      side) so no runtime transform is needed. Breaks if a tree is
      //      rotated post-placement, but that's probably rare.
      //   3. Push the object's rotation matrix as our own uniform on the
      //      material (via onBeforeRender) and apply it ourselves instead
      //      of using TSL's per-object matrix builtins.
      //
      // ── Current behavior ───────────────────────────────────────────────
      // Returns `normalWorld` unconditionally. Loses the painterly per-
      // cluster sphere shading but renders the foliage correctly at all
      // presets. The Foliage Surface shader graph that depended on this
      // feature is no longer authoritative — authoring defaults should
      // point at "Foliage Surface 2" which was built without sphereNormal.
      return normalWorld;
    }
    case "treeHeight":
      // Three's GLTFLoader lowercases custom attribute names — see note
      // on sphereNormal above.
      return (tslAttribute as unknown as (
        name: string,
        type: string
      ) => unknown)("_tree_height", "float");
    case "materialTextureColor":
      if (
        context.target.targetKind !== "mesh-surface" &&
        context.target.targetKind !== "billboard-surface"
      ) {
        return vec3(1, 1, 1);
      }
      return sampleMaterialTextureNode(context.target, "color");
    case "materialTextureAlpha":
      if (
        context.target.targetKind !== "mesh-surface" &&
        context.target.targetKind !== "billboard-surface"
      ) {
        return float(1);
      }
      return sampleMaterialTextureNode(context.target, "alpha");
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
 * Extract the current numeric value from a materialized TSL input.
 *
 * Used by effect helpers like bloom() whose underlying Three function takes
 * JS primitives (not TSL nodes) for scalar parameters. Our parameter inputs
 * are stored as uniform nodes with a .value property (see
 * uniformForParameter) — reading .value at finalization time gets the
 * current parameter value, which the effect then bakes into its own
 * internal uniforms. Falls back to `fallback` when the input is not a
 * uniform-like node with an accessible numeric value (e.g., disconnected
 * optional input).
 */
function readNumericFromInput(input: unknown, fallback: number): number {
  if (input && typeof input === "object" && "value" in input) {
    const raw = (input as { value: unknown }).value;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return fallback;
}

/**
 * Reconstruct the fragment's world position inside a post-process pass from
 * screen UV and scene depth. Standard inverse-projection math:
 *
 *   ndc       = vec3(screenUV * 2 - 1, 1)   (far-plane point in NDC)
 *   rayClip   = (ndc, 1) homogeneous
 *   rayView   = (cameraProjectionMatrixInverse * rayClip).xyz / w
 *   viewPos   = rayView * (-sceneDepth / rayView.z)
 *   worldPos  = (cameraWorldMatrix * vec4(viewPos, 1)).xyz
 *
 * View space is right-handed with -Z forward, so rayView.z is negative and
 * sceneDepth (world-space distance from camera) is positive; the scale
 * factor comes out positive.
 *
 * Used for height fog and any other depth-based post-process that needs
 * world coordinates, not just screen-space + depth.
 */
function reconstructPostProcessWorldPosition(context: FinalizationContext): unknown {
  const depth = context.builtinSceneDepthNode ?? viewportLinearDepth;
  const ndcXY = (screenUV as unknown as { mul: (other: unknown) => unknown })
    .mul(2);
  const ndcXYCentered = (ndcXY as unknown as { sub: (other: unknown) => unknown })
    .sub(float(1));
  const rayClip = vec4(ndcXYCentered as never, float(1), float(1));
  const rayHomogeneous = (
    cameraProjectionMatrixInverse as unknown as { mul: (other: unknown) => unknown }
  ).mul(rayClip);
  const rayView = (rayHomogeneous as unknown as { xyz: { div: (other: unknown) => unknown }; w: unknown })
    .xyz.div((rayHomogeneous as unknown as { w: unknown }).w);
  const scale = (
    (depth as unknown as { negate: () => { div: (other: unknown) => unknown } })
      .negate()
      .div((rayView as unknown as { z: unknown }).z)
  );
  const viewPos = (rayView as unknown as { mul: (other: unknown) => unknown }).mul(scale);
  const worldPos4 = (
    cameraWorldMatrix as unknown as { mul: (other: unknown) => unknown }
  ).mul(vec4(viewPos as never, float(1)));
  return (worldPos4 as unknown as { xyz: unknown }).xyz;
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
      const vector = input("input") as { x: unknown; y: unknown; z: unknown; w?: unknown };
      const outputPortId = String(op.settings?.outputPortId ?? "x");
      result =
        outputPortId === "y"
          ? vector.y
          : outputPortId === "z"
            ? vector.z
            : outputPortId === "w"
              ? (vector.w ?? float(1))
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
    case "effect.bloom-pass": {
      const strength = readNumericFromInput(input("strength"), 0.4);
      const radius = readNumericFromInput(input("radius"), 0.4);
      const threshold = readNumericFromInput(input("threshold"), 0.9);
      const inputNode = input("input");
      // Reuse a cached BloomNode across applyShader calls so parameter edits
      // flow as GPU uniform updates. Creating a fresh bloom() each call
      // produces a new node, but Three's TSL compiled-shader cache keys by
      // graph structure and reuses the first compile — so the updated values
      // never reach the GPU in a long-lived pipeline (bloom worked in
      // fresh-compiled preview but not in the live authoring viewport).
      //
      // Both bloom's internal uniforms AND its inputNode reference are
      // mutated in place so the cached node stays wired to the latest
      // upstream graph (e.g., updated fog-tint output).
      const cached = context.effectNodes.get(op.opId);
      if (cached && cached.kind === "bloom") {
        const node = cached.node as {
          inputNode: unknown;
          strength: { value: unknown };
          radius: { value: unknown };
          threshold: { value: unknown };
        };
        node.inputNode = inputNode;
        node.strength.value = strength;
        node.radius.value = radius;
        node.threshold.value = threshold;
        result = cached.node;
      } else {
        const node = bloom(inputNode as never, strength, radius, threshold);
        context.effectNodes.set(op.opId, { node, kind: "bloom" });
        result = node;
      }
      break;
    }
    case "effect.tonemap-aces": {
      // The graph pre-multiplies scene color by exposure before feeding the
      // tonemap node, so the tonemap helper itself takes exposure = 1 as
      // its second arg (not doubling exposure). Matches the graph shape in
      // createDefaultTonemapAcesPostProcessShaderGraph.
      result = acesFilmicToneMapping(input("input") as never, float(1));
      break;
    }
    case "effect.tonemap-reinhard": {
      result = reinhardToneMapping(input("input") as never, float(1));
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
    case "splat": {
      const scalar = input("input") as never;
      result =
        op.dataType === "vec2"
          ? vec2(scalar, scalar)
          : op.dataType === "vec3" || op.dataType === "color"
            ? vec3(scalar, scalar, scalar)
            : vec4(scalar, scalar, scalar, scalar);
      break;
    }
    case "truncate": {
      const source = input("input") as { x: unknown; y: unknown; z?: unknown };
      result =
        op.dataType === "vec2"
          ? vec2(source.x as never, source.y as never)
          : vec3(source.x as never, source.y as never, source.z as never);
      break;
    }
    case "widen": {
      const source = input("input") as { x: unknown; y: unknown; z?: unknown };
      if (op.dataType === "vec4") {
        result = vec4(
          source.x as never,
          source.y as never,
          (source.z ?? float(0)) as never,
          float(0) as never
        );
      } else if (op.dataType === "vec3" || op.dataType === "color") {
        result = vec3(source.x as never, source.y as never, float(0) as never);
      } else {
        result = vec2(source.x as never, source.y as never);
      }
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
  parameterUniforms: Map<string, UniformNodeLike>,
  sunDirectionUniform: UniformNodeLike,
  effectNodes: Map<string, EffectNodeCacheEntry>
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
    parameterUniforms: parameterUniforms,
    sunDirectionUniform,
    effectNodes: effectNodes
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
    // An authored shader writing an opacity output is opting into MASK-mode
    // cutout rendering: opaque where alpha passes the threshold, discarded
    // below it, and (critically) writing to the depth buffer on the opaque
    // pixels so near leaf cards properly occlude branches / other leaves
    // behind them.
    //
    // Previously we deferred to the GLB's authored alphaMode on the
    // theory "the author knows best," but tools like FoilageMaker export
    // leaf cards as BLEND (transparent: true) which disables depth-write
    // and causes the characteristic "see-through-the-front-leaves-to-the-
    // branches-inside" artifact. Since the shader graph's opacityNode IS
    // the author's intent for per-pixel alpha, we treat that intent as
    // "cutout" and set the material up accordingly. If a future shader
    // needs true BLEND (glass, smoke), that becomes a per-shader opt-in
    // instead of a per-GLB accident.
    (material as { transparent: boolean }).transparent = false;
    if ("alphaTest" in material) {
      (material as { alphaTest: number }).alphaTest = 0.5;
    }
    if ("depthWrite" in material) {
      (material as { depthWrite: boolean }).depthWrite = true;
    }
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
  parameterUniforms: Map<string, UniformNodeLike>,
  sunDirectionUniform: UniformNodeLike,
  effectNodes: Map<string, EffectNodeCacheEntry>
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
    parameterUniforms: parameterUniforms,
    sunDirectionUniform,
    effectNodes: effectNodes
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
  /**
   * Per-shaderDefinition cache of effect nodes (bloom, etc.) whose internal
   * uniforms need to be mutated in place to propagate live parameter edits.
   * Parallels parameterUniformCache but for Three-constructed helper nodes.
   */
  private readonly effectNodeCache = new Map<string, Map<string, EffectNodeCacheEntry>>();
  private readonly sunDirectionUniform = (
    uniform as unknown as (value: unknown) => UniformNodeLike
  )(new THREE.Vector3(0, 1, 0));
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

  setSunDirection(direction: THREE.Vector3Like): void {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }
    this.sunDirectionUniform.value = new THREE.Vector3(
      direction.x,
      direction.y,
      direction.z
    ).normalize();
  }

  getCompileProfile(): RuntimeCompileProfile {
    return this.compileProfile;
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
    const errors = ir.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      // Loud on purpose. Silent compilation failures were producing "fog
      // works in runtime but not studio" and "height fog broke fog
      // altogether" ghost bugs where the real root cause was a malformed
      // edge that validateShaderGraphDocument had already diagnosed — it
      // just never surfaced visibly.
      //
      // Built-in shader errors are always the engine's fault and throw
      // (they must not ship broken). Authored shader errors throw for the
      // same reason — an author-edited graph that fails validation should
      // be caught by the editor before we even get here, so if we do,
      // something's wrong in the flow and we want to know immediately.
      const summary = errors
        .map((error) => {
          const location = error.nodeId
            ? `node "${error.nodeId}"`
            : error.edgeId
              ? `edge "${error.edgeId}"`
              : error.parameterId
                ? `parameter "${error.parameterId}"`
                : "graph";
          return `  - ${location}: ${error.message}`;
        })
        .join("\n");
      const message =
        `Shader graph "${binding.shaderDefinitionId}" failed to compile:\n${summary}`;
      // console.error first so the full object is inspectable in devtools;
      // throwing right after ensures the broken state is not silently
      // papered over by returning undefined to applyPostProcessStack.
      console.error("[ShaderRuntime] " + message, {
        shaderDefinitionId: binding.shaderDefinitionId,
        diagnostics: ir.diagnostics
      });
      throw new Error(message);
    }

    const parameterUniforms = this.getOrCreateParameterUniformCache(binding.shaderDefinitionId);
    const effectNodes = this.getOrCreateEffectNodeCache(binding.shaderDefinitionId);

    if (target.targetKind === "post-process") {
      return applyIRToPostProcess(
        ir,
        binding,
        target,
        parameterUniforms,
        this.sunDirectionUniform,
        effectNodes
      );
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
      applyIRToMaterial(
        ir,
        binding,
        target,
        parameterUniforms,
        this.sunDirectionUniform,
        effectNodes
      )
    );
  }

  applyShaderSet(
    bindings: EffectiveShaderBindingSet,
    target: MeshShaderSetApplyTarget
  ): THREE.Material {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const surface = bindings.surface;
    const deform = bindings.deform;
    if (!surface && !deform) {
      return target.material;
    }

    const surfaceDefinition = surface
      ? getShaderDefinition(this.contentLibrary, surface.shaderDefinitionId)
      : null;
    const deformDefinition = deform
      ? getShaderDefinition(this.contentLibrary, deform.shaderDefinitionId)
      : null;

    if (surface && (!surfaceDefinition || surfaceDefinition.targetKind !== "mesh-surface")) {
      throw new Error(`Surface shader "${surface.shaderDefinitionId}" is not a mesh-surface graph.`);
    }
    if (deform && (!deformDefinition || deformDefinition.targetKind !== "mesh-deform")) {
      throw new Error(`Deform shader "${deform.shaderDefinitionId}" is not a mesh-deform graph.`);
    }

    const surfaceIR = surfaceDefinition ? this.getCompiledIR(surfaceDefinition) : null;
    const deformIR = deformDefinition ? this.getCompiledIR(deformDefinition) : null;

    for (const [binding, ir] of [
      [surface, surfaceIR],
      [deform, deformIR]
    ] as const) {
      if (!binding || !ir) {
        continue;
      }
      const errors = ir.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (errors.length > 0) {
        const summary = errors
          .map((error) => {
            const location = error.nodeId
              ? `node "${error.nodeId}"`
              : error.edgeId
                ? `edge "${error.edgeId}"`
                : error.parameterId
                  ? `parameter "${error.parameterId}"`
                  : "graph";
            return `  - ${location}: ${error.message}`;
          })
          .join("\n");
        throw new Error(
          `Shader graph "${binding.shaderDefinitionId}" failed to compile:\n${summary}`
        );
      }
    }

    const cacheKey = [
      "shader-set",
      surface?.shaderDefinitionId ?? "no-surface",
      surface?.documentRevision ?? 0,
      stableStringify(surface?.parameterValues ?? {}),
      deform?.shaderDefinitionId ?? "no-deform",
      deform?.documentRevision ?? 0,
      stableStringify(deform?.parameterValues ?? {}),
      this.compileProfile,
      materialCarrierSignature(target.material, target.geometry)
    ].join("|");

    return this.acquireMaterial(cacheKey, surface?.shaderDefinitionId ?? deform!.shaderDefinitionId, () => {
      let material = toMeshStandardNodeMaterial(target.material);
      if (surface && surfaceIR) {
        material = applyIRToMaterial(
          surfaceIR,
          surface,
          { targetKind: "mesh-surface", material, geometry: target.geometry },
          this.getOrCreateParameterUniformCache(surface.shaderDefinitionId),
          this.sunDirectionUniform,
          this.getOrCreateEffectNodeCache(surface.shaderDefinitionId)
        ) as MeshStandardNodeMaterial;
      }
      if (deform && deformIR) {
        material = applyIRToMaterial(
          deformIR,
          deform,
          { targetKind: "mesh-deform", material, geometry: target.geometry },
          this.getOrCreateParameterUniformCache(deform.shaderDefinitionId),
          this.sunDirectionUniform,
          this.getOrCreateEffectNodeCache(deform.shaderDefinitionId)
        ) as MeshStandardNodeMaterial;
      }
      return material;
    });
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

  private getOrCreateEffectNodeCache(
    shaderDefinitionId: string
  ): Map<string, EffectNodeCacheEntry> {
    let cache = this.effectNodeCache.get(shaderDefinitionId);
    if (!cache) {
      cache = new Map();
      this.effectNodeCache.set(shaderDefinitionId, cache);
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
    this.effectNodeCache.delete(shaderDefinitionId);
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
    this.effectNodeCache.clear();
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
