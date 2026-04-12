/**
 * targets/web/src/billboard/BillboardAssetRegistry.ts
 *
 * Purpose: Owns billboard asset resolution from descriptor IDs to web GPU-ready textures.
 *
 * Exports:
 *   - BillboardAssetRegistry
 *   - UVRect
 *   - ResolvedBillboardAsset
 *
 * Relationships:
 *   - Depends on billboard descriptors from runtime-core.
 *   - Is consumed only by the web billboard renderers.
 *
 * Status: active
 */

import * as THREE from "three";
import type { BillboardDescriptor } from "@sugarmagic/runtime-core";

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ResolvedBillboardAsset {
  assetKey: string;
  texture: THREE.Texture;
  uv: UVRect;
  tintColor?: string;
  windSwayAmplitude?: number;
}

export interface BillboardAssetRegistryOptions {
  previewSpriteBasePath?: string;
  disposalGraceMs?: number;
  logger?: {
    warn: (message: string, payload?: Record<string, unknown>) => void;
  };
  ownerWindow?: Window;
}

export interface AtlasPageRegistration {
  texture: THREE.Texture;
  frames: UVRect[];
  tintColor?: string;
  windSwayAmplitude?: number;
}

interface ManagedAssetEntry {
  texture: THREE.Texture;
  uv: UVRect;
  refs: number;
  disposalTimer: number | null;
  tintColor?: string;
  windSwayAmplitude?: number;
}

const FULL_UV: UVRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

export class BillboardAssetRegistry {
  private readonly previewSpriteBasePath: string;
  private readonly disposalGraceMs: number;
  private readonly logger;
  private readonly ownerWindow: Window | null;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly atlasPages = new Map<string, AtlasPageRegistration>();
  private readonly impostorCaptures = new Map<string, ManagedAssetEntry>();
  private readonly fallbackSprites = new Map<string, ManagedAssetEntry>();
  private readonly pendingFallbackLoads = new Map<string, Promise<void>>();

  constructor(options: BillboardAssetRegistryOptions = {}) {
    this.previewSpriteBasePath = options.previewSpriteBasePath ?? "/assets/sprites";
    this.disposalGraceMs = options.disposalGraceMs ?? 2000;
    this.logger = options.logger ?? { warn() {} };
    this.ownerWindow = options.ownerWindow ?? (typeof window !== "undefined" ? window : null);
  }

  registerAtlasPage(atlasId: string, page: AtlasPageRegistration): void {
    this.cancelManagedDisposal(this.fallbackSprites.get(atlasId) ?? null);
    page.texture.colorSpace = THREE.SRGBColorSpace;
    this.atlasPages.set(atlasId, page);
  }

