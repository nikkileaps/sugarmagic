/**
 * Painted-mask file IO helpers.
 *
 * Owns browser-side creation, readback, and writeback of the PNG files
 * referenced by `MaskTextureDefinition`. This keeps mask pixels in the
 * project directory as authored assets instead of embedding binary data in
 * the content-library document.
 */

import { readBlobFile, writeBlobFile } from "../fs-access";

type WritableCanvas = OffscreenCanvas | HTMLCanvasElement;

function createWritableCanvas(width: number, height: number): WritableCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  throw new Error("Canvas APIs are unavailable in this environment.");
}

function get2dContext(canvas: WritableCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire a 2D canvas context for mask painting.");
  }
  return context;
}

async function canvasToPngBlob(canvas: WritableCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }

  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode painted mask canvas as PNG."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function normalizeRelativePath(relativePath: string): string[] {
  return relativePath.split("/").filter(Boolean);
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    bitmap.close();
    throw new Error(
      "Painted mask PNG decoded to a zero-sized image. The file was likely written with an invalid canvas encode path."
    );
  }
  const canvas = createWritableCanvas(bitmap.width, bitmap.height);
  const context = get2dContext(canvas);
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function createBlankMaskFile(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
  resolution: [number, number],
  format: "r8" | "rgba8" = "r8"
): Promise<void> {
  const [width, height] = resolution;
  const canvas = createWritableCanvas(width, height);
  const context = get2dContext(canvas);
  const image = context.createImageData(width, height);

  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index + 0] = 0;
    image.data[index + 1] = format === "rgba8" ? 0 : 0;
    image.data[index + 2] = format === "rgba8" ? 0 : 0;
    image.data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  await writeBlobFile(handle, normalizeRelativePath(relativePath), await canvasToPngBlob(canvas));
}

export async function writeMaskFile(
  handle: FileSystemDirectoryHandle,
  relativePath: string,
  source:
    | WritableCanvas
    | ImageData
): Promise<void> {
  let blob: Blob;
  if (source instanceof ImageData) {
    const canvas = createWritableCanvas(source.width, source.height);
    const context = get2dContext(canvas);
    context.putImageData(source, 0, 0);
    blob = await canvasToPngBlob(canvas);
  } else {
    blob = await canvasToPngBlob(source);
  }
  await writeBlobFile(handle, normalizeRelativePath(relativePath), blob);
}

export async function readMaskFile(
  handle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<ImageData | null> {
  const blob = await readBlobFile(handle, ...normalizeRelativePath(relativePath));
  if (!blob) {
    return null;
  }
  try {
    return await blobToImageData(blob);
  } catch {
    return null;
  }
}
