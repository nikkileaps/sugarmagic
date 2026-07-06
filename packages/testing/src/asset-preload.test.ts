/**
 * Plan 060 §060.1 — boot asset preload phase. The host fetches
 * every assetSources URL into the HTTP cache before world
 * assembly; these tests pin the preloader's contract: full
 * coverage, per-asset failure tolerance (never rejects), URL
 * dedup, progress reporting, and timeout abandonment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preloadAssetSources } from "@sugarmagic/target-web";

function okResponse(): Response {
  return new Response(new ArrayBuffer(8), { status: 200 });
}

describe("preloadAssetSources (Plan 060)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches every unique URL and reports progress to completion", async () => {
    const fetched: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return okResponse();
    }) as typeof fetch;

    const progress: Array<{ loaded: number; total: number }> = [];
    await preloadAssetSources(
      {
        "assets/audio/theme.mp3": "/assets/audio/theme.mp3",
        "assets/models/testy.glb": "/assets/models/testy.glb",
        // Duplicate URL under a second path — fetched once.
        "assets/audio/theme-alias.mp3": "/assets/audio/theme.mp3"
      },
      { onProgress: (update) => progress.push({ ...update }) }
    );

    expect(fetched.sort()).toEqual([
      "/assets/audio/theme.mp3",
      "/assets/models/testy.glb"
    ]);
    expect(progress[0]).toEqual({ loaded: 0, total: 2 });
    expect(progress[progress.length - 1]).toEqual({ loaded: 2, total: 2 });
  });

  it("continues past failed and non-ok fetches without rejecting", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("missing")) return new Response(null, { status: 404 });
      if (url.includes("broken")) throw new Error("network down");
      return okResponse();
    }) as typeof fetch;

    let final = { loaded: 0, total: 0 };
    await expect(
      preloadAssetSources(
        {
          a: "/assets/ok.bin",
          b: "/assets/missing.bin",
          c: "/assets/broken.bin"
        },
        { onProgress: (update) => (final = { ...update }) }
      )
    ).resolves.toBeUndefined();
    // Every asset counts as settled — failures degrade, never hang.
    expect(final).toEqual({ loaded: 3, total: 3 });
  });

  it("abandons an asset that exceeds the timeout and proceeds", async () => {
    globalThis.fetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("slow")) {
          // Hang until aborted.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          });
        }
        return Promise.resolve(okResponse());
      }
    ) as typeof fetch;

    let final = { loaded: 0, total: 0 };
    await preloadAssetSources(
      { a: "/assets/slow.bin", b: "/assets/fast.bin" },
      {
        timeoutMs: 30,
        onProgress: (update) => (final = { ...update })
      }
    );
    expect(final).toEqual({ loaded: 2, total: 2 });
  });

  it("no-ops on an empty source map", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const progress: unknown[] = [];
    await preloadAssetSources({}, { onProgress: (u) => progress.push(u) });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(progress).toEqual([]);
  });
});
