/**
 * Mask sampling helpers.
 *
 * Keeps the scalar preview sampling logic for authored masks in one place so
 * both the layer-row thumbnail and the full mask editor preview render the
 * same visual approximation.
 */

import { useMemo } from "react";
import type { Mask } from "@sugarmagic/domain";
import { samplePerlinNoise2d } from "@sugarmagic/domain";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";

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


/**
 * Preview sampler that shows REAL pixels for painted masks (Plan
 * 068.8 QoL -- the flat 0.75 placeholder made every painted mask
 * preview a lie; a black-filled mask looked identical to a white
 * one). Procedural masks keep the approximation from sampleMask.
 */
export function useMaskPreviewSampler(
  mask: Mask
): (u: number, v: number) => number {
  const { getPaintedMaskPreviewCanvas, paintedMaskPreviewVersion } =
    useSurfaceAuthoring();
  const maskTextureId = mask.kind === "painted" ? mask.maskTextureId : null;

  return useMemo(() => {
    if (mask.kind !== "painted" || !maskTextureId) {
      return (u: number, v: number) => sampleMask(mask, u, v);
    }
    const canvas = getPaintedMaskPreviewCanvas?.(maskTextureId) ?? null;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return (u: number, v: number) => sampleMask(mask, u, v);
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return (u: number, v: number) => {
      const x = Math.min(
        image.width - 1,
        Math.max(0, Math.floor(u * image.width))
      );
      const y = Math.min(
        image.height - 1,
        Math.max(0, Math.floor((1 - v) * image.height))
      );
      return image.data[(y * image.width + x) * 4] / 255;
    };
    // paintedMaskPreviewVersion invalidates the pixel snapshot after
    // strokes/fills commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mask,
    maskTextureId,
    getPaintedMaskPreviewCanvas,
    paintedMaskPreviewVersion
  ]);
}
