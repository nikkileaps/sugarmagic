/**
 * Layer blend math.
 *
 * Owns the shared per-channel blend helpers for appearance layers. This keeps
 * the layer-stack compositor readable while making the blend semantics easy to
 * test in isolation.
 */

import { mix } from "three/tsl";
import type { BlendMode } from "@sugarmagic/domain";

type BlendableNode = {
  add: (other: unknown) => unknown;
  mul: (other: unknown) => unknown;
};

export function blendLayerNode(
  mode: BlendMode,
  baseValue: unknown,
  layerValue: unknown,
  alpha: unknown
): unknown {
  if (mode === "base") {
    return layerValue;
  }
  if (mode === "mix" || mode === "overlay") {
    return mix(baseValue as never, layerValue as never, alpha as never);
  }
  if (mode === "multiply") {
    return mix(
      baseValue as never,
      (baseValue as BlendableNode).mul(layerValue) as never,
      alpha as never
    );
  }
  return (baseValue as BlendableNode).add(
    (layerValue as BlendableNode).mul(alpha)
  );
}
