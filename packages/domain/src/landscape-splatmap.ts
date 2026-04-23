/**
 * Canonical landscape splatmap byte-buffer model.
 *
 * Owns the authored paint-layer payload semantics for region landscapes. This
 * stays in domain because it is renderer-free, serialization-aware, and used
 * by both shell draft editing and render/runtime consumers.
 */

import type { RegionLandscapePaintPayload } from "./region-authoring/index";

function bytesToBase64(bytes: Uint8Array): string {
  const bufferApi = (
    globalThis as {
      Buffer?: { from: (value: Uint8Array) => { toString: (encoding: string) => string } };
    }
  ).Buffer;
  if (bufferApi) {
    return bufferApi.from(bytes).toString("base64");
  }

  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const bufferApi = (
    globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array } }
  ).Buffer;
  if (bufferApi) {
    return new Uint8Array(bufferApi.from(encoded, "base64"));
  }

  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export interface LandscapePaintSample {
  channelIndex: number;
  centerU: number;
  centerV: number;
  radiusUV: number;
  strength: number;
  falloff: number;
}

export class LandscapeSplatmap {
  private buffers: Uint8Array[] = [];
  private channelCount = 0;
  readonly resolution: number;

  constructor(resolution: number) {
    this.resolution = resolution;
    this.ensureTextureCount(1);
  }

  getBuffers(): readonly Uint8Array[] {
    return this.buffers;
  }

  sampleChannelWeight(
    channelIndex: number,
    u: number,
    v: number
  ): number {
    const x = Math.max(0, Math.min(this.resolution - 1, Math.floor(u * this.resolution)));
    const y = Math.max(0, Math.min(this.resolution - 1, Math.floor(v * this.resolution)));
    const pixelIndex = (y * this.resolution + x) * 4;

    if (channelIndex === 0) {
      let paintedSum = 0;
      for (const buffer of this.buffers) {
        for (let component = 0; component < 4; component += 1) {
          paintedSum += buffer[pixelIndex + component]! / 255;
        }
      }
      return Math.max(0, Math.min(1, 1 - paintedSum));
    }

    const storageIndex = channelIndex - 1;
    const textureIndex = Math.floor(storageIndex / 4);
    const componentIndex = storageIndex % 4;
    const buffer = this.buffers[textureIndex];
    if (!buffer) {
      return 0;
    }
    return buffer[pixelIndex + componentIndex]! / 255;
  }

