/**
 * Live-scene GPU perf probe -- "option B" (Perf tasks #337 / #339+).
 *
 * Attaches over CDP to a Chrome you launched yourself with the debug
 * port, finds the running preview window, and measures the REAL scene
 * (scatter / ensure-loop machinery) -- the load the synthetic harness
 * can't reproduce. Read-only: injects a rAF fps sampler and scrapes the
 * debug HUD text; changes nothing in the app.
 *
 * SETUP (does NOT touch your normal Chrome — a SEPARATE instance with its
 * own profile dir honors the debug port + runs alongside it):
 *   1. Launch it (debug port + vsync unlocked for unquantized frame time):
 *        open -na "Google Chrome" --args \
 *          --remote-debugging-port=9222 \
 *          --user-data-dir="$HOME/.sugarmagic-perf-chrome" \
 *          --disable-gpu-vsync --disable-frame-rate-limit
 *      (same profile dir each run -> sign in once, ever.)
 *   2. In that window: open the Studio, load your project, start the
 *      preview, get into the scene. Open the debug HUD (Renderer tab)
 *      for draw/tri readouts.
 *
 * Then:  node driver/measure-live.mjs [--seconds=6] [--port=9222]
 */

import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port ?? 9222);
const SECONDS = Number(args.seconds ?? 6);
const MATCH = args.match ?? "preview.html";

const log = (...m) => console.log("[perf]", ...m);

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  } catch {
    throw new Error(
      `Could not attach to Chrome on :${PORT}. Launch a separate debuggable\n` +
        `instance (leaves your normal Chrome untouched):\n` +
        `  open -na "Google Chrome" --args --remote-debugging-port=${PORT} ` +
        `--user-data-dir="$HOME/.sugarmagic-perf-chrome" ` +
        `--disable-gpu-vsync --disable-frame-rate-limit`
    );
  }

  const pages = browser.contexts().flatMap((c) => c.pages());
  log(`attached. ${pages.length} page(s):`);
  for (const p of pages) log(`  - ${p.url()}`);

  const preview =
    pages.find((p) => p.url().includes(MATCH)) ??
    pages.find((p) => p.url().includes("preview")) ??
    null;
  if (!preview) {
    throw new Error(
      `No preview page (url containing "${MATCH}"). Is the preview window open + in the scene?`
    );
  }
  log(`measuring: ${preview.url()}`);

  const gpu = await preview.evaluate(async () => {
    if (!navigator.gpu) return { hasGPU: false };
    const a = await navigator.gpu.requestAdapter().catch(() => null);
    return { hasGPU: true, adapter: !!a, fallback: a?.isFallbackAdapter ?? null };
  });
  log("webgpu:", JSON.stringify(gpu));

  // Inject a rAF sampler onto the preview's own render loop -> real
  // frame period. Read-only.
  const result = await preview.evaluate(async (seconds) => {
    const deltas = [];
    let last = performance.now();
    const end = last + seconds * 1000;
    await new Promise((resolve) => {
      function tick() {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    const sorted = deltas.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? median;
    // Best-effort scrape of the debug HUD text (Draws / Triangles / etc.).
    const hudText = (document.body.innerText || "")
      .split("\n")
      .filter((l) => /draw|triangle|geometr|textur|fps|ms/i.test(l))
      .slice(0, 12)
      .join(" | ");
    return {
      frames: deltas.length,
      medianFrameMs: Number(median.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      fps: Number((1000 / median).toFixed(1)),
      hud: hudText
    };
  }, SECONDS);

  log("=".repeat(60));
  log(`frames sampled : ${result.frames} over ${SECONDS}s`);
  log(`median frame   : ${result.medianFrameMs} ms  (${result.fps} fps)`);
  log(`p95 frame      : ${result.p95FrameMs} ms`);
  if (result.hud) log(`HUD            : ${result.hud}`);
  log("=".repeat(60));
  if (result.medianFrameMs > 16 && result.medianFrameMs % 16.6 < 2) {
    log(
      "note: frame time looks vsync-quantized -- relaunch Chrome with " +
        "--disable-gpu-vsync --disable-frame-rate-limit for unquantized numbers."
    );
  }

  // connectOverCDP: detach without closing YOUR browser.
  await browser.close();
}

main().catch((err) => {
  console.error("[perf] FAILED:", err.message);
  process.exit(1);
});
