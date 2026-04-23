/**
 * Surface-layer overrides.
 *
 * Owns the bounded override model for reference-bound Surfaces. This keeps
 * "tuning a reused layer" distinct from "authoring a different layer" by
 * structurally freezing identity and reference ids.
 */

import type {
  AppearanceLayer,
  BlendMode,
  EmissionLayer,
  Layer,
  ScatterLayer
} from "./layer";
import type { Mask } from "./mask";

interface LayerOverrideBase {
  layerId: string;
  targetKind: Layer["kind"];
  enabled?: boolean;
  opacity?: number;
  mask?: Mask;
}

export interface AppearanceLayerOverride extends LayerOverrideBase {
  targetKind: "appearance";
  blendMode?: BlendMode;
  contentTuning?:
    | { for: "texture"; tiling?: [number, number] }
    | {
        for: "material";
        parameterOverrides?: Record<string, unknown>;
        textureBindingOverrides?: Record<string, string>;
      }
    | {
        for: "shader";
        parameterValues?: Partial<Record<string, unknown>>;
        textureBindings?: Partial<Record<string, string>>;
      };
}

export interface ScatterLayerOverride extends LayerOverrideBase {
  targetKind: "scatter";
  densityMultiplier?: number;
}

export interface EmissionLayerOverride extends LayerOverrideBase {
  targetKind: "emission";
  contentTuning?:
    | { for: "color"; intensity?: number }
    | {
        for: "texture";
        intensity?: number;
        tiling?: [number, number];
      }
    | {
        for: "material";
        parameterOverrides?: Record<string, unknown>;
        textureBindingOverrides?: Record<string, string>;
      };
}

export type LayerOverride =
  | AppearanceLayerOverride
  | ScatterLayerOverride
  | EmissionLayerOverride;

export interface LayerOverrideDiagnostic {
  severity: "warning";
  layerId: string;
  message: string;
}

function applyCommonLayerOverride<TLayer extends Layer>(
  layer: TLayer,
  override: LayerOverrideBase
): TLayer {
  return {
    ...layer,
    ...(override.enabled === undefined ? {} : { enabled: override.enabled }),
    ...(override.opacity === undefined ? {} : { opacity: override.opacity }),
    ...(override.mask === undefined ? {} : { mask: override.mask })
  };
}

function applyAppearanceContentTuning(
  layer: AppearanceLayer,
  override: AppearanceLayerOverride
): {
  layer: AppearanceLayer;
  diagnostics: LayerOverrideDiagnostic[];
} {
  if (!override.contentTuning) {
    return {
      layer:
        override.blendMode === undefined
          ? layer
          : {
              ...layer,
              blendMode: override.blendMode
            },
      diagnostics: []
    };
  }

  const nextLayer: AppearanceLayer = {
    ...layer,
    ...(override.blendMode === undefined ? {} : { blendMode: override.blendMode })
  };

  switch (layer.content.kind) {
    case "color":
      return { layer: nextLayer, diagnostics: [] };
    case "texture":
      if (override.contentTuning.for !== "texture") {
        return {
          layer: nextLayer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride content tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer: {
          ...nextLayer,
          content: {
            ...layer.content,
            ...(override.contentTuning.tiling
              ? { tiling: [...override.contentTuning.tiling] as [number, number] }
              : {})
          }
        },
        diagnostics: []
      };
    case "material":
      if (override.contentTuning.for !== "material") {
        return {
          layer: nextLayer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride content tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer: nextLayer,
        diagnostics: []
      };
    case "shader":
      if (override.contentTuning.for !== "shader") {
        return {
          layer: nextLayer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride content tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer: {
          ...nextLayer,
          content: {
            ...layer.content,
            parameterValues: {
              ...layer.content.parameterValues,
              ...(override.contentTuning.parameterValues ?? {})
            },
            textureBindings: Object.fromEntries(
              Object.entries({
                ...layer.content.textureBindings,
                ...(override.contentTuning.textureBindings ?? {})
              }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
            )
          }
        },
        diagnostics: []
      };
  }
}

function applyEmissionContentTuning(
  layer: EmissionLayer,
  override: EmissionLayerOverride
): {
  layer: EmissionLayer;
  diagnostics: LayerOverrideDiagnostic[];
} {
  if (!override.contentTuning) {
    return { layer, diagnostics: [] };
  }

  switch (layer.content.kind) {
    case "color":
      if (override.contentTuning.for !== "color") {
        return {
          layer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride emission tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer: {
          ...layer,
          content: {
            ...layer.content,
            ...(override.contentTuning.intensity !== undefined
              ? { intensity: override.contentTuning.intensity }
              : {})
          }
        },
        diagnostics: []
      };
    case "texture":
      if (override.contentTuning.for !== "texture") {
        return {
          layer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride emission tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer: {
          ...layer,
          content: {
            ...layer.content,
            ...(override.contentTuning.intensity !== undefined
              ? { intensity: override.contentTuning.intensity }
              : {}),
            ...(override.contentTuning.tiling
              ? { tiling: [...override.contentTuning.tiling] as [number, number] }
              : {})
          }
        },
        diagnostics: []
      };
    case "material":
      if (override.contentTuning.for !== "material") {
        return {
          layer,
          diagnostics: [
            {
              severity: "warning",
              layerId: layer.layerId,
              message: `LayerOverride emission tuning expected "${override.contentTuning.for}" but layer "${layer.layerId}" is "${layer.content.kind}".`
            }
          ]
        };
      }
      return {
        layer,
        diagnostics: []
      };
  }
}

export function applyLayerOverride(
  layer: Layer,
  override: LayerOverride | null | undefined
): {
  layer: Layer;
  diagnostics: LayerOverrideDiagnostic[];
  densityMultiplier: number;
} {
  if (!override) {
    return {
      layer,
      diagnostics: [],
      densityMultiplier: 1
    };
  }

  if (override.layerId !== layer.layerId) {
    return {
      layer,
      diagnostics: [
        {
          severity: "warning",
          layerId: override.layerId,
          message: `LayerOverride references missing layer "${override.layerId}".`
        }
      ],
      densityMultiplier: 1
    };
  }

  if (override.targetKind !== layer.kind) {
    return {
      layer,
      diagnostics: [
        {
          severity: "warning",
          layerId: override.layerId,
          message: `LayerOverride kind "${override.targetKind}" no longer matches layer "${layer.layerId}" kind "${layer.kind}".`
        }
      ],
      densityMultiplier: 1
    };
  }

  if (layer.kind === "appearance") {
    const common = applyCommonLayerOverride(layer, override as AppearanceLayerOverride);
    const result = applyAppearanceContentTuning(common, override as AppearanceLayerOverride);
    return {
      layer: result.layer,
      diagnostics: result.diagnostics,
      densityMultiplier: 1
    };
  }

  if (layer.kind === "scatter") {
    return {
      layer: applyCommonLayerOverride(layer, override),
      diagnostics: [],
      densityMultiplier:
        override.targetKind === "scatter"
          ? Math.max(0, override.densityMultiplier ?? 1)
          : 1
    };
  }

  const common = applyCommonLayerOverride(layer, override);
  const result = applyEmissionContentTuning(common, override as EmissionLayerOverride);
  return {
    layer: result.layer,
    diagnostics: result.diagnostics,
    densityMultiplier: 1
  };
}
