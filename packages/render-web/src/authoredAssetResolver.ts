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
   * sampling an empty/stale GPU texture resource even after the real
   * image is uploaded. The Editor accidentally worked because Studio
   * pushes state many times, each of which marks every material dirty
   * inside runPendingEnvironment.
   */
  onTextureUpdated?: (texture: THREE.Texture) => void;
}

function colorSpaceForDefinition(
  definition: TextureDefinition
): THREE.ColorSpace {
  return definition.colorSpace === "srgb"
    ? THREE.SRGBColorSpace
    : THREE.LinearSRGBColorSpace;
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
      // SSR / test env — no DOM ImageLoader; rendering never happens,
      // so the texture sitting without an image is harmless.
      return;
    }

    entry.loadInFlight = true;
    debugLog(logger, "texture load started", {
      definitionId: entry.definitionId,
      cacheKey: entry.cacheKey,
      url: resolvedUrl
    });

    const imageLoader = new THREE.ImageLoader();
    imageLoader.load(
      resolvedUrl,
      (image) => {
        entry.loadInFlight = false;
        // The entry might have been disposed while we were loading.
        if (!cache.has(entry.cacheKey)) {
          return;
        }
        // Dispose the texture before swapping its image. This tells
        // Three's WebGPU backend to release any GPU resource already
        // allocated for this texture (which, if the backend
        // auto-allocated a fallback at material-compile time, would
        // be locked at a default size). After `needsUpdate = true`
        // on the next render, Three allocates a fresh GPU texture
        // sized to the real image. `dispose()` only touches GPU
        // state — the Three.Texture JS object and its identity
        // (uuid, source uuid) are preserved, so downstream material
        // bind groups still reference the same Three.Texture.
        entry.texture.dispose();
        entry.texture.image = image;
        entry.texture.colorSpace = entry.colorSpace;
        entry.texture.needsUpdate = true;
        debugLog(logger, "texture load completed", {
          definitionId: entry.definitionId,
          cacheKey: entry.cacheKey,
          url: resolvedUrl
        });
        onTextureUpdated?.(entry.texture);
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
      }
    );
  }

  function maybeReloadForUrlChange(
    entry: CachedTextureEntry,
    resolvedUrl: string | null
  ): void {
    if (entry.loadedFromUrl === resolvedUrl) {
      return;
    }
    if (!resolvedUrl) {
      // Previously had a URL, now do not — keep the last loaded bytes
      // visible and warn; the caller's sync pushed an assetSources
      // map without this path in it.
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

      // Create a bare Three.Texture with no image yet. The material
      // graph compiles against this identity; the image arrives later
      // via loadTextureBytes. We intentionally do NOT pre-populate a
      // small placeholder image: a 1x1 canvas/data source locks the
      // GPU texture to 1x1 in Three's WebGPU backend, and a later
      // image swap won't resize it. Starting empty + disposing on
      // swap gives Three a clean slate to size the GPU resource
      // against the real image.
      const texture = new THREE.Texture();
      texture.colorSpace = colorSpaceForDefinition(definition);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(
        textureOptions?.repeatX ?? 1,
        textureOptions?.repeatY ?? 1
      );

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
