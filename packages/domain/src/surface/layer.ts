/**
 * Surface layer primitives.
 *
 * Owns the canonical authored shapes that can appear inside one Surface stack:
 * masks, blend modes, appearance/scatter/emission content, and the layer
 * factories that keep the base-layer invariant centralized.
 */

import { createUuid } from "../shared/identity";

export type BlendMode = "base" | "mix" | "multiply" | "add" | "overlay";

export type Mask =
  | { kind: "always" }
  | {
      kind: "texture";
      textureDefinitionId: string;
      channel: "r" | "g" | "b" | "a";
    }
  | { kind: "splatmap-channel"; channelIndex: number }
  | { kind: "fresnel"; power: number; strength: number }
  | {
      kind: "vertex-color-channel";
      channel: "r" | "g" | "b" | "a";
    }
  | { kind: "height"; min: number; max: number; fade: number };

export type AppearanceContent =
  | { kind: "color"; color: number }
  | {
      kind: "texture";
      textureDefinitionId: string;
      tiling: [number, number];
    }
  | { kind: "material"; materialDefinitionId: string }
  | {
      kind: "shader";
      shaderDefinitionId: string;
      parameterValues: Record<string, unknown>;
      textureBindings: Record<string, string>;
    };

export type ScatterContent =
  | { kind: "grass"; grassTypeId: string }
  | { kind: "flowers"; flowerTypeId: string };

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
  overrides: LayerFactoryOverrides = {}
): ScatterLayer {
  const common = createLayerCommon(overrides);
  return {
    ...common,
    kind: "scatter",
    displayName: overrides.displayName ?? scatterLayerName(content),
    content
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
  return layer.mask.kind === "splatmap-channel";
}
