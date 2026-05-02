/**
 * One-shot offscreen frame capture.
 *
 * Renders a Scene + Camera once through a fresh WebGPURenderer that shares
 * the engine's device (and therefore its compiled shaders / cached
 * resources), reads the canvas as a PNG blob, then disposes. Used by the
 * Item inspector's "Generate Thumbnail" flow — same render path the live
 * scene uses, no parallel renderer.
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type { WebRenderEngine } from "./engine/WebRenderEngine";

export interface CaptureFrameOptions {
  engine: WebRenderEngine;
  scene: THREE.Scene;
  camera: THREE.Camera;
  size: number;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Capture canvas failed to encode as PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export async function captureFrame(options: CaptureFrameOptions): Promise<Blob> {
  const device = await options.engine.ensureDevice();
  const renderer = new WebGPURenderer({ antialias: true, device });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const canvas = renderer.domElement as HTMLCanvasElement;
  canvas.width = options.size;
  canvas.height = options.size;
  renderer.setPixelRatio(1);
  renderer.setSize(options.size, options.size, false);
  await renderer.init();

  try {
    await renderer.renderAsync(options.scene, options.camera);
    return await canvasToPngBlob(canvas);
  } finally {
    renderer.dispose();
  }
}
