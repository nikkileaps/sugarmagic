/**
 * Surface layer primitives.
 *
 * Owns the canonical authored shapes that can appear inside one Surface stack:
 * masks, blend modes, appearance/scatter/emission content, and the layer
 * factories that keep the base-layer invariant centralized.
 */

import { createUuid } from "../shared/identity";
import type { Mask } from "./mask";
import { maskUsesLandscapeOnlyInputs } from "./mask";
import type { ShaderReference } from "./index";

export type BlendMode = "base" | "mix" | "multiply" | "add" | "overlay";

export type AppearanceContent =
  | { kind: "color"; color: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      tiling: [number, number];
    }
  | {
      kind: "material";
      materialDefinitionId: string;
      /**
       * Per-use surface shader override. `null`/`undefined` = use
       * whatever shader the material itself picks (Material.
       * shaderDefinitionId). When set, this layer renders the
       * material's PBR data through THIS shader instead, with
       * material PBR fields auto-bound to shader parameters by
       * name convention. Same trait pattern as
       * AssetSurfaceSlot.shaderOverride for deform.
       */
      shaderOverrideDefinitionId?: string | null;
      /**
       * Per-use shader-parameter overrides. For shader parameters
       * that DON'T match a material PBR field by convention
       * (warmColor, rimStrength, etc.), authors can set values
       * here. Material PBR fields still auto-bind to matching
       * shader parameters; these overrides take precedence even
       * over the auto-bind.
       */
      parameterOverrides?: Record<string, unknown>;
    }
  | {
      kind: "shader";
      shaderDefinitionId: string;
      parameterValues: Record<string, unknown>;
      textureBindings: Record<string, string>;
    };

export type ScatterContent =
  | { kind: "grass"; grassTypeId: string }
  | { kind: "flowers"; flowerTypeId: string }
  | { kind: "rocks"; rockTypeId: string };

export type EmissionContent =
  | { kind: "color"; color: number; intensity: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      intensity: number;
      tiling: [number, number];
    }
  | { kind: "material"; materialDefinitionId: string };

export interface LayerCommon {
  layerId: string;
  displayName: string;
  enabled: boolean;
  opacity: number;
  mask: Mask;
}

export interface AppearanceLayer extends LayerCommon {
  kind: "appearance";
  blendMode: BlendMode;
  content: AppearanceContent;
}

export interface ScatterLayer extends LayerCommon {
  kind: "scatter";
  content: ScatterContent;
  /**
   * Optional executable surface shader for this scatter layer's rendered
   * instances. Kept separate from MaterialDefinition so grass/foliage looks
   * can use shader graphs without turning materials back into shader wrappers.
   */
  shaderDefinitionId: string | null;
  materialDefinitionId: string | null;
  /**
   * Optional wind / deform binding for this specific scatter layer. When
   * set, overrides the referenced GrassType / FlowerType's own `wind`
   * field at the scatter resolve step. Lets authors bind named wind
   * presets ("Gentle Breeze", "Gusty", etc.) per scatter without forking
   * a new grass-type. When null, the type-level wind flows through
   * unchanged (backwards-compatible with older authored surfaces).
   */
  deform?: ShaderReference | null;
}

export interface EmissionLayer extends LayerCommon {
  kind: "emission";
  content: EmissionContent;
}

export type Layer = AppearanceLayer | ScatterLayer | EmissionLayer;

export interface LayerFactoryOverrides {
  layerId?: string;
  displayName?: string;
  enabled?: boolean;
  opacity?: number;
  mask?: Mask;
}

function createLayerCommon(
  overrides: LayerFactoryOverrides
): LayerCommon {
  return {
    layerId: overrides.layerId ?? createUuid(),
    displayName: overrides.displayName ?? "Layer",
    enabled: overrides.enabled ?? true,
    opacity: overrides.opacity ?? 1,
    mask: overrides.mask ?? { kind: "always" }
  };
}

function appearanceLayerName(content: AppearanceContent): string {
  switch (content.kind) {
    case "color":
      return "Color";
    case "texture":
      return "Texture";
    case "material":
      return "Material";
    case "shader":
      return "Shader";
  }
}

function scatterLayerName(content: ScatterContent): string {
  switch (content.kind) {
    case "grass":
      return "Grass";
    case "flowers":
      return "Flowers";
    case "rocks":
      return "Rocks";
  }
}

function emissionLayerName(content: EmissionContent): string {
  switch (content.kind) {
    case "color":
      return "Emission";
    case "texture":
      return "Emission Texture";
    case "material":
      return "Emission Material";
  }
}

export function createAppearanceLayer(
  content: AppearanceContent,
  overrides: LayerFactoryOverrides & {
    blendMode?: BlendMode;
  } = {}
): AppearanceLayer {
  const common = createLayerCommon(overrides);
  return {
    ...common,
    kind: "appearance",
    displayName: overrides.displayName ?? appearanceLayerName(content),
    blendMode: overrides.blendMode ?? "mix",
    content
  };
}

export function createScatterLayer(
  content: ScatterContent,
  overrides: LayerFactoryOverrides & {
    shaderDefinitionId?: string | null;
    materialDefinitionId?: string | null;
    deform?: ShaderReference | null;
  } = {}
): ScatterLayer {
  const common = createLayerCommon(overrides);
  return {
    ...common,
    kind: "scatter",
    displayName: overrides.displayName ?? scatterLayerName(content),
    content,
    shaderDefinitionId: overrides.shaderDefinitionId ?? null,
    materialDefinitionId: overrides.materialDefinitionId ?? null,
    deform: overrides.deform ?? null
  };
}

export function createEmissionLayer(
  content: EmissionContent,
  overrides: LayerFactoryOverrides = {}
): EmissionLayer {
  const common = createLayerCommon(overrides);
  return {
    ...common,
    kind: "emission",
    displayName: overrides.displayName ?? emissionLayerName(content),
    content
  };
}

export function layerUsesLandscapeOnlyMask(layer: Layer): boolean {
  return maskUsesLandscapeOnlyInputs(layer.mask);
}
