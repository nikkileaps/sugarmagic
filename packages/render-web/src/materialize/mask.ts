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
  normalWorld,
  positionViewDirection,
  positionWorld,
  pow,
  smoothstep,
  texture,
  vertexColor
} from "three/tsl";
import type { ContentLibrarySnapshot, Mask } from "@sugarmagic/domain";
import { getTextureDefinition } from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";

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
  }
}
