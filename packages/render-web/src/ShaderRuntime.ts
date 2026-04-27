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
  cameraPosition,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  attribute as tslAttribute,
  color as tslColor,
  float,
  normalLocal,
  normalMap,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  screenUV,
  time,
  deltaTime,
  uv,
  vec2,
  vec3,
  vec4,
  vertexColor,
  texture as textureNode,
  uniform,
  viewportLinearDepth
} from "three/tsl";
import type {
  BlendMode,
  ContentLibrarySnapshot,
  ShaderGraphDocument
} from "@sugarmagic/domain";
import { getShaderDefinition } from "@sugarmagic/domain";
import type {
  EffectiveShaderBinding,
  ResolvedSurfaceStack,
  RuntimeCompileProfile,
  ShaderIR,
  ShaderIRDiagnostic,
  ShaderIROp,
  ShaderIRValue
} from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "./authoredAssetResolver";
import { compileShaderGraph } from "@sugarmagic/runtime-core";
import type { RuntimeRenderPipeline } from "./render";
import {
  materializeEffectOp
} from "./materialize/effect";
import { blendLayerNode } from "./materialize/layer-blends";
import { evaluateLayerMask } from "./materialize/mask";
import {
  materializeMathOp
} from "./materialize/math";
import type {
  EffectNodeCacheEntry,
  EffectMaterializeContext,
  MaterializeInputResolver
} from "./materialize/types";

export type ShaderApplyTarget =
  | {
      targetKind: "mesh-surface" | "mesh-deform" | "mesh-effect";
      material: THREE.Material;
      geometry: THREE.BufferGeometry;
      materialTextures?: Record<string, THREE.Texture | null>;
    }
  | {
      targetKind: "billboard-surface";
      material: MeshBasicNodeMaterial;
      geometry: THREE.BufferGeometry | null;
      materialTextures?: Record<string, THREE.Texture | null>;
    }
  | {
      targetKind: "post-process";
      renderPipeline: RuntimeRenderPipeline;
      previousOutputNode?: unknown | null;
    };

/**
 * Output TSL nodes produced by evaluating a mesh-surface shader
 * binding against the Standard PBR output shape. Consumers assemble
 * these onto their material (single mesh-surface apply) or blend them
 * per channel before assembly (landscape multi-channel apply).
 *
 * Each field is null when the authoring graph did not wire that
 * output. Callers decide how to default missing channels — the
 * landscape path supplies neutral constants; mesh-slot application
 * simply leaves the MeshStandardNodeMaterial's existing node
 * unchanged.
 *
 * `normalNode` is the raw tangent-space normal sample (RGB in [0, 1])
 * before `normalMap()` tangent-to-world reconstruction. The caller
 * wraps it: the mesh path wraps each sample individually; the
 * landscape path wraps once after splatmap-weighted blending so the
 * blend math runs in tangent space (the correct space for weighted
 * normal blending).
 */
export interface ShaderSurfaceNodeSet {
  colorNode: unknown | null;
  alphaNode: unknown | null;
  normalNode: unknown | null;
  roughnessNode: unknown | null;
  metalnessNode: unknown | null;
  aoNode: unknown | null;
  emissiveNode: unknown | null;
  vertexNode: unknown | null;
}

interface ShaderRuntimeOptions {
  contentLibrary: ContentLibrarySnapshot;
  compileProfile: RuntimeCompileProfile;
  materialDisposalGraceMs?: number;
  logger?: {
    warn: (message: string, payload?: Record<string, unknown>) => void;
  };
  /**
   * Required shared AuthoredAssetResolver. WebRenderEngine is the single
   * production owner; standalone tests must wire an explicit resolver
   * instead of relying on a hidden fallback that would mask missing
   * engine wiring.
   */
  assetResolver: AuthoredAssetResolver;
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
   * Optional override for the `uv` builtin. When set, graphs that
   * reference `input.uv` see this TSL node instead of Three's default
   * `uv()` attribute. Landscape rendering uses this to feed a
   * world-projected UV into the same standard-pbr graph that
   * mesh-surface rendering uses — keeps one rendering math, two
   * projection strategies.
   */
  uvOverride?: unknown;
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
  accumulator?: ShaderSurfaceNodeSet | null;
}

interface UniformNodeLike {
  value: unknown;
}

interface MeshShaderSetApplyTarget {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  fileSources?: Record<string, string>;
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

function textureBindingSignature(
  textures: Record<string, THREE.Texture | null>
): string {
  return stableStringify(
    Object.fromEntries(
      Object.entries(textures)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([parameterId, texture]) => [parameterId, textureSignature(texture)])
    )
  );
}

