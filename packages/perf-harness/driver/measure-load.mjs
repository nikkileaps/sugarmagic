/**
 * Synthetic load sweep (Perf task #337).
 *
 * Spawns the harness vite server, launches your INSTALLED Google Chrome
 * (channel:'chrome' -> real GPU + WebGPU; the bundled Chromium ships
 * none), vsync unlocked, and reports median frame time at each mesh
 * count. Sanity-checks the driving infra and lets you A/B isolated
 * engine changes against a synthetic plain-three load. The real scene
 * (scatter / ensure-loop machinery) is measured by measure-live.mjs.
 *
 * Usage:  node driver/measure-load.mjs [--detail=32] [--sweep=300,1500,4000,8000]
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const DETAIL = args.detail ?? "48";
const SWEEP = (args.sweep ?? "600").split(",");
const PORT = 5199;
const SAMPLE_MS = Number(args.sampleMs ?? 2500);

const log = (...m) => console.log("[perf]", ...m);

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite dev server never came up at ${url}`);
}

async function main() {
  log(`spawning vite dev server on :${PORT} ...`);
  const vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT)], {
    cwd: packageDir,
    stdio: "ignore"
  });
  let browser;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    log("dev server up. launching your installed Google Chrome (real GPU) ...");
    browser = await chromium.launch({
      channel: "chrome",
      headless: false,
      args: [
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        "--enable-unsafe-webgpu",
        // Unlock the 60Hz vsync ceiling so frame time reflects real work.
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit"
      ]
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    for (const meshes of SWEEP) {
      await page.goto(`http://localhost:${PORT}/?meshes=${meshes}&detail=${DETAIL}`, {
        waitUntil: "load"
      });
      await page.waitForFunction(() => globalThis.__perfHarness?.ready === true, {
        timeout: 30000
      });
      await page.evaluate((ms) => globalThis.__perfHarness.sample(ms), 1200);
      const r = await page.evaluate((ms) => globalThis.__perfHarness.sample(ms), SAMPLE_MS);
      log(
        `meshes=${String(meshes).padStart(5)}  ` +
          `${r.medianFrameMs.toFixed(2)} ms/frame  ${r.fps.toFixed(0)} fps  (frames=${r.frames})`
      );
    }
  } finally {
    if (browser) await browser.close();
    vite.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("[perf] FAILED:", err.message);
  process.exit(1);
});
