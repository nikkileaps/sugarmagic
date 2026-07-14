/**
 * Surface Studio UV / Mask panel (Plan 068.10c).
 *
 * Draws the selected layer's painted mask with the asset's paint-UV
 * (uv1) island wireframe over it -- the Substance-style UV view. Lets you
 * see how the atlas islands land, where the mask coverage sits, and spot
 * seams/stretch the 3D view hides.
 *
 * The mask canvas is stored texture-space (V flipped: painting writes to
 * (u*w, (1-v)*h)), so it's drawn as-is and UV points are placed at
 * (u*W, (1-v)*H) to align exactly.
 */

import { useEffect, useRef } from "react";
import { Box } from "@mantine/core";

const RESOLUTION = 512;

export interface SurfaceStudioUvPanelProps {
  /** Live mask pixels for the selected layer (null when none). */
  maskCanvas: HTMLCanvasElement | null;
  /** Flattened paint-UV triangles: [u0,v0,u1,v1,u2,v2, ...]. */
  uvTriangles: number[] | null;
  /** Bumps when the mask pixels change so the panel repaints. */
  maskVersion: number;
}

export function SurfaceStudioUvPanel({
  maskCanvas,
  uvTriangles,
  maskVersion
}: SurfaceStudioUvPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const size = RESOLUTION;
    ctx.clearRect(0, 0, size, size);

    // Backing checker so a black (empty) mask is distinguishable from
    // "nothing loaded".
    ctx.fillStyle = "#1a1b26";
    ctx.fillRect(0, 0, size, size);

    // Mask coverage (grayscale) filling the UV square.
    if (maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(maskCanvas, 0, 0, size, size);
      ctx.globalAlpha = 1;
    }

    // Paint-UV island wireframe.
    if (uvTriangles && uvTriangles.length >= 6) {
      ctx.strokeStyle = "rgba(203, 166, 247, 0.55)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 0; i + 5 < uvTriangles.length; i += 6) {
        const ax = uvTriangles[i]! * size;
        const ay = (1 - uvTriangles[i + 1]!) * size;
        const bx = uvTriangles[i + 2]! * size;
        const by = (1 - uvTriangles[i + 3]!) * size;
        const cx = uvTriangles[i + 4]! * size;
        const cy = (1 - uvTriangles[i + 5]!) * size;
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(cx, cy);
        ctx.closePath();
      }
      ctx.stroke();
    }

    // UV bounds outline.
    ctx.strokeStyle = "var(--sm-panel-border)";
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }, [maskCanvas, uvTriangles, maskVersion]);

  return (
    <Box
      style={{
        aspectRatio: "1 / 1",
        width: "100%",
        borderRadius: "var(--sm-radius-sm)",
        overflow: "hidden",
        border: "1px solid var(--sm-panel-border)"
      }}
    >
      <canvas
        ref={canvasRef}
        width={RESOLUTION}
        height={RESOLUTION}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </Box>
  );
}