function surfaceStackSignature(
  surface: ResolvedSurfaceStack | null
): string | null {
  if (!surface) {
    return null;
  }
  return stableStringify({
    context: surface.context,
    layers: surface.layers.map((layer) => {
      if (layer.kind === "scatter") {
        return {
          kind: layer.kind,
          contentKind: layer.contentKind,
          definitionId: layer.definitionId,
          enabled: layer.enabled,
          opacity: layer.opacity,
          mask: layer.mask
        };
      }
      return {
        kind: layer.kind,
        contentKind: layer.contentKind,
        shaderDefinitionId: layer.binding.shaderDefinitionId,
        parameterValues: layer.binding.parameterValues,
        textureBindings: layer.binding.textureBindings,
        enabled: layer.enabled,
        opacity: layer.opacity,
        mask: layer.mask
      };
    })
  });
}

function isResolvedSurfaceStack(
  value: EffectiveShaderBinding | ResolvedSurfaceStack | null
): value is ResolvedSurfaceStack {
  return Boolean(value && "layers" in value);
}

function isEffectiveShaderBinding(
  value: EffectiveShaderBinding | ResolvedSurfaceStack | null
): value is EffectiveShaderBinding {
  return Boolean(value && "documentRevision" in value);
}

function withSurfaceNodeDefaults(
  nodeSet: ShaderSurfaceNodeSet
): ShaderSurfaceNodeSet {
  return {
    colorNode: nodeSet.colorNode ?? vec3(1, 1, 1),
    alphaNode: nodeSet.alphaNode ?? float(1),
    normalNode: nodeSet.normalNode ?? vec3(0.5, 0.5, 1),
    roughnessNode: nodeSet.roughnessNode ?? float(1),
    metalnessNode: nodeSet.metalnessNode ?? float(0),
    aoNode: nodeSet.aoNode ?? float(1),
    emissiveNode: nodeSet.emissiveNode ?? vec3(0, 0, 0),
    vertexNode: nodeSet.vertexNode ?? null
  };
}

