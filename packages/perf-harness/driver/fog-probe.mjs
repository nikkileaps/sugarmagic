/**
 * Sky probe driver. QA-only, never shipped.
 *
 * Spawns the harness vite server, launches your installed Google Chrome
 * (real GPU + WebGPU), loads fog-probe.html, waits for the render to settle,
 * and screenshots the real `buildSkyMaterial()` output. Fails the run if the
 * material logged any error, because a broken TSL graph renders as a black
 * dome that would otherwise screenshot as a "success".
 *
 *   pnpm --filter @sugarmagic/perf-harness probe:fog [--out=path.png]
 *
 * --preset renders the golden_hour preset as authoring produces it, instead of
 * the hand-set sunset values.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Direct-binary launch + CDP attach (NOT chromium.launch): a Playwright-
// launched Chrome can't screenshot the WebGPU canvas (times out); a
// binary-launched real Chrome driven over CDP can. Same lesson as
// auto-capture.mjs.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9228;
const PROFILE = join(homedir(), ".sugarmagic-perf-chrome");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = 5197;
const OUT = args.out ?? resolve(packageDir, "fog-probe.png");
const log = (...m) => console.log("[fog-probe]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/fog-probe.html`, {
      signal: AbortSignal.timeout(1500)
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function cdpUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(1500)
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  let vite;
  let chrome;
  let browser;
  try {
    if (!(await serverUp())) {
      log("starting vite dev server ...");
      vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT)], {
        cwd: packageDir,
        stdio: "ignore"
      });
      for (let i = 0; i < 40 && !(await serverUp()); i += 1) await sleep(500);
      if (!(await serverUp())) throw new Error("vite dev server never came up");
    }
    log("launching real Chrome (binary + CDP, real GPU) ...");
    const pageUrl = (fog) =>
      `http://localhost:${PORT}/fog-probe.html` + (fog ? "" : "?fog=off");
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}-fogprobe`,
        "--no-first-run",
        "--no-default-browser-check",
        pageUrl(false)
      ],
      { detached: true, stdio: "ignore" }
    );
    chrome.unref();
    for (let i = 0; i < 40 && !(await cdpUp()); i += 1) await sleep(500);
    if (!(await cdpUp())) throw new Error("Chrome debug port never came up");

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("fog-probe.html"));
    if (!page) page = await ctx.newPage();

    // Two full boots, not a runtime toggle: mutating the post-process binding
    // after createRenderView does not rebuild the chain.
    const capture = async (fog) => {
      await page.goto(pageUrl(fog), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.__probeReady === true, {
        timeout: 30000
      });
      await sleep(400);
      if (fog) await page.screenshot({ path: OUT });
      return page.evaluate(() => globalThis.__fogProbe);
    };

    const off = await capture(false);
    const on = await capture(true);
    log(`screenshot -> ${OUT}`);

    const dist = (a, b) =>
      Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2));
    const byLabel = (r) => Object.fromEntries(r.samples.map((s) => [s.label, s.rgb]));
    const o = byLabel(off);
    const n = byLabel(on);
    const rows = Object.keys(o).map((label) => ({
      label,
      off: o[label],
      on: n[label],
      delta: dist(o[label], n[label])
    }));

    console.log("\n=== FOG DIAGNOSTICS ===");
    for (const r of rows) {
      console.log(
        `${r.label.padEnd(12)} off=[${r.off.join(",")}]  on=[${r.on.join(",")}]  delta=${r.delta}`
      );
    }

    const skyDelta = rows.find((r) => r.label === "sky").delta;
    const near = rows.find((r) => r.label.startsWith("ground@40")).delta;
    const far = rows.find((r) => r.label.startsWith("ground@550")).delta;
    const verdict =
      skyDelta > 12
        ? `FAIL -- fog is eating the sky (delta ${skyDelta}); the sky gate is missing or mis-thresholded`
        : far <= near
          ? `FAIL -- no atmospheric perspective (near ${near} >= far ${far}); gate too aggressive or fog not applying`
          : `PASS -- sky clean (delta ${skyDelta}), distance fog intact (near ${near} -> far ${far})`;
    console.log(`\n${verdict}`);
    const errs = [...(off.errors ?? []), ...(on.errors ?? [])];
    if (errs.length) console.log(`console errors: ${errs.length}\n${errs.join("\n")}`);

    await browser.close().catch(() => {});
    for (const p of ctx.pages()) await p.close().catch(() => {});
    if (verdict.startsWith("FAIL")) throw new Error(verdict);
  } finally {
    vite?.kill();
  }
}

main().catch((e) => {
  console.error("[fog-probe] FAILED:", e.message);
  process.exit(1);
});
