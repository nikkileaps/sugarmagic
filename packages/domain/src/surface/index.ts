/**
 * Surface / deform / effect domain traits.
 *
 * Owns the canonical authored slot-content model for render-facing traits in
 * Sugarmagic. A surface slot now carries a SurfaceBinding whose inline form is
 * a layer stack; deform/effect stay whole-mesh ShaderOrMaterial bindings.
 */

import type {
  AppearanceContent,
  Layer,
  BlendMode,
  ScatterContent,
  EmissionContent
} from "./layer";
import {
  createAppearanceLayer,
  createEmissionLayer,
  createScatterLayer,
  layerUsesLandscapeOnlyMask
} from "./layer";
import type { Mask } from "./mask";
import { cloneMask } from "./mask";

export * from "./layer";
export * from "./mask";
export * from "./noise";
export * from "./lod";
export * from "./surface-definition";
export * from "./grass-type";
export * from "./flower-type";
export * from "./rock-type";

/**
 * A reference to an executable shader graph with its bound parameter
 * values + texture bindings. The only thing that satisfies the
 * Deformable / Effectable trait contracts. Pre-Plan-037 those slots
 * accepted `ShaderOrMaterial` because Materials were shader-wrappers;
 * post-037 Materials are pure PBR data and have no business in
 * deform/effect slots.
 */
export interface ShaderReference {
  kind: "shader";
  shaderDefinitionId: string;
  parameterValues: Record<string, unknown>;
  textureBindings: Record<string, string>;
}

export type SurfaceContext = "universal" | "landscape-only";

export interface Surface<C extends SurfaceContext = SurfaceContext> {
  readonly layers: readonly Layer[];
  readonly context: C;
}

export type SurfaceBinding<C extends SurfaceContext = SurfaceContext> =
  | { kind: "inline"; surface: Surface<C> }
  | {
      kind: "reference";
      surfaceDefinitionId: string;
    };

export interface SurfaceSlot<C extends SurfaceContext = SurfaceContext> {
  readonly slotName: string;
  readonly surface: SurfaceBinding<C> | null;
}

export interface AssetSurfaceSlot extends SurfaceSlot<"universal"> {
  readonly slotIndex: number;
}

export interface LandscapeSurfaceSlot extends SurfaceSlot<SurfaceContext> {
  readonly channelId: string;
  readonly displayName: string;
  readonly tilingScale: [number, number] | null;
}

export interface Surfaceable {
  readonly surfaceSlots: readonly SurfaceSlot[];
}

export interface Deformable {
  readonly deform: ShaderReference | null;
}

export interface Effectable {
  readonly effect: ShaderReference | null;
}

export function deriveSurfaceContext(
  layers: readonly Layer[]
): SurfaceContext {
  return layers.some(layerUsesLandscapeOnlyMask)
    ? "landscape-only"
    : "universal";
}

export function validateSurfaceLayers(layers: readonly Layer[]): void {
  if (layers.length === 0) {
    throw new Error("Surface.layers must contain at least one layer.");
  }
  const baseLayer = layers[0];
  if (!baseLayer || baseLayer.kind !== "appearance") {
    throw new Error("Surface.layers[0] must be an appearance layer.");
  }
  if (baseLayer.blendMode !== "base") {
    throw new Error('Surface.layers[0] must use blendMode "base".');
  }
}

export function surfaceUsesPaintedMasks(surface: Surface | null | undefined): boolean {
  return Boolean(
    surface?.layers.some((layer) => layer.mask.kind === "painted")
  );
}

export function assertReusableSurfaceHasNoPaintedMasks(
  surface: Surface,
  ownerLabel = "SurfaceDefinition.surface"
): void {
  const paintedLayer = surface.layers.find((layer) => layer.mask.kind === "painted");
  if (!paintedLayer) {
    return;
  }
  throw new Error(
    `${ownerLabel} layer "${paintedLayer.layerId}" uses a painted mask. Painted masks are only valid on inline application-site surfaces.`
  );
}

export function createSurface<C extends SurfaceContext = SurfaceContext>(
  layers: readonly Layer[],
  context?: C
): Surface<C> {
  validateSurfaceLayers(layers);
  const derivedContext = deriveSurfaceContext(layers) as C;
  if (context && context !== derivedContext) {
    throw new Error(
      `Surface context "${context}" does not match derived context "${derivedContext}".`
    );
  }
  return {
    layers: [...layers],
    context: context ?? derivedContext
  };
}

export function createColorAppearanceContent(color: number): AppearanceContent {
  return { kind: "color", color };
}

export function createTextureAppearanceContent(
  textureDefinitionId: string,
  tiling: [number, number] = [1, 1]
): AppearanceContent {
  return {
    kind: "texture",
    textureDefinitionId,
    tiling
  };
}

