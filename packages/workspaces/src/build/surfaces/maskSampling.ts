/**
 * Mask sampling helpers.
 *
 * Keeps the scalar preview sampling logic for authored masks in one place so
 * both the layer-row thumbnail and the full mask editor preview render the
 * same visual approximation.
 */

import type { Mask } from "@sugarmagic/domain";
import { samplePerlinNoise2d } from "@sugarmagic/domain";

export function sampleMask(mask: Mask, u: number, v: number): number {
  switch (mask.kind) {
    case "always":
      return 1;
    case "fresnel": {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return Math.max(
        0,
        Math.min(1, Math.pow(Math.min(1, distance * 2), mask.power) * mask.strength)
      );
    }
    case "height": {
      const height = 1 - v;
      if (height <= mask.min) {
        return 0;
      }
      if (height >= mask.max) {
        return 1;
      }
      return Math.max(
        0,
        Math.min(1, (height - mask.min) / Math.max(mask.fade, 0.001))
      );
    }
    case "vertex-color-channel":
      return mask.channel === "r" ? u : mask.channel === "g" ? v : mask.channel === "b" ? 1 - u : 1;
    case "splatmap-channel":
      return 1;
    case "texture":
    case "painted":
      return 0.75;
    case "perlin-noise": {
      const noise = samplePerlinNoise2d({
        x: (u + mask.offset[0]) * mask.scale,
        y: (v + mask.offset[1]) * mask.scale
      });
      const start = mask.threshold - mask.fade;
      const end = mask.threshold + mask.fade;
      if (noise <= start) return 0;
      if (noise >= end) return 1;
      return (noise - start) / Math.max(end - start, 0.001);
    }
    case "voronoi": {
      const cellX = u / Math.max(mask.cellSize, 0.001);
      const cellY = v / Math.max(mask.cellSize, 0.001);
      const fractX = cellX - Math.floor(cellX);
      const fractY = cellY - Math.floor(cellY);
      const edgeDistance = Math.min(
        Math.min(fractX, 1 - fractX),
        Math.min(fractY, 1 - fractY)
      );
      return 1 - Math.max(0, Math.min(1, edgeDistance / Math.max(mask.borderWidth, 0.001)));
    }
    case "world-position-gradient": {
      const axisValue = mask.axis === "x" ? u : mask.axis === "y" ? 1 - v : v;
      if (axisValue <= mask.min - mask.fade) return 0;
      if (axisValue >= mask.max + mask.fade) return 1;
      return (axisValue - (mask.min - mask.fade)) / Math.max(mask.max - mask.min + mask.fade * 2, 0.001);
    }
  }
}
