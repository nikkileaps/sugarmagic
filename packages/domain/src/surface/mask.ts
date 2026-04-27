/**
 * Surface-layer mask primitives.
 *
 * Owns the canonical authored mask sources that can gate one surface layer.
 * runtime-core and render-web both consume this union directly so mask meaning
 * stays single-sourced across landscape, asset-slot, and preview rendering.
 */

export type Mask =
  | { kind: "always" }
  | {
      kind: "texture";
      textureDefinitionId: string;
      channel: "r" | "g" | "b" | "a";
    }
  | {
      kind: "painted";
      maskTextureId: string | null;
    }
  | { kind: "splatmap-channel"; channelIndex: number }
  | { kind: "fresnel"; power: number; strength: number }
  | {
      kind: "vertex-color-channel";
      channel: "r" | "g" | "b" | "a";
    }
  | { kind: "height"; min: number; max: number; fade: number }
  | {
      kind: "perlin-noise";
      scale: number;
      offset: [number, number];
      threshold: number;
      fade: number;
    }
  | {
      kind: "voronoi";
      cellSize: number;
      borderWidth: number;
    }
  | {
      kind: "world-position-gradient";
      axis: "x" | "y" | "z";
      min: number;
      max: number;
      fade: number;
    };

export type PaintedMaskTargetAddress =
  | {
      scope: "landscape-channel";
      channelKey: string;
      layerId: string;
    }
  | {
      scope: "asset-slot";
      assetDefinitionId: string;
      slotName: string;
      layerId: string;
    };

export function cloneMask(mask: Mask): Mask {
  switch (mask.kind) {
    case "texture":
      return { ...mask };
    case "painted":
      return { ...mask };
    case "splatmap-channel":
      return { ...mask };
    case "fresnel":
      return { ...mask };
    case "vertex-color-channel":
      return { ...mask };
    case "height":
      return { ...mask };
    case "perlin-noise":
      return {
        ...mask,
        offset: [...mask.offset] as [number, number]
      };
    case "voronoi":
      return { ...mask };
    case "world-position-gradient":
      return { ...mask };
    case "always":
      return { kind: "always" };
  }
}

export function maskUsesLandscapeOnlyInputs(mask: Mask): boolean {
  return mask.kind === "splatmap-channel";
}