export function createMaterialAppearanceContent(
  materialDefinitionId: string,
  options: {
    shaderOverrideDefinitionId?: string | null;
  } = {}
): Extract<AppearanceContent, { kind: "material" }> {
  return {
    kind: "material",
    materialDefinitionId,
    shaderOverrideDefinitionId: options.shaderOverrideDefinitionId ?? null
  };
}

export function createShaderAppearanceContent(
  shaderDefinitionId: string,
  parameterValues: Record<string, unknown> = {},
  textureBindings: Record<string, string> = {}
): Extract<AppearanceContent, { kind: "shader" }> {
  return {
    kind: "shader",
    shaderDefinitionId,
    parameterValues,
    textureBindings
  };
}

export function createColorEmissionContent(
  color: number,
  intensity = 1
): EmissionContent {
  return { kind: "color", color, intensity };
}

export function createTextureEmissionContent(
  textureDefinitionId: string,
  intensity = 1,
  tiling: [number, number] = [1, 1]
): EmissionContent {
  return { kind: "texture", textureDefinitionId, intensity, tiling };
}

export function createMaterialEmissionContent(
  materialDefinitionId: string
): EmissionContent {
  return { kind: "material", materialDefinitionId };
}

export function createDefaultSurface(
  baseColor = 0x808080
): Surface<"universal"> {
  return createSurface<"universal">([
    createAppearanceLayer(createColorAppearanceContent(baseColor), {
      displayName: "Base",
      blendMode: "base"
    })
  ]);
}

export function createInlineSurfaceBinding<C extends SurfaceContext = "universal">(
  surface?: Surface<C>
): SurfaceBinding<C> {
  return {
    kind: "inline",
    surface: surface ?? (createDefaultSurface() as Surface<C>)
  };
}

export function createInlineSurfaceBindingFromAppearance(
  content: AppearanceContent,
  options: {
    displayName?: string;
    blendMode?: BlendMode;
  } = {}
): SurfaceBinding<"universal"> {
  return createInlineSurfaceBinding(
    createSurface([
      createAppearanceLayer(content, {
        displayName: options.displayName ?? "Base",
        blendMode: options.blendMode ?? "base"
      })
    ])
  );
}

export function createColorSurfaceBinding(
  color: number
): SurfaceBinding<"universal"> {
  return createInlineSurfaceBindingFromAppearance(createColorSurface(color));
}

export function createMaterialSurfaceBinding(
  materialDefinitionId: string
): SurfaceBinding<"universal"> {
  return createInlineSurfaceBindingFromAppearance(
    createMaterialSurface(materialDefinitionId)
  );
}

export function createShaderSurfaceBinding(
  shaderDefinitionId: string,
  parameterValues: Record<string, unknown> = {},
  textureBindings: Record<string, string> = {}
): SurfaceBinding<"universal"> {
  return createInlineSurfaceBindingFromAppearance(
    createShaderSurface(shaderDefinitionId, parameterValues, textureBindings)
  );
}

export function createReferenceSurfaceBinding<C extends SurfaceContext = SurfaceContext>(
  surfaceDefinitionId: string
): SurfaceBinding<C> {
  return {
    kind: "reference",
    surfaceDefinitionId
  };
}

/**
 * Narrow compatibility aliases while flat-surface call sites migrate to the
 * explicit AppearanceContent names. These still produce AppearanceContent, not
 * a full SurfaceBinding.
 */
export const createColorSurface = createColorAppearanceContent;
export const createTextureSurface = createTextureAppearanceContent;
export const createMaterialSurface = createMaterialAppearanceContent;
export const createShaderSurface = createShaderAppearanceContent;

export function surfaceBindingUsesLandscapeOnlyMasks(
  binding: SurfaceBinding | null | undefined
): boolean {
  return binding?.kind === "inline" && binding.surface.context === "landscape-only";
}

export function cloneSurface<C extends SurfaceContext = SurfaceContext>(
  surface: Surface<C>
): Surface<C> {
  return {
    layers: surface.layers.map((layer) => ({
      ...layer,
      mask: cloneMask(layer.mask),
      content:
        layer.kind === "appearance"
          ? layer.content.kind === "texture"
            ? { ...layer.content, tiling: [...layer.content.tiling] as [number, number] }
            : layer.content.kind === "shader"
              ? {
                  ...layer.content,
                  parameterValues: { ...layer.content.parameterValues },
                  textureBindings: { ...layer.content.textureBindings }
                }
              : { ...layer.content }
          : layer.kind === "emission"
            ? layer.content.kind === "texture"
              ? { ...layer.content, tiling: [...layer.content.tiling] as [number, number] }
              : { ...layer.content }
            : { ...layer.content }
    })) as Layer[],
    context: surface.context
  };
}

export function cloneSurfaceBinding<C extends SurfaceContext = SurfaceContext>(
  binding: SurfaceBinding<C> | null | undefined
): SurfaceBinding<C> | null {
  if (!binding) {
    return null;
  }
  if (binding.kind === "reference") {
    return {
      ...binding
    };
  }
  return {
    kind: "inline",
    surface: cloneSurface(binding.surface)
  };
}
