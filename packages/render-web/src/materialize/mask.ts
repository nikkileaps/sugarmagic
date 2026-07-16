/**
 * Layer-mask materialization.
 *
 * Evaluates authored layer masks into scalar TSL nodes. ShaderRuntime and the
 * shared surface compositor use this so masks mean the same thing everywhere
 * render-web realizes a layer stack.
 */

import {
  abs,
  dot,
  float,
  min,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  vec2,
  vertexColor
} from "three/tsl";
import type { ContentLibrarySnapshot, Mask } from "@sugarmagic/domain";
import { getMaskTextureDefinition, getTextureDefinition } from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import { materializePerlinLikeNoise2d } from "./noise";

export interface LayerMaskMaterializeContext {
  contentLibrary: ContentLibrarySnapshot;
  assetResolver: AuthoredAssetResolver;
  uvNode: unknown;
  /** Plan 068.8 -- painted masks sample the PAINT UV channel
   *  (TEXCOORD_1) when the geometry carries one; authored UVs on
   *  real assets overlap and are unpaintable. Falls back to uvNode
   *  when absent. Only the painted kind uses this. */
  paintUvNode?: unknown;
  splatmapWeightNode?: (channelIndex: number) => unknown | null;
  /** Local (object-space) bounding box of the geometry the mask is
   *  materialized against (Plan 068.10). Height / Gradient masks in
   *  "local" space normalize the ramp to these bounds so a per-asset
   *  gradient is placement/scale independent. Absent -> those masks
   *  fall back to world space. */
  localBounds?: {
    min: [number, number, number];
    size: [number, number, number];
  } | null;
}

/** Normalized 0..1 coordinate along `axis` of the mesh's LOCAL bounds,
 *  or raw world position when local bounds are unavailable / the mask
 *  is in world space. Missing `space` defaults to "world" -- ONLY an
 *  explicitly-authored "local" normalizes to bounds. This preserves the
 *  pre-068.10 behavior for legacy masks (which have no `space` and always
 *  ramped over world position); the MaskEditor writes `space: "local"`
 *  explicitly on new masks, so per-asset gradients still default local
 *  for new content. Defaulting undefined->local silently reinterpreted
 *  legacy height/gradient masks (e.g. the flat landscape plane, local-Y
 *  extent ~0) into degenerate output. */
function gradientAxisNode(
  axis: "x" | "y" | "z",
  space: "world" | "local" | undefined,
  bounds: LayerMaskMaterializeContext["localBounds"]
): unknown {
  const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const worldNode =
    axis === "x"
      ? positionWorld.x
      : axis === "y"
        ? positionWorld.y
        : positionWorld.z;
  if (space !== "local" || !bounds) {
    return worldNode;
  }
  const localNode =
    axis === "x"
      ? positionLocal.x
      : axis === "y"
        ? positionLocal.y
        : positionLocal.z;
  const extent = Math.max(bounds.size[axisIndex], 0.0001);
  return (localNode as { sub: (o: unknown) => { div: (o: unknown) => unknown } })
    .sub(float(bounds.min[axisIndex]))
    .div(float(extent));
}

export function evaluateLayerMask(
  mask: Mask,
  context: LayerMaskMaterializeContext
): unknown {
  switch (mask.kind) {
    case "always":
      return float(1);
    case "texture": {
      const definition = getTextureDefinition(
        context.contentLibrary,
        mask.textureDefinitionId
      );
      if (!definition) {
        return float(0);
      }
      const resolvedTexture = context.assetResolver.resolveTextureDefinition(definition);
      const sample = texture(resolvedTexture, context.uvNode as never);
      return sample[mask.channel];
    }
    case "painted": {
      if (!mask.maskTextureId) {
        return float(0);
      }
      const definition = getMaskTextureDefinition(
        context.contentLibrary,
        mask.maskTextureId
      );
      if (!definition) {
        return float(0);
      }
      const resolvedTexture = context.assetResolver.resolveMaskTextureDefinition(
        definition
      );
      const textureObject = texture(
        resolvedTexture,
        (context.paintUvNode ?? context.uvNode) as never
      );
      return textureObject.r;
    }
    case "splatmap-channel":
      return context.splatmapWeightNode?.(mask.channelIndex) ?? float(1);
    case "fresnel":
      return pow(
        float(1).sub(abs(dot(normalWorld, positionViewDirection))),
        float(Math.max(mask.power, 0.0001))
      ).mul(float(mask.strength));
    case "vertex-color-channel": {
      const colorNode = vertexColor();
      return colorNode[mask.channel];
    }
    case "height": {
      const fade = Math.max(mask.fade, 0.0001);
      return smoothstep(
        float(mask.min - fade),
        float(mask.max + fade),
        gradientAxisNode("y", mask.space, context.localBounds) as never
      );
    }
    case "perlin-noise": {
      const uv = context.uvNode as {
        mul: (other: unknown) => unknown;
        add: (other: unknown) => unknown;
      };
      const scaledUv = uv.mul(float(mask.scale)) as {
        add: (other: unknown) => unknown;
      };
      const coord = scaledUv.add(vec2(mask.offset[0], mask.offset[1])) as never;
      const noise = materializePerlinLikeNoise2d(coord);
      return smoothstep(
        float(mask.threshold - mask.fade),
        float(mask.threshold + mask.fade),
        noise as never
      );
    }
    case "voronoi": {
      const cellSize = Math.max(mask.cellSize, 0.0001);
      const scaledX = positionWorld.x.div(float(cellSize));
      const scaledZ = positionWorld.z.div(float(cellSize));
      const edgeX = abs(sin(scaledX.mul(float(Math.PI))));
      const edgeZ = abs(sin(scaledZ.mul(float(Math.PI))));
      return min(edgeX, edgeZ).smoothstep(
        float(0),
        float(Math.max(mask.borderWidth, 0.0001))
      );
    }
    case "world-position-gradient": {
      const axisNode = gradientAxisNode(
        mask.axis,
        mask.space,
        context.localBounds
      );
      return smoothstep(
        float(mask.min - mask.fade),
        float(mask.max + mask.fade),
        axisNode as never
      );
    }
  }
}
