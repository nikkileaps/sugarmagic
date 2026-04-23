/**
 * MaskPreview
 *
 * Generic grayscale preview for a scalar field in [0, 1]. It knows nothing
 * about Sugarmagic masks beyond the caller-provided sample function.
 */

import { useEffect, useRef } from "react";

export interface MaskPreviewProps {
  resolution?: number;
  sample: (u: number, v: number) => number;
}

export function MaskPreview({
  resolution = 48,
  sample
}: MaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const image = context.createImageData(resolution, resolution);
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const value = Math.max(0, Math.min(1, sample(x / (resolution - 1), y / (resolution - 1))));
        const channel = Math.round(value * 255);
        const offset = (y * resolution + x) * 4;
        image.data[offset] = channel;
        image.data[offset + 1] = channel;
        image.data[offset + 2] = channel;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [resolution, sample]);

  return (
    <canvas
      ref={canvasRef}
      width={resolution}
      height={resolution}
      style={{
        width: 72,
        height: 72,
        borderRadius: 6,
        border: "1px solid var(--sm-panel-border)",
        background: "var(--sm-color-base)",
        imageRendering: "pixelated"
      }}
    />
  );
}
