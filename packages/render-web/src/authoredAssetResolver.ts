/**
 * AuthoredAssetResolver
 *
 * Single, shared boundary between "authored asset identity" (a
 * TextureDefinition or a relative-asset-path) and "GPU-ready artifact"
 * (a three.Texture) / "fetchable URL" (a blob URL or null on miss).
 *
 * Replaces the previous ad-hoc pattern where every render-web call site
 * did `fileSources[path] ?? path` to resolve URLs and kept its own
 * Map<string, Three.Texture> cache. That split produced:
 *
 *   - Silent URL fallback to the raw relative path on map miss — which
 *     404s differently in Studio vs. Preview vs. published, surfacing as
 *     "looks different in Preview vs editor viewport" with no logged
 *     root cause.
 *   - Parallel caches (ShaderRuntime.textureCache vs. the landscape
 *     mesh's externalTextureCache) so the same TextureDefinition could
 *     produce two three.Texture instances configured differently
 *     (colorspace, repeat, wrap).
 *   - Cache keys including the resolved URL so blob-URL churn missed the
 *     cache even though the logical texture was unchanged.
 *
 * Contract:
 *
 *   - Constructed once per WebRenderHost.
 *   - resolveAssetUrl(path) returns the blob URL or null — never the
 *     raw path. Callers surface explicit errors on null.
 *   - resolveTextureDefinition(def, options) returns a three.Texture
 *     cached by (definitionId + repeat). Blob URL changes for the same
 *     definitionId do NOT cause cache misses; they trigger an in-place
 *     reload of the existing Texture object (keeps GPU bindings stable
 *     even when Studio re-mints blob URLs).
 *   - sync(contentLibrary, assetSources) is how upstream (WebRenderHost)
 *     pushes fresh state. Idempotent and cheap to call on every frame
 *     budget; usually called on every applyEnvironment.
 *   - Debug logging (console.debug / console.warn) fires on cache
 *     state changes so Preview-vs-editor divergence can be diagnosed
 *     by scrolling the console instead of by guessing.
 */

import * as THREE from "three";
import type {
  ContentLibrarySnapshot,
  TextureDefinition
} from "@sugarmagic/domain";

const LOG_PREFIX = "[authored-asset-resolver]";

export interface AuthoredAssetResolverLogger {
  warn: (message: string, payload?: Record<string, unknown>) => void;
  debug?: (message: string, payload?: Record<string, unknown>) => void;
}

export interface TextureResolveOptions {
  repeatX?: number;
  repeatY?: number;
}

export interface AuthoredAssetResolver {
  /**
   * Blob URL for a relative asset path, or null if no source is known.
   * Never falls back to the raw path string — callers that need a URL
   * must surface an explicit error / fallback on null.
   */
  resolveAssetUrl(relativeAssetPath: string): string | null;

  /**
   * Three.Texture for the given TextureDefinition. Cached by
   * (definitionId + repeat). Safe to call every frame; identical
   * parameters return the same Texture object.
   */
  resolveTextureDefinition(
    definition: TextureDefinition,
    options?: TextureResolveOptions
  ): THREE.Texture;

  /** Pushes the latest content library and asset-source map. Idempotent. */
  sync(
    contentLibrary: ContentLibrarySnapshot | null,
    assetSources: Record<string, string>
  ): void;

  /** Current content library snapshot. */
  getContentLibrary(): ContentLibrarySnapshot | null;

  /** Dispose every cached texture and drop state. */
  dispose(): void;
}

interface CachedTextureEntry {
  definitionId: string;
  cacheKey: string;
  colorSpace: THREE.ColorSpace;
  relativeAssetPath: string;
  /** The blob URL we last loaded from. Reload triggers when this changes. */
  loadedFromUrl: string | null;
  /** Whether a load has kicked off (used to suppress double-logging). */
  loadInFlight: boolean;
  texture: THREE.Texture;
}

