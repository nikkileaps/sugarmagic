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
  | {
      kind: "height";
      min: number;
      max: number;
      fade: number;
      /** Coordinate space for the ramp (Plan 068.10). "local" (the
       *  default) normalizes the Y axis to the mesh's local bounding
       *  box -- 0 = bottom, 1 = top -- so a per-asset gradient is
       *  placement/scale independent and matches the mask preview.
       *  "world" ramps over raw world Y (terrain-scale height bands). */
      space?: "world" | "local";
    }
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
      /** See height.space. "local" (default) normalizes the chosen
       *  axis to the mesh's local bounds; "world" ramps over raw
       *  world coordinates. */
      space?: "world" | "local";
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
    }
  /** Plan 068.4 — a painted layer living on a PLACED INSTANCE's
   *  surface override (base instance, scene-contained instance, or a
   *  Scene's restyle record). Strokes hit-test against this instance
   *  only. */
  | {
      scope: "instance-slot";
      instanceId: string;
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
