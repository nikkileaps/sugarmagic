/**
 * Sky probe driver. QA-only, never shipped.
 *
 * Spawns the harness vite server, launches your installed Google Chrome
 * (real GPU + WebGPU), loads sky-probe.html, waits for the render to settle,
 * and screenshots the real `buildSkyMaterial()` output. Fails the run if the
 * material logged any error, because a broken TSL graph renders as a black
 * dome that would otherwise screenshot as a "success".
 *
 *   pnpm --filter @sugarmagic/perf-harness probe:sky [--preset] [--out=path.png]
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
const CDP_PORT = 9225;
const PROFILE = join(homedir(), ".sugarmagic-perf-chrome");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = 5198;
const OUT = args.out ?? resolve(packageDir, "sky-probe.png");
const log = (...m) => console.log("[sky-probe]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/sky-probe.html`, {
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
    const url =
      `http://localhost:${PORT}/sky-probe.html` + (args.preset ? "?preset" : "");
    log("launching real Chrome (binary + CDP, real GPU) ...");
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}-skyprobe`,
        "--no-first-run",
        "--no-default-browser-check",
        url
      ],
      { detached: true, stdio: "ignore" }
    );
    chrome.unref();
    for (let i = 0; i < 40 && !(await cdpUp()); i += 1) await sleep(500);
    if (!(await cdpUp())) throw new Error("Chrome debug port never came up");

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("sky-probe.html"));
    if (!page) {
      page = await ctx.newPage();
    }
    // Always navigate, even when reusing a page: matching on the filename
    // alone also matches a "?preset" URL from a previous run, which would
    // silently screenshot the wrong configuration.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__skyProbeReady === true, {
      timeout: 20000
    });
    await sleep(500);
    await page.screenshot({ path: OUT });
    log(`screenshot -> ${OUT}`);

    // A broken TSL graph typically logs at material compile and leaves a black
    // dome, which screenshots "successfully". Surface it as a failure instead.
    const shaderErrors = await page.evaluate(() => globalThis.__skyProbeErrors ?? []);
    if (shaderErrors.length > 0) {
      throw new Error(
        `sky material reported ${shaderErrors.length} error(s):\n` +
          shaderErrors.join("\n")
      );
    }
    log(
      "EXPECT: violet zenith -> pink midband -> warm horizon, with soft " +
        "wind-streaked cloud bands above the horizon line."
    );
    await browser.close().catch(() => {});
    for (const p of ctx.pages()) await p.close().catch(() => {});
  } finally {
    vite?.kill();
  }
}

main().catch((e) => {
  console.error("[sky-probe] FAILED:", e.message);
  process.exit(1);
});