  sampleAllChannelWeights(channelCount: number, u: number, v: number): number[] {
    const weights: number[] = [];
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      weights.push(this.sampleChannelWeight(channelIndex, u, v));
    }
    return weights;
  }

  ensureChannelCount(channelCount: number): void {
    this.channelCount = channelCount;
    const paintableChannels = Math.max(0, channelCount - 1);
    const texturesNeeded = Math.max(1, Math.ceil(paintableChannels / 4));
    this.ensureTextureCount(texturesNeeded);
  }

  clear(): void {
    for (const buffer of this.buffers) {
      buffer.fill(0);
    }
  }

  load(payload: RegionLandscapePaintPayload | null, channelCount: number): void {
    this.ensureChannelCount(channelCount);
    this.clear();

    if (!payload) {
      return;
    }

    for (let index = 0; index < Math.min(payload.layers.length, this.buffers.length); index += 1) {
      const bytes = base64ToBytes(payload.layers[index]!);
      this.buffers[index]!.set(bytes.subarray(0, this.buffers[index]!.length));
    }
  }

  paint(sample: LandscapePaintSample): void {
    if (sample.channelIndex < 1) return;

    const storageIndex = sample.channelIndex - 1;
    const textureIndex = Math.floor(storageIndex / 4);
    const componentIndex = storageIndex % 4;
    if (textureIndex >= this.buffers.length) return;

    const targetBuffer = this.buffers[textureIndex]!;
    const resolution = this.resolution;
    const centerX = sample.centerU * resolution;
    const centerY = sample.centerV * resolution;
    const radius = sample.radiusUV * resolution;
    const radiusSquared = radius * radius;

    const x0 = Math.max(0, Math.floor(centerX - radius));
    const y0 = Math.max(0, Math.floor(centerY - radius));
    const x1 = Math.min(resolution - 1, Math.ceil(centerX + radius));
    const y1 = Math.min(resolution - 1, Math.ceil(centerY + radius));

    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const dx = px - centerX;
        const dy = py - centerY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radiusSquared) continue;

        const distance = Math.sqrt(distanceSquared);
        const normalizedDistance = radius <= 0 ? 0 : distance / radius;
        const falloffMultiplier =
          1 - Math.pow(normalizedDistance, 1 / Math.max(sample.falloff, 0.01));
        const delta = sample.strength * falloffMultiplier;
        const pixelIndex = (py * resolution + px) * 4;

        const current = targetBuffer[pixelIndex + componentIndex]! / 255;
        const next = Math.max(0, Math.min(1, current + delta));
        targetBuffer[pixelIndex + componentIndex] = Math.round(next * 255);

        if (delta > 0) {
          let paintedSum = 0;
          const componentRefs: Array<{
            buffer: Uint8Array;
            offset: number;
            channelIndex: number;
          }> = [];
          for (let channelIndex = 1; channelIndex < this.channelCount; channelIndex += 1) {
            const storedIndex = channelIndex - 1;
            const layerTextureIndex = Math.floor(storedIndex / 4);
            const layerComponentIndex = storedIndex % 4;
            const buffer = this.buffers[layerTextureIndex];
            if (!buffer) continue;
            const offset = pixelIndex + layerComponentIndex;
            paintedSum += buffer[offset]! / 255;
            componentRefs.push({ buffer, offset, channelIndex });
          }

          if (paintedSum > 1) {
            const othersSum = paintedSum - next;
            const scale = othersSum <= 0 ? 0 : Math.max(0, 1 - next) / othersSum;
            for (const component of componentRefs) {
              if (component.channelIndex === sample.channelIndex) continue;
              component.buffer[component.offset] = Math.round(
                (component.buffer[component.offset]! / 255) * scale * 255
              );
            }
          }
        }
      }
    }
  }

  serialize(): RegionLandscapePaintPayload | null {
    const relevantBuffers = this.buffers.filter((_, index) => {
      const highestChannelIndex = (index + 1) * 4;
      return highestChannelIndex <= Math.max(4, this.channelCount - 1) || index === 0;
    });

    const hasPaint = relevantBuffers.some((buffer) => {
      for (const value of buffer) {
        if (value !== 0) return true;
      }
      return false;
    });

    if (!hasPaint) {
      return null;
    }

    return {
      version: 1,
      resolution: this.resolution,
      layers: relevantBuffers.map((buffer) => bytesToBase64(buffer))
    };
  }

  renderChannelMask(channelIndex: number, targetCanvas: HTMLCanvasElement): void {
    const thumbSize = 64;
    targetCanvas.width = thumbSize;
    targetCanvas.height = thumbSize;
    const context = targetCanvas.getContext("2d");
    if (!context) return;

    const output = context.createImageData(thumbSize, thumbSize);
    const data = output.data;
    const scale = this.resolution / thumbSize;

    for (let ty = 0; ty < thumbSize; ty += 1) {
      for (let tx = 0; tx < thumbSize; tx += 1) {
        const sourceX = Math.floor(tx * scale);
        const sourceY = Math.floor(ty * scale);
        const pixelIndex = (sourceY * this.resolution + sourceX) * 4;
        let value = 0;

        if (channelIndex === 0) {
          let paintedSum = 0;
          for (let index = 0; index < this.buffers.length; index += 1) {
            for (let component = 0; component < 4; component += 1) {
              paintedSum += this.buffers[index]![pixelIndex + component]! / 255;
            }
          }
          value = Math.round(Math.max(0, 1 - paintedSum) * 255);
        } else {
          const storageIndex = channelIndex - 1;
          const textureIndex = Math.floor(storageIndex / 4);
          const componentIndex = storageIndex % 4;
          const buffer = this.buffers[textureIndex];
          value = buffer ? buffer[pixelIndex + componentIndex]! : 0;
        }

        const outputIndex = (ty * thumbSize + tx) * 4;
        data[outputIndex] = value;
        data[outputIndex + 1] = value;
        data[outputIndex + 2] = value;
        data[outputIndex + 3] = 255;
      }
    }

    context.putImageData(output, 0, 0);
  }

  dispose(): void {
    this.buffers = [];
  }

  private ensureTextureCount(count: number): void {
    while (this.buffers.length < count) {
      this.buffers.push(new Uint8Array(this.resolution * this.resolution * 4));
    }
  }
}