interface ResolverOptions {
  logger?: AuthoredAssetResolverLogger;
  /**
   * Fires after a cached texture's backing image finishes loading (or
   * reloads because the blob URL changed). The resolver sets
   * `texture.needsUpdate = true` before invoking this — which is enough
   * for Three to re-upload pixels — but it is NOT enough for the
   * consuming material's bind group to refresh in Three's WebGPU node
   * material path. The host wires this callback to mark scene
   * materials dirty so bind groups get recreated on the next render.
   *
   * Without this invalidation, Preview (which applies environment only
   * once at boot) ends up with materials whose compiled shaders keep
   * sampling the original placeholder texture resource even after the
   * real image is uploaded. The Editor accidentally worked because
   * Studio pushes state many times, each of which marks every
   * material dirty inside runPendingEnvironment.
   */
  onTextureUpdated?: (texture: THREE.Texture) => void;
}

function placeholderPixelForPacking(
  packing: TextureDefinition["packing"]
): [number, number, number, number] {
  switch (packing) {
    case "normal":
      return [128, 128, 255, 255];
    case "orm":
      return [255, 255, 0, 255];
    case "roughness":
      return [255, 255, 255, 255];
    case "metallic":
      return [0, 0, 0, 255];
    case "ao":
      return [255, 255, 255, 255];
    case "height":
      return [0, 0, 0, 255];
    case "rgba":
    default:
      return [255, 255, 255, 255];
  }
}

function colorSpaceForDefinition(
  definition: TextureDefinition
): THREE.ColorSpace {
  return definition.colorSpace === "srgb"
    ? THREE.SRGBColorSpace
    : THREE.LinearSRGBColorSpace;
}

function createPlaceholderTexture(
  definition: TextureDefinition
): THREE.Texture {
  const pixel = placeholderPixelForPacking(definition.packing);
  const colorSpace = colorSpaceForDefinition(definition);

  if (typeof document === "undefined") {
    const data = new THREE.DataTexture(
      new Uint8Array(pixel),
      1,
      1,
      THREE.RGBAFormat
    );
    data.needsUpdate = true;
    data.colorSpace = colorSpace;
    return data;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;
    context.fillRect(0, 0, 1, 1);
  }
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = colorSpace;
  return texture;
}

function cacheKeyFor(
  definitionId: string,
  options: TextureResolveOptions | undefined
): string {
  const repeatX = options?.repeatX ?? 1;
  const repeatY = options?.repeatY ?? 1;
  return `${definitionId}:${repeatX}:${repeatY}`;
}

