/**
 * Live painted-mask pixel registry (Plan 068.8).
 *
 * The paint overlay updates a mask's canvas in place and uploads it
 * to the GPU immediately -- but CPU scatter placement used to sample
 * the ASSET RESOLVER's texture, whose image swaps asynchronously when
 * the mask file's blob URL refreshes. Rebuilds raced that reload and
 * sampled stale pixels (filled-black masks still placed full grass).
 *
 * Hosts register the live canvas here whenever they push paint
 * pixels; scatter sampling consults this registry FIRST and falls
 * back to the resolver texture only for masks never painted this
 * session. Pixels are snapshotted at registration time (one
 * getImageData per preview push), so sampling is synchronous and
 * never observes a half-loaded image.
 */

interface LiveMaskEntry {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const liveMasks = new Map<string, LiveMaskEntry>();

export function registerLivePaintedMask(
  maskTextureId: string,
  canvas: HTMLCanvasElement
): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width <= 0 || canvas.height <= 0) {
    return;
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  liveMasks.set(maskTextureId, {
    width: image.width,
    height: image.height,
    data: image.data
  });
}

export function sampleLivePaintedMask(
  maskTextureId: string,
  uv: [number, number]
): number | null {
  const entry = liveMasks.get(maskTextureId);
  if (!entry) {
    return null;
  }
  const wrappedU = ((uv[0] % 1) + 1) % 1;
  const wrappedV = ((uv[1] % 1) + 1) % 1;
  const x = Math.min(entry.width - 1, Math.max(0, Math.floor(wrappedU * entry.width)));
  const y = Math.min(
    entry.height - 1,
    Math.max(0, Math.floor((1 - wrappedV) * entry.height))
  );
  return entry.data[(y * entry.width + x) * 4]! / 255;
}

export function clearLivePaintedMasks(): void {
  liveMasks.clear();
}