  registerImpostorCapture(
    captureId: string,
    texture: THREE.Texture,
    options: { tintColor?: string; windSwayAmplitude?: number } = {}
  ): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    this.impostorCaptures.set(captureId, {
      texture,
      uv: FULL_UV,
      refs: 0,
      disposalTimer: null,
      tintColor: options.tintColor,
      windSwayAmplitude: options.windSwayAmplitude
    });
  }

  acquire(assetKey: string): void {
    const asset = this.getManagedAsset(assetKey);
    if (!asset) {
      return;
    }
    asset.refs += 1;
    this.cancelManagedDisposal(asset);
  }

  release(assetKey: string): void {
    const asset = this.getManagedAsset(assetKey);
    if (!asset) {
      return;
    }
    asset.refs = Math.max(0, asset.refs - 1);
    if (asset.refs === 0) {
      this.scheduleManagedDisposal(assetKey, asset);
    }
  }

  resolve(descriptor: BillboardDescriptor): ResolvedBillboardAsset | null {
    if (descriptor.kind === "text") {
      return null;
    }

    if (descriptor.kind === "impostor") {
      const capture = this.impostorCaptures.get(descriptor.captureId) ?? null;
      if (!capture) {
        return null;
      }
      return {
        assetKey: `impostor:${descriptor.captureId}`,
        texture: capture.texture,
        uv: capture.uv,
        tintColor: capture.tintColor,
        windSwayAmplitude: capture.windSwayAmplitude
      };
    }

    const atlasPage = this.atlasPages.get(descriptor.atlasId) ?? null;
    if (atlasPage) {
      const uv = atlasPage.frames[descriptor.frameIndex] ?? null;
      if (!uv) {
        this.logger.warn("Billboard atlas frame index was out of range.", {
          atlasId: descriptor.atlasId,
          frameIndex: descriptor.frameIndex
        });
        return null;
      }

      return {
        assetKey: `atlas:${descriptor.atlasId}:${descriptor.frameIndex}`,
        texture: atlasPage.texture,
        uv,
        tintColor: atlasPage.tintColor,
        windSwayAmplitude: atlasPage.windSwayAmplitude
      };
    }

    const fallbackKey = `sprite:${descriptor.atlasId}:${descriptor.frameIndex}`;
    const existing = this.fallbackSprites.get(fallbackKey) ?? null;
    if (existing) {
      return {
        assetKey: fallbackKey,
        texture: existing.texture,
        uv: existing.uv
      };
    }

    void this.ensureFallbackSpriteLoaded(descriptor.atlasId, descriptor.frameIndex);
    return null;
  }

  dispose(): void {
    for (const [, page] of this.atlasPages) {
      page.texture.dispose();
    }
    this.atlasPages.clear();

    for (const [, asset] of this.impostorCaptures) {
      this.cancelManagedDisposal(asset);
      asset.texture.dispose();
    }
    this.impostorCaptures.clear();

    for (const [, asset] of this.fallbackSprites) {
      this.cancelManagedDisposal(asset);
      asset.texture.dispose();
    }
    this.fallbackSprites.clear();
    this.pendingFallbackLoads.clear();
  }

  private getManagedAsset(assetKey: string): ManagedAssetEntry | null {
    if (assetKey.startsWith("impostor:")) {
      return this.impostorCaptures.get(assetKey.slice("impostor:".length)) ?? null;
    }
    if (assetKey.startsWith("sprite:")) {
      return this.fallbackSprites.get(assetKey) ?? null;
    }
    return null;
  }

  private cancelManagedDisposal(asset: ManagedAssetEntry | null): void {
    if (!asset || asset.disposalTimer === null || !this.ownerWindow) {
      return;
    }
    this.ownerWindow.clearTimeout(asset.disposalTimer);
    asset.disposalTimer = null;
  }

  private scheduleManagedDisposal(assetKey: string, asset: ManagedAssetEntry): void {
    if (!this.ownerWindow) {
      asset.texture.dispose();
      if (assetKey.startsWith("sprite:")) {
        this.fallbackSprites.delete(assetKey);
      }
      return;
    }

    this.cancelManagedDisposal(asset);
    asset.disposalTimer = this.ownerWindow.setTimeout(() => {
      if (asset.refs > 0) {
        asset.disposalTimer = null;
        return;
      }
      asset.texture.dispose();
      asset.disposalTimer = null;
      if (assetKey.startsWith("sprite:")) {
        this.fallbackSprites.delete(assetKey);
      }
    }, this.disposalGraceMs);
  }

  private async ensureFallbackSpriteLoaded(
    atlasId: string,
    frameIndex: number
  ): Promise<void> {
    const assetKey = `sprite:${atlasId}:${frameIndex}`;
    if (this.fallbackSprites.has(assetKey)) {
      return;
    }
    if (this.pendingFallbackLoads.has(assetKey)) {
      return this.pendingFallbackLoads.get(assetKey)!;
    }

    const promise = this.textureLoader
      .loadAsync(`${this.previewSpriteBasePath}/${atlasId}/${frameIndex}.png`)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.fallbackSprites.set(assetKey, {
          texture,
          uv: FULL_UV,
          refs: 0,
          disposalTimer: null
        });
        this.logger.warn("Billboard atlas page was missing; loaded preview fallback sprite.", {
          atlasId,
          frameIndex,
          fallbackPath: `${this.previewSpriteBasePath}/${atlasId}/${frameIndex}.png`
        });
      })
      .catch(() => {
        this.logger.warn("Billboard sprite fallback failed to load.", {
          atlasId,
          frameIndex,
          fallbackPath: `${this.previewSpriteBasePath}/${atlasId}/${frameIndex}.png`
        });
      })
      .finally(() => {
        this.pendingFallbackLoads.delete(assetKey);
      });

    this.pendingFallbackLoads.set(assetKey, promise);
    await promise;
  }
}
