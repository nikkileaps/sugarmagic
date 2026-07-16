/**
 * Scatter-contribution resolution (ADR 027, decision 2).
 *
 * Surface-ref layers resolve asymmetrically: for SHADING the referenced
 * surface composites as a masked unit; for SCATTER its nested scatter
 * layers must be FLATTENED out and realized as geometry, each gated by
 * the surface-ref layer's mask. Because the two paths differ, every
 * scatter build site must collect scatter the same way -- so it lives
 * here, once, instead of being re-implemented inline (which is how the
 * "surface-ref shaded but grew no grass" bug class kept recurring).
 *
 * A grass SURFACE painted onto an asset via a surface-ref layer must
 * actually grow blades. Each nested scatter layer is gated by the
 * surface-ref layer's own mask (the painted coverage) so grass appears
 * only where you painted; when the surface-ref carries a real
 * (non-"always") mask it wins over the nested scatter's own mask -- the
 * common case is a grass surface whose scatter mask is "always", painted
 * onto a rock.
 */

import type { Mask } from "@sugarmagic/domain";
import type { ResolvedScatterLayer, ResolvedSurfaceStack } from "./bindings";

/**
 * Flatten a resolved surface stack into the scatter layers it realizes,
 * descending into surface-ref layers with combined masks/opacity. The
 * returned layers are ready to hand to a scatter builder as-is.
 */
export function resolveScatterContributions(
  stack: ResolvedSurfaceStack,
  gate: { mask: Mask; opacity: number } | null = null
): ResolvedScatterLayer[] {
  const collected: ResolvedScatterLayer[] = [];
  for (const layer of stack.layers) {
    if (layer.enabled === false) {
      continue;
    }
    if (layer.kind === "scatter") {
      if (!gate) {
        collected.push(layer);
        continue;
      }
      collected.push({
        ...layer,
        mask: gate.mask.kind !== "always" ? gate.mask : layer.mask,
        opacity: layer.opacity * gate.opacity
      });
      continue;
    }
    if (layer.kind === "surface-ref") {
      const childGate: { mask: Mask; opacity: number } = {
        mask:
          layer.mask.kind !== "always"
            ? layer.mask
            : gate?.mask ?? layer.mask,
        opacity: (gate?.opacity ?? 1) * layer.opacity
      };
      collected.push(...resolveScatterContributions(layer.nested, childGate));
    }
  }
  return collected;
}
