/**
 * targets/web/src/assetPreload.ts
 *
 * Purpose: Plan 060 §060.1 — the boot asset preload phase. The
 * host fetches every file-backed asset URL in `assetSources`
 * BEFORE world assembly, so the loading screen means "the game
 * is ready" rather than "the code is ready" — no music starting
 * seconds late, no meshes popping in after gameplay begins.
 *
 * `fetch()` into the HTTP cache is the whole mechanism: the
 * render/audio loaders re-request the same URLs afterwards and
 * hit cache. No in-memory handoff, no loader rewiring.
 *
 * Failure posture: a missing/broken asset warns and continues
 * (matching the adapters' existing missing-source tolerance) and
 * a per-asset timeout keeps a dead CDN from bricking the boot.
 * The input is deliberately just "a map of paths to URLs" —
 * scene-scoped or prioritized preloading later means passing a
 * filtered map, nothing here changes.
 *
 * Status: active
 */

export interface AssetPreloadProgress {
  loaded: number;
  total: number;
}

export interface PreloadAssetSourcesOptions {
  onProgress?: (progress: AssetPreloadProgress) => void;
  /** Per-asset ceiling; a slow asset is abandoned (warn) so boot
   *  proceeds. Default 20s. */
  timeoutMs?: number;
  /** Parallel fetch lanes. Default 6 — browsers cap per-origin
   *  connections around there anyway. */
  concurrency?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONCURRENCY = 6;

async function fetchOne(url: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.warn("[asset-preload] fetch not ok; continuing", {
        url,
        status: response.status
      });
      return;
    }
    // Drain the body so the bytes actually land in the HTTP
    // cache — an unread response may be discarded on some
    // browsers when the connection is reused.
    await response.arrayBuffer();
  } catch (error) {
    console.warn("[asset-preload] fetch failed; continuing", {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch every URL in `assetSources`, `concurrency` at a time,
 * reporting progress after each settles. Never rejects — per-
 * asset failures degrade to warnings so the boot always proceeds.
 */
export async function preloadAssetSources(
  assetSources: Record<string, string>,
  options: PreloadAssetSourcesOptions = {}
): Promise<void> {
  const urls = [...new Set(Object.values(assetSources))];
  const total = urls.length;
  if (total === 0) return;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  let loaded = 0;
  let nextIndex = 0;
  options.onProgress?.({ loaded, total });

  async function lane(): Promise<void> {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex];
      nextIndex += 1;
      if (url === undefined) break;
      await fetchOne(url, timeoutMs);
      loaded += 1;
      options.onProgress?.({ loaded, total });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => lane())
  );
}
