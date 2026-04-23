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
  splatmapWeightNode?: (channelIndex: number) => unknown | null;
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
      const textureObject = texture(resolvedTexture, context.uvNode as never);
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
        positionWorld.y
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
      const axisNode =
        mask.axis === "x"
          ? positionWorld.x
          : mask.axis === "y"
            ? positionWorld.y
            : positionWorld.z;
      return smoothstep(
        float(mask.min - mask.fade),
        float(mask.max + mask.fade),
        axisNode
      );
    }
  }
}