function debugLog(
  logger: AuthoredAssetResolverLogger,
  message: string,
  payload?: Record<string, unknown>
): void {
  if (logger.debug) {
    logger.debug(`${LOG_PREFIX} ${message}`, payload);
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(`${LOG_PREFIX} ${message}`, payload ?? {});
}

function warnLog(
  logger: AuthoredAssetResolverLogger,
  message: string,
  payload?: Record<string, unknown>
): void {
  logger.warn(`${LOG_PREFIX} ${message}`, payload);
}

export function createAuthoredAssetResolver(
  options: ResolverOptions = {}
): AuthoredAssetResolver {
  const logger: AuthoredAssetResolverLogger = options.logger ?? {
    warn(message, payload) {
      // eslint-disable-next-line no-console
      console.warn(message, payload ?? {});
    }
  };
  const onTextureUpdated = options.onTextureUpdated;

  let contentLibrary: ContentLibrarySnapshot | null = null;
  let assetSources: Record<string, string> = {};
  const cache = new Map<string, CachedTextureEntry>();
  let syncCount = 0;

  function loadTextureBytes(
    entry: CachedTextureEntry,
    resolvedUrl: string
  ): void {
    if (typeof document === "undefined") {
      // SSR / test env — keep the placeholder data texture; nothing to
      // load from a URL since we have no DOM ImageLoader.
      return;
    }

    entry.loadInFlight = true;
    debugLog(logger, "texture load started", {
      definitionId: entry.definitionId,
      cacheKey: entry.cacheKey,
      url: resolvedUrl
    });

    // Re-fetch the URL's bytes and mint a blob URL in THIS window's
    // context before handing it to the ImageLoader. This matters in
    // the Preview window: Studio creates blob URLs in its own window's
    // blob store and passes them through postMessage. Chrome allows
    // cross-window ImageLoader reads of these URLs (decode succeeds),
    // but the resulting HTMLImageElement is flagged as cross-window
    // for `copyExternalImageToTexture` purposes — the GPU upload
    // silently does nothing, and the compiled shader keeps sampling
    // the 1x1 placeholder. Fetching + re-creating the URL in the
    // current window produces a locally-sourced image that Chrome
    // treats as same-window for GPU upload.
    //
    // In Studio this is a no-op hop (fetch the same-window URL, mint
    // a new same-window URL); harmless.
    void (async () => {
      let localUrl: string | null = null;
      try {
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`fetch ${resolvedUrl} → ${response.status}`);
        }
        const blob = await response.blob();
        localUrl = URL.createObjectURL(blob);
      } catch (fetchError) {
        entry.loadInFlight = false;
        warnLog(logger, "texture refetch failed", {
          definitionId: entry.definitionId,
          relativeAssetPath: entry.relativeAssetPath,
          url: resolvedUrl,
          error:
            fetchError instanceof Error
              ? { name: fetchError.name, message: fetchError.message }
              : { value: String(fetchError) }
        });
        return;
      }

      const imageLoader = new THREE.ImageLoader();
      imageLoader.load(
        localUrl,
        (image) => {
        entry.loadInFlight = false;
        // The entry might have been disposed while we were loading.
        if (!cache.has(entry.cacheKey)) {
          return;
        }
          // Dispose the texture BEFORE swapping the image. This fires
          // Three's internal dispose event which tells the WebGPU
          // backend to release the 1x1 GPU resource it allocated for
          // the canvas placeholder. Without this, Three keeps the
          // GPU texture sized to the placeholder; setting `image` and
          // `needsUpdate` uploads new pixel data but the destination
          // GPU texture stays 1x1, so the bind group samples a single
          // placeholder pixel forever. `dispose()` only releases GPU
          // state — the Three.Texture JS object and its identity
          // (uuid, source uuid) are preserved, so downstream material
          // bind groups still reference the same Three.Texture. On
          // next render, `needsUpdate: true` causes Three to allocate
          // a fresh GPU texture sized to the real image.
          entry.texture.dispose();
          entry.texture.image = image;
          entry.texture.colorSpace = entry.colorSpace;
          entry.texture.needsUpdate = true;
          debugLog(logger, "texture load completed", {
            definitionId: entry.definitionId,
            cacheKey: entry.cacheKey,
            url: resolvedUrl,
            imageWidth: (image as { width?: number }).width ?? null,
            imageHeight: (image as { height?: number }).height ?? null,
            textureUuid: entry.texture.uuid
          });
          onTextureUpdated?.(entry.texture);
          if (localUrl) {
            URL.revokeObjectURL(localUrl);
          }
        },
        undefined,
        (error) => {
          entry.loadInFlight = false;
          warnLog(logger, "texture load failed", {
            definitionId: entry.definitionId,
            relativeAssetPath: entry.relativeAssetPath,
            url: resolvedUrl,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { value: String(error) }
          });
          if (localUrl) {
            URL.revokeObjectURL(localUrl);
          }
        }
      );
    })();
  }

  function maybeReloadForUrlChange(
    entry: CachedTextureEntry,
    resolvedUrl: string | null
  ): void {
    if (entry.loadedFromUrl === resolvedUrl) {
      return;
    }
    if (!resolvedUrl) {
      // Previously had a URL, now do not — keep the placeholder / last
      // loaded bytes visible and warn; the caller's sync pushed an
      // assetSources map without this path in it.
      warnLog(logger, "texture source url dropped after load", {
        definitionId: entry.definitionId,
        relativeAssetPath: entry.relativeAssetPath,
        previousUrl: entry.loadedFromUrl
      });
      entry.loadedFromUrl = null;
      return;
    }
    debugLog(logger, "texture url changed, reloading", {
      definitionId: entry.definitionId,
      cacheKey: entry.cacheKey,
      previousUrl: entry.loadedFromUrl,
      nextUrl: resolvedUrl
    });
    entry.loadedFromUrl = resolvedUrl;
    loadTextureBytes(entry, resolvedUrl);
  }

  return {
    resolveAssetUrl(relativeAssetPath) {
      const url = assetSources[relativeAssetPath];
      if (!url) {
        warnLog(logger, "asset url miss", {
          relativeAssetPath,
          knownPathCount: Object.keys(assetSources).length,
          syncCount
        });
        return null;
      }
      return url;
    },

    resolveTextureDefinition(definition, textureOptions) {
      const cacheKey = cacheKeyFor(definition.definitionId, textureOptions);
      const existing = cache.get(cacheKey);
      const relativeAssetPath = definition.source.relativeAssetPath;
      const resolvedUrl = assetSources[relativeAssetPath] ?? null;

      if (existing) {
        // Definition bytes changed (or blob URL re-minted). Trigger
        // in-place reload — keep the GPU binding stable so consumers
        // don't need to rewire materials.
        maybeReloadForUrlChange(existing, resolvedUrl);
        return existing.texture;
      }

      const texture = createPlaceholderTexture(definition);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(
        textureOptions?.repeatX ?? 1,
        textureOptions?.repeatY ?? 1
      );
      texture.needsUpdate = true;

      const entry: CachedTextureEntry = {
        definitionId: definition.definitionId,
        cacheKey,
        colorSpace: colorSpaceForDefinition(definition),
        relativeAssetPath,
        loadedFromUrl: resolvedUrl,
        loadInFlight: false,
        texture
      };
      cache.set(cacheKey, entry);

      debugLog(logger, "texture cache miss, created entry", {
        definitionId: definition.definitionId,
        cacheKey,
        relativeAssetPath,
        resolvedUrl,
        repeatX: textureOptions?.repeatX ?? 1,
        repeatY: textureOptions?.repeatY ?? 1,
        totalCacheSize: cache.size
      });

      if (!resolvedUrl) {
        warnLog(logger, "texture created without source url", {
          definitionId: definition.definitionId,
          relativeAssetPath,
          cacheKey,
          syncCount,
          knownPathCount: Object.keys(assetSources).length
        });
        return texture;
      }

      loadTextureBytes(entry, resolvedUrl);
      return texture;
    },

    sync(nextContentLibrary, nextAssetSources) {
      syncCount += 1;
      const previousPathCount = Object.keys(assetSources).length;
      assetSources = nextAssetSources;

      const previousLibraryId = contentLibrary?.identity.id ?? null;
      const nextLibraryId = nextContentLibrary?.identity.id ?? null;
      contentLibrary = nextContentLibrary;

      debugLog(logger, "sync", {
        syncCount,
        previousPathCount,
        nextPathCount: Object.keys(nextAssetSources).length,
        previousLibraryId,
        nextLibraryId,
        cacheSize: cache.size
      });

      // Evict cache entries for definitions that no longer exist in the
      // content library; otherwise their textures leak until dispose.
      if (nextContentLibrary) {
        const livingIds = new Set(
          nextContentLibrary.textureDefinitions.map(
            (definition) => definition.definitionId
          )
        );
        for (const [cacheKey, entry] of cache) {
          if (!livingIds.has(entry.definitionId)) {
            debugLog(logger, "evicting texture for removed definition", {
              definitionId: entry.definitionId,
              cacheKey
            });
            entry.texture.dispose();
            cache.delete(cacheKey);
          }
        }
      }

      // Propagate URL changes to already-cached textures.
      for (const entry of cache.values()) {
        const nextUrl = assetSources[entry.relativeAssetPath] ?? null;
        maybeReloadForUrlChange(entry, nextUrl);
      }
    },

    getContentLibrary() {
      return contentLibrary;
    },

    dispose() {
      debugLog(logger, "dispose", { cacheSize: cache.size, syncCount });
      for (const entry of cache.values()) {
        entry.texture.dispose();
      }
      cache.clear();
      contentLibrary = null;
      assetSources = {};
    }
  };
}