function blendSurfaceNodeSets(
  base: ShaderSurfaceNodeSet,
  layer: ShaderSurfaceNodeSet,
  blendMode: BlendMode,
  alpha: unknown
): ShaderSurfaceNodeSet {
  return {
    colorNode: blendLayerNode(blendMode, base.colorNode, layer.colorNode, alpha),
    alphaNode: blendLayerNode("mix", base.alphaNode, layer.alphaNode, alpha),
    normalNode: blendLayerNode("mix", base.normalNode, layer.normalNode, alpha),
    roughnessNode: blendLayerNode(blendMode, base.roughnessNode, layer.roughnessNode, alpha),
    metalnessNode: blendLayerNode(blendMode, base.metalnessNode, layer.metalnessNode, alpha),
    aoNode: blendLayerNode(blendMode, base.aoNode, layer.aoNode, alpha),
    emissiveNode: (base.emissiveNode as { add: (other: unknown) => unknown }).add(
      (layer.emissiveNode as { mul: (other: unknown) => unknown }).mul(alpha)
    ),
    vertexNode: layer.vertexNode ?? base.vertexNode
  };
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

function literalNode(dataType: ShaderIRValue["dataType"], value: unknown): unknown {
  switch (dataType) {
    case "float":
      return float(typeof value === "number" ? value : 0);
    case "vec2":
      return Array.isArray(value) ? vec2(value[0] ?? 0, value[1] ?? 0) : vec2(0, 0);
    case "vec3":
      return Array.isArray(value)
        ? vec3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
        : vec3(0, 0, 0);
    case "color":
      return Array.isArray(value)
        ? tslColor(
            new THREE.Color().setRGB(
              Number(value[0]) || 0,
              Number(value[1]) || 0,
              Number(value[2]) || 0
            )
          )
        : tslColor(new THREE.Color().setRGB(0, 0, 0));
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

type MaterialTextureChannel = "color" | "alpha" | "r" | "g" | "b" | "a";

function sampleMaterialTextureNode(
  target: Extract<
    ShaderApplyTarget,
    { targetKind: "mesh-surface" | "mesh-deform" | "mesh-effect" | "billboard-surface" }
  >,
  output: MaterialTextureChannel,
  parameterId: string | null,
  uvNode: unknown
): unknown {
  const parameterTexture =
    parameterId && target.materialTextures
      ? target.materialTextures[parameterId] ?? null
      : null;
  if (!parameterTexture) {
    // Neutral defaults per channel so downstream math doesn't collapse:
    // authored graphs must bind material textures explicitly; the
    // carrier GLB material is no longer a hidden fallback source.
    // color sample fails open to white, alpha/channels fail open to 1.
    return output === "color" ? vec3(1, 1, 1) : float(1);
  }
  const sample = textureNode(parameterTexture, uvNode as never) as {
    rgb: unknown;
    r: unknown;
    g: unknown;
    b: unknown;
    a: unknown;
  };
  switch (output) {
    case "color":
      return sample.rgb;
    case "alpha":
    case "a":
      return sample.a;
    case "r":
      return sample.r;
    case "g":
      return sample.g;
    case "b":
      return sample.b;
  }
}

function resolveMaterialTextureUv(
  settings: Record<string, unknown> | undefined,
  context: FinalizationContext
): unknown {
  const uvValue = settings?.uvValue as ShaderIRValue | undefined;
  if (uvValue && typeof uvValue === "object" && "kind" in uvValue) {
    return materializeValue(uvValue, context);
  }
  return context.uvOverride ?? uv();
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
      return context.uvOverride ?? uv();
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
        context.target.targetKind !== "mesh-effect" &&
        context.target.targetKind !== "billboard-surface"
      ) {
        return vec3(1, 1, 1);
      }
      return sampleMaterialTextureNode(
        context.target,
        "color",
        typeof value.settings?.parameterId === "string" ? value.settings.parameterId : null,
        resolveMaterialTextureUv(value.settings, context)
      );
    case "materialTextureAlpha":
      if (
        context.target.targetKind !== "mesh-surface" &&
        context.target.targetKind !== "mesh-effect" &&
        context.target.targetKind !== "billboard-surface"
      ) {
        return float(1);
      }
      return sampleMaterialTextureNode(
        context.target,
        "alpha",
        typeof value.settings?.parameterId === "string" ? value.settings.parameterId : null,
        resolveMaterialTextureUv(value.settings, context)
      );
    case "materialTextureR":
    case "materialTextureG":
    case "materialTextureB":
    case "materialTextureA": {
      if (
        context.target.targetKind !== "mesh-surface" &&
        context.target.targetKind !== "mesh-effect" &&
        context.target.targetKind !== "billboard-surface"
      ) {
        return float(1);
      }
      const channel: MaterialTextureChannel =
        value.name === "materialTextureR"
          ? "r"
          : value.name === "materialTextureG"
            ? "g"
            : value.name === "materialTextureB"
              ? "b"
              : "a";
      return sampleMaterialTextureNode(
        context.target,
        channel,
        typeof value.settings?.parameterId === "string" ? value.settings.parameterId : null,
        resolveMaterialTextureUv(value.settings, context)
      );
    }
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
    case "accumulatorColor":
      return asColorNode(context.accumulator?.colorNode ?? vec3(1, 1, 1));
    case "accumulatorNormal":
      return context.accumulator?.normalNode ?? vec3(0.5, 0.5, 1);
    case "accumulatorRoughness":
      return context.accumulator?.roughnessNode ?? float(1);
    case "accumulatorMetalness":
      return context.accumulator?.metalnessNode ?? float(0);
    case "accumulatorAo":
      return context.accumulator?.aoNode ?? float(1);
    case "accumulatorAlpha":
      return context.accumulator?.alphaNode ?? float(1);
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
  // Materialize parameters as TSL LITERALS, not uniform() nodes.
  //
  // The original implementation used `uniform()` with a shared cache
  // (keyed by shader+parameterId) so that mutating `.value` would push
  // new values to the GPU without recompiling. Empirically that didn't
  // work in this stack — switching wind preset Meadow Breeze (0.35) →
  // Still Air (0) left the GPU rendering with 0.35 baked in, and even
  // creating a fresh `uniform(0)` per material didn't take. Three's
  // TSL appears to inline scalar uniform values at compile time in
  // ways that don't propagate.
  //
  // A literal `float(value)` IS guaranteed to inline correctly (proven
  // by hardcoding `float(0)` in the wind-sway materializer, which DOES
  // stop the grass). Since `cacheKey` already includes parameterValues,
  // any param change forces a fresh material acquire anyway — at which
  // point a fresh literal captures the new value. Live editing still
  // works; it just costs a recompile per change instead of a uniform
  // poke. That price is fine — graphics shaders are short and Three's
  // compile is fast.
  const currentValue = context.parameterValues[parameterId] ?? 0;
  const node = literalNode(dataType, currentValue);
  // Keep cache write for compat with anything that reads it; nothing
  // in the new path reads it back.
  context.parameterUniforms.set(parameterId, node as UniformNodeLike);
  return node;
}

function materializeOp(opId: string, context: FinalizationContext): unknown {
  if (context.opNodeCache.has(opId)) {
    return context.opNodeCache.get(opId);
  }

  const op = context.opMap.get(opId);
  if (!op) {
    return float(0);
  }

  const input: MaterializeInputResolver = (portId: string): unknown =>
    materializeValue(op.inputs[portId] ?? { kind: "literal", dataType: "float", value: 0 }, context);

  let result = materializeMathOp({ op, input });
  if (!result.handled) {
    result = materializeEffectOp({ op, input }, context as EffectMaterializeContext);
  }
  if (!result.handled) {
    result = { handled: true, value: float(0) };
  }

  context.opNodeCache.set(opId, result.value);
  return result.value;
}

/**
 * Pure materialization: build the full ShaderSurfaceNodeSet for a
 * compiled IR against a specific binding + target context. No
 * mutation of any material — the caller decides how to assemble the
 * result. This is the single implementation of "IR → TSL nodes" that
 * both single-material apply (applyIRToMaterial) and multi-channel
 * landscape evaluation share, so landscape and mesh can never drift
 * in what `standard-pbr` actually means.
 */
function evaluateIRToSurfaceNodes(
  ir: ShaderIR,
  binding: EffectiveShaderBinding,
  target: Extract<ShaderApplyTarget, { targetKind: "mesh-surface" | "mesh-deform" | "mesh-effect" | "billboard-surface" }>,
  parameterUniforms: Map<string, UniformNodeLike>,
  sunDirectionUniform: UniformNodeLike,
  effectNodes: Map<string, EffectNodeCacheEntry>,
  uvOverride?: unknown,
  accumulator?: ShaderSurfaceNodeSet | null
): ShaderSurfaceNodeSet {
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
    parameterUniforms,
    sunDirectionUniform,
    effectNodes,
    uvOverride,
    accumulator
  };

  return {
    colorNode: ir.outputs.effectColor
      ? materializeValue(ir.outputs.effectColor, context)
      : ir.outputs.fragmentColor
        ? materializeValue(ir.outputs.fragmentColor, context)
      : null,
    alphaNode: ir.outputs.effectAlpha
      ? materializeValue(ir.outputs.effectAlpha, context)
      : ir.outputs.fragmentAlpha
        ? materializeValue(ir.outputs.fragmentAlpha, context)
      : null,
    normalNode: ir.outputs.effectNormal
      ? materializeValue(ir.outputs.effectNormal, context)
      : ir.outputs.fragmentNormal
        ? materializeValue(ir.outputs.fragmentNormal, context)
      : null,
    roughnessNode: ir.outputs.effectRoughness
      ? materializeValue(ir.outputs.effectRoughness, context)
      : ir.outputs.fragmentRoughness
        ? materializeValue(ir.outputs.fragmentRoughness, context)
      : null,
    metalnessNode: ir.outputs.effectMetalness
      ? materializeValue(ir.outputs.effectMetalness, context)
      : ir.outputs.fragmentMetalness
        ? materializeValue(ir.outputs.fragmentMetalness, context)
      : null,
    aoNode: ir.outputs.effectAo
      ? materializeValue(ir.outputs.effectAo, context)
      : ir.outputs.fragmentAo
        ? materializeValue(ir.outputs.fragmentAo, context)
      : null,
    emissiveNode: ir.outputs.emissive
      ? materializeValue(ir.outputs.emissive, context)
      : null,
    vertexNode: ir.outputs.vertex
      ? materializeValue(ir.outputs.vertex, context)
      : null
  };
}

function applyIRToMaterial(
  ir: ShaderIR,
  binding: EffectiveShaderBinding,
  target: Extract<ShaderApplyTarget, { targetKind: "mesh-surface" | "mesh-deform" | "mesh-effect" | "billboard-surface" }>,
  parameterUniforms: Map<string, UniformNodeLike>,
  sunDirectionUniform: UniformNodeLike,
  effectNodes: Map<string, EffectNodeCacheEntry>,
  accumulator?: ShaderSurfaceNodeSet | null,
  blendMode?: "mask" | "blend"
): THREE.Material {
  const material =
    target.targetKind === "billboard-surface"
      ? target.material
      : toMeshStandardNodeMaterial(target.material);
  const nodeSet = evaluateIRToSurfaceNodes(
    ir,
    binding,
    target,
    parameterUniforms,
    sunDirectionUniform,
    effectNodes,
    undefined,
    accumulator
  );

  return applyNodeSetToMaterial(material, nodeSet, { blendMode });
}

function resolveShaderBlendMode(
  shaderDefinition: ShaderGraphDocument | null | undefined
): "mask" | "blend" {
  const raw = shaderDefinition?.metadata?.blendMode;
  return raw === "blend" ? "blend" : "mask";
}

function applyNodeSetToMaterial(
  material: MeshStandardNodeMaterial | MeshBasicNodeMaterial,
  nodeSet: ShaderSurfaceNodeSet,
  options: { blendMode?: "mask" | "blend" } = {}
): MeshStandardNodeMaterial | MeshBasicNodeMaterial {
  if (nodeSet.vertexNode) {
    material.positionNode = nodeSet.vertexNode as never;
    material.needsUpdate = true;
  }
  if (nodeSet.colorNode && "colorNode" in material) {
    material.colorNode = nodeSet.colorNode as never;
  }
  if (nodeSet.alphaNode && "opacityNode" in material) {
    material.opacityNode = nodeSet.alphaNode as never;
    // TODO(foliage-shimmer): mask-mode (alphaTest=0.5) causes scattered pixel
    // flashes on tall grass and other alpha-tested foliage when wind animates
    // the blades. Cause: every fragment is binary keep/discard at alpha=0.5,
    // so sub-pixel motion of blade triangles flips individual pixels on/off
    // each frame. Bloom amplifies the effect but is not the source. Confirmed
    // 2026-04-24 by setting all scatter wind to Still Air (Tall Grass +
    // Flowers in Wildflower Meadow) — flashes vanish entirely without motion.
    //
    // Proper fix path (real refactor, deferred):
    //  1. Enable MSAA on the WebGPU scenePass.
    //  2. Set `material.alphaToCoverage = true` on foliage materials (mask
    //     mode only — blend mode already smooth-fades).
    //  3. Drop alphaTest below to ~0.01; coverage replaces the hard cutoff
    //     and gets anti-aliased by MSAA naturally.
    // Alternative: implement TAA (jittered camera + reprojection + history
    // buffer) — bigger refactor, but addresses many other aliasing issues
    // beyond foliage too.
    //
    // Workaround for now: lower wind strength = less per-frame jitter =
    // smaller / fewer flashes. Don't crank wind on grass without thinking
    // about the bloom interaction.
    //
    // Opacity policy is per-shader via metadata.blendMode:
    //   "mask"  (default) — alphaTest=0.5 cutout + depthWrite=true. Binary
    //           edges; used for foliage cards where the painted alpha is
    //           effectively a silhouette mask and we want depth-write so
    //           near leaves occlude inner branches. Historical default
    //           preventing GLB-authored BLEND from producing the
    //           "see-through-leaves-to-branches" artifact.
    //   "blend" — transparent=true + alphaTest=0.01 + depthWrite=false.
    //           True alpha gradients; used for grass blade base fade
    //           (Grass Surface 6) where we want the blade to smoothly
    //           transition to transparent so its root appears to blend
    //           into the ground rather than terminate at a hard cutoff
    //           line. alphaTest=0.01 (not 0) is a small optimization so
    //           fully-transparent fragments short-circuit before the
    //           expensive blend math.
    const blendMode = options.blendMode ?? "mask";
    if (blendMode === "blend") {
      (material as { transparent: boolean }).transparent = true;
      if ("alphaTest" in material) {
        (material as { alphaTest: number }).alphaTest = 0.01;
      }
      if ("depthWrite" in material) {
        (material as { depthWrite: boolean }).depthWrite = false;
      }
    } else {
      (material as { transparent: boolean }).transparent = false;
      if ("alphaTest" in material) {
        (material as { alphaTest: number }).alphaTest = 0.5;
      }
      if ("depthWrite" in material) {
        (material as { depthWrite: boolean }).depthWrite = true;
      }
    }
  }
  if (nodeSet.emissiveNode && material instanceof MeshStandardNodeMaterial) {
    material.emissiveNode = nodeSet.emissiveNode as never;
  }
  if (material instanceof MeshStandardNodeMaterial) {
    // PBR-channel outputs: only wired when the authoring graph actually
    // produced them (the compiler leaves these undefined for optional,
    // unwired ports — see compileOutputNode). Leaving them unset
    // preserves the material's existing node / scalar defaults, which
    // is what legacy graphs (Foliage Surface 1/2/3, debug shaders) rely
    // on when they only author color+alpha.
    if (nodeSet.normalNode) {
      // The graph authors tangent-space normal sample in [0, 1] RGB;
      // `normalMap()` does the [-1, 1] unpack + tangent-to-world
      // reconstruction that Three's MeshStandardMaterial would do if
      // you assigned a legacy `.normalMap`. Doing this wrap here (not
      // in the graph) spares authors from having to know about
      // tangent frames.
      material.normalNode = normalMap(nodeSet.normalNode as never) as never;
    }
    if (nodeSet.roughnessNode) {
      material.roughnessNode = nodeSet.roughnessNode as never;
    }
    if (nodeSet.metalnessNode) {
      material.metalnessNode = nodeSet.metalnessNode as never;
    }
    if (nodeSet.aoNode) {
      material.aoNode = nodeSet.aoNode as never;
    }
  }

  material.needsUpdate = true;
  return material;
}

function textureRepeatForBinding(
  binding: EffectiveShaderBinding | null
): { repeatX: number; repeatY: number } {
  const tilingValue = binding?.parameterValues.tiling;
  if (Array.isArray(tilingValue) && tilingValue.length >= 2) {
    return {
      repeatX: Number(tilingValue[0]) || 1,
      repeatY: Number(tilingValue[1]) || 1
    };
  }
  return { repeatX: 1, repeatY: 1 };
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
  private readonly assetResolver: AuthoredAssetResolver;
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
    if (!options.assetResolver) {
      throw new Error(
        "ShaderRuntime requires an explicit AuthoredAssetResolver. Wire the shared engine-owned resolver instead of relying on an internal fallback."
      );
    }
    this.assetResolver = options.assetResolver;
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

  getContentLibrary(): ContentLibrarySnapshot {
    return this.contentLibrary;
  }

  getAssetResolver(): AuthoredAssetResolver {
    return this.assetResolver;
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

    const blendMode = resolveShaderBlendMode(definition);
    return this.acquireMaterial(cacheKey, binding.shaderDefinitionId, () =>
      applyIRToMaterial(
        ir,
        binding,
        target,
        parameterUniforms,
        this.sunDirectionUniform,
        effectNodes,
        undefined,
        blendMode
      )
    );
  }

  /**
   * Evaluate an EffectiveShaderBinding as a ShaderSurfaceNodeSet
   * WITHOUT assigning anything to a material. This is the public
   * entry point for callers that need to compose multiple binding
   * evaluations before emitting a final material — landscape is the
   * canonical example: each channel's material gets evaluated to a
   * node set, then N sets get blended by splatmap weights into one
   * final set that drives the landscape's MeshStandardNodeMaterial.
   *
   * The mesh-slot apply path (applyShaderSet) uses the same IR
   * materialization internally, so there is exactly one
   * implementation of "what `standard-pbr` means" across every
   * surface that consumes the shader graph system.
   *
   * Returns null if the shader graph is missing, targets the wrong
   * kind, or has error-level compilation diagnostics. In that case
   * the caller is responsible for its fallback (e.g. constant color
   * for the landscape channel).
   */
  evaluateMeshSurfaceBinding(
    binding: EffectiveShaderBinding,
    options: {
      geometry: THREE.BufferGeometry | null;
      carrierMaterial: THREE.Material;
      uvOverride?: unknown;
    }
  ): ShaderSurfaceNodeSet | null {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const shaderDefinition = getShaderDefinition(
      this.contentLibrary,
      binding.shaderDefinitionId
    );
    if (!shaderDefinition || shaderDefinition.targetKind !== "mesh-surface") {
      return null;
    }
    const ir = this.getCompiledIR(shaderDefinition);
    if (ir.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return null;
    }

    const surfaceTextures = this.resolveTextureBindings(binding);
    const geometry = options.geometry ?? new THREE.BufferGeometry();
    const target = {
      targetKind: "mesh-surface" as const,
      material: options.carrierMaterial,
      geometry,
      materialTextures: surfaceTextures
    };

    return evaluateIRToSurfaceNodes(
      ir,
      binding,
      target,
      this.getOrCreateParameterUniformCache(binding.shaderDefinitionId),
      this.sunDirectionUniform,
      this.getOrCreateEffectNodeCache(binding.shaderDefinitionId),
      options.uvOverride
    );
  }

  evaluateMeshDeformBinding(
    binding: EffectiveShaderBinding,
    options: {
      geometry: THREE.BufferGeometry | null;
      carrierMaterial: THREE.Material;
    }
  ): ShaderSurfaceNodeSet | null {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const shaderDefinition = getShaderDefinition(
      this.contentLibrary,
      binding.shaderDefinitionId
    );
    if (!shaderDefinition || shaderDefinition.targetKind !== "mesh-deform") {
      return null;
    }
    const ir = this.getCompiledIR(shaderDefinition);
    if (ir.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return null;
    }

    const geometry = options.geometry ?? new THREE.BufferGeometry();
    return evaluateIRToSurfaceNodes(
      ir,
      binding,
      {
        targetKind: "mesh-deform",
        material: options.carrierMaterial,
        geometry,
        materialTextures: {}
      },
      this.getOrCreateParameterUniformCache(binding.shaderDefinitionId),
      this.sunDirectionUniform,
      this.getOrCreateEffectNodeCache(binding.shaderDefinitionId)
    );
  }

  evaluateMeshEffectBinding(
    binding: EffectiveShaderBinding,
    options: {
      geometry: THREE.BufferGeometry | null;
      carrierMaterial: THREE.Material;
      accumulator: ShaderSurfaceNodeSet;
    }
  ): ShaderSurfaceNodeSet | null {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const shaderDefinition = getShaderDefinition(
      this.contentLibrary,
      binding.shaderDefinitionId
    );
    if (!shaderDefinition || shaderDefinition.targetKind !== "mesh-effect") {
      return null;
    }
    const ir = this.getCompiledIR(shaderDefinition);
    if (ir.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return null;
    }

    const effectTextures = this.resolveTextureBindings(binding);
    const geometry = options.geometry ?? new THREE.BufferGeometry();
    return evaluateIRToSurfaceNodes(
      ir,
      binding,
      {
        targetKind: "mesh-effect",
        material: options.carrierMaterial,
        geometry,
        materialTextures: effectTextures
      },
      this.getOrCreateParameterUniformCache(binding.shaderDefinitionId),
      this.sunDirectionUniform,
      this.getOrCreateEffectNodeCache(binding.shaderDefinitionId),
      undefined,
      options.accumulator
    );
  }

  evaluateLayerStackToNodeSet(
    surface: ResolvedSurfaceStack,
    options: {
      geometry: THREE.BufferGeometry | null;
      carrierMaterial: THREE.Material;
      uvOverride?: unknown;
      splatmapWeightNode?: (channelIndex: number) => unknown | null;
    }
  ): ShaderSurfaceNodeSet | null {
    let accumulator: ShaderSurfaceNodeSet | null = null;
    const geometry = options.geometry ?? new THREE.BufferGeometry();

    for (const layer of surface.layers) {
      if (!layer.enabled) {
        continue;
      }

      const maskNode = evaluateLayerMask(layer.mask, {
        contentLibrary: this.contentLibrary,
        assetResolver: this.assetResolver,
        uvNode: options.uvOverride ?? uv(),
        splatmapWeightNode: options.splatmapWeightNode
      });
      const layerAlpha = (maskNode as { mul: (other: unknown) => unknown }).mul(
        float(layer.opacity)
      );

      if (layer.kind === "scatter") {
        continue;
      }

      const evaluated = this.evaluateMeshSurfaceBinding(layer.binding, {
        geometry,
        carrierMaterial: options.carrierMaterial,
        uvOverride: options.uvOverride
      });
      if (!evaluated) {
        continue;
      }

      const normalized = withSurfaceNodeDefaults(evaluated);
      if (!accumulator || layer.kind === "appearance" && layer.blendMode === "base") {
        accumulator = normalized;
        continue;
      }

      if (layer.kind === "appearance") {
        accumulator = blendSurfaceNodeSets(
          accumulator,
          normalized,
          layer.blendMode,
          layerAlpha
        );
        continue;
      }

      const currentEmissive = (accumulator.emissiveNode ?? vec3(0, 0, 0)) as {
        add: (other: unknown) => unknown;
      };
      const emissionSource = (
        normalized.emissiveNode ??
        normalized.colorNode ??
        vec3(0, 0, 0)
      ) as { mul: (other: unknown) => unknown };
      accumulator = {
        ...accumulator,
        emissiveNode: currentEmissive.add(
          emissionSource.mul((layerAlpha as { mul: (other: unknown) => unknown }).mul(float(layer.intensity)))
        )
      };
    }

    return accumulator ? withSurfaceNodeDefaults(accumulator) : null;
  }

  applyShaderSet(
    bindings: {
      surface: EffectiveShaderBinding | ResolvedSurfaceStack | null;
      deform: EffectiveShaderBinding | null;
      effect: EffectiveShaderBinding | null;
    },
    target: MeshShaderSetApplyTarget
  ): THREE.Material {
    if (this.disposed) {
      throw new Error("ShaderRuntime was used after disposal.");
    }

    const surface = bindings.surface;
    const deform = bindings.deform;
    const effect = bindings.effect;
    if (!surface && !deform && !effect) {
      return target.material;
    }

    const surfaceBinding = isEffectiveShaderBinding(surface) ? surface : null;
    const surfaceStack = isResolvedSurfaceStack(surface) ? surface : null;
    const surfaceDefinition = surfaceBinding
      ? getShaderDefinition(this.contentLibrary, surfaceBinding.shaderDefinitionId)
      : null;
    const deformDefinition = deform
      ? getShaderDefinition(this.contentLibrary, deform.shaderDefinitionId)
      : null;
    const effectDefinition = effect
      ? getShaderDefinition(this.contentLibrary, effect.shaderDefinitionId)
      : null;

    if (
      surfaceBinding &&
      (!surfaceDefinition || surfaceDefinition.targetKind !== "mesh-surface")
    ) {
      throw new Error(
        `Surface shader "${surfaceBinding.shaderDefinitionId}" is not a mesh-surface graph.`
      );
    }
    if (deform && (!deformDefinition || deformDefinition.targetKind !== "mesh-deform")) {
      throw new Error(`Deform shader "${deform.shaderDefinitionId}" is not a mesh-deform graph.`);
    }
    if (effect && (!effectDefinition || effectDefinition.targetKind !== "mesh-effect")) {
      throw new Error(`Effect shader "${effect.shaderDefinitionId}" is not a mesh-effect graph.`);
    }

    const surfaceIR = surfaceDefinition ? this.getCompiledIR(surfaceDefinition) : null;
    const deformIR = deformDefinition ? this.getCompiledIR(deformDefinition) : null;
    const effectIR = effectDefinition ? this.getCompiledIR(effectDefinition) : null;

    for (const [binding, ir] of [
      [surfaceBinding, surfaceIR],
      [deform, deformIR],
      [effect, effectIR]
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

    const surfaceTextures = this.resolveTextureBindings(surfaceBinding);
    const deformTextures = this.resolveTextureBindings(deform);
    const effectTextures = this.resolveTextureBindings(effect);
    const cacheKey = [
      "shader-set",
      surfaceBinding?.shaderDefinitionId ?? surfaceStackSignature(surfaceStack) ?? "no-surface",
      surfaceBinding?.documentRevision ?? 0,
      stableStringify(surfaceBinding?.parameterValues ?? surfaceStack ?? {}),
      stableStringify(surfaceBinding?.textureBindings ?? {}),
      textureBindingSignature(surfaceTextures),
      deform?.shaderDefinitionId ?? "no-deform",
      deform?.documentRevision ?? 0,
      stableStringify(deform?.parameterValues ?? {}),
      stableStringify(deform?.textureBindings ?? {}),
      textureBindingSignature(deformTextures),
      effect?.shaderDefinitionId ?? "no-effect",
      effect?.documentRevision ?? 0,
      stableStringify(effect?.parameterValues ?? {}),
      stableStringify(effect?.textureBindings ?? {}),
      textureBindingSignature(effectTextures),
      this.compileProfile,
      materialCarrierSignature(target.material, target.geometry)
    ].join("|");

    return this.acquireMaterial(
      cacheKey,
      surfaceBinding?.shaderDefinitionId ??
        surfaceStackSignature(surfaceStack) ??
        deform?.shaderDefinitionId ??
        effect?.shaderDefinitionId ??
        "shader-set",
      () => {
      let material = toMeshStandardNodeMaterial(target.material);
      let surfaceNodeSet: ShaderSurfaceNodeSet | null = null;
      if (surfaceBinding && surfaceIR) {
        surfaceNodeSet = evaluateIRToSurfaceNodes(
          surfaceIR,
          surfaceBinding,
          {
            targetKind: "mesh-surface",
            material,
            geometry: target.geometry,
            materialTextures: surfaceTextures
          },
          this.getOrCreateParameterUniformCache(surfaceBinding.shaderDefinitionId),
          this.sunDirectionUniform,
          this.getOrCreateEffectNodeCache(surfaceBinding.shaderDefinitionId)
        );
        material = applyNodeSetToMaterial(material, surfaceNodeSet, {
          blendMode: resolveShaderBlendMode(surfaceDefinition)
        }) as MeshStandardNodeMaterial;
      } else if (surfaceStack) {
        surfaceNodeSet = this.evaluateLayerStackToNodeSet(surfaceStack, {
          geometry: target.geometry,
          carrierMaterial: material
        });
        if (surfaceNodeSet) {
          material = applyNodeSetToMaterial(material, surfaceNodeSet) as MeshStandardNodeMaterial;
        }
      }
      if (deform && deformIR) {
        material = applyIRToMaterial(
          deformIR,
          deform,
          {
            targetKind: "mesh-deform",
            material,
            geometry: target.geometry,
            materialTextures: deformTextures
          },
          this.getOrCreateParameterUniformCache(deform.shaderDefinitionId),
          this.sunDirectionUniform,
          this.getOrCreateEffectNodeCache(deform.shaderDefinitionId)
        ) as MeshStandardNodeMaterial;
      }
      if (effect && effectIR && surfaceNodeSet) {
        const effectNodeSet = evaluateIRToSurfaceNodes(
          effectIR,
          effect,
          {
            targetKind: "mesh-effect",
            material,
            geometry: target.geometry,
            materialTextures: effectTextures
          },
          this.getOrCreateParameterUniformCache(effect.shaderDefinitionId),
          this.sunDirectionUniform,
          this.getOrCreateEffectNodeCache(effect.shaderDefinitionId),
          undefined,
          surfaceNodeSet
        );
        material = applyNodeSetToMaterial(material, effectNodeSet) as MeshStandardNodeMaterial;
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
    for (const entry of this.materialEntries) {
      if (entry.disposeTimer) {
        clearTimeout(entry.disposeTimer);
        entry.disposeTimer = null;
      }
      this.materialEntryByMaterial.delete(entry.material);
    }
    this.materialEntries.clear();
    this.compileCache.clear();
    this.parameterUniformCache.clear();
    this.effectNodeCache.clear();
    this.diagnostics.clear();
  }

  private resolveTextureBindings(
    binding: EffectiveShaderBinding | null
  ): Record<string, THREE.Texture | null> {
    if (!binding) {
      return {};
    }

    const { repeatX, repeatY } = textureRepeatForBinding(binding);
    const textures: Record<string, THREE.Texture | null> = {};
    for (const [parameterId, textureDefinitionId] of Object.entries(binding.textureBindings)) {
      const definition =
        this.contentLibrary.textureDefinitions.find(
          (candidate) => candidate.definitionId === textureDefinitionId
        ) ?? null;
      if (!definition) {
        textures[parameterId] = null;
        continue;
      }

      textures[parameterId] = this.assetResolver.resolveTextureDefinition(
        definition,
        { repeatX, repeatY }
      );
    }

    return textures;
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
      // WebGPU node materials are still referenced by Three's internal
      // render-object bookkeeping for at least one frame after callers
      // release them. Disposing them here can crash inside NodeManager
      // teardown (`usedTimes` access on an already-pruned node). The
      // runtime therefore retires cache ownership immediately but leaves
      // final GPU/material teardown to the renderer lifecycle.
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
