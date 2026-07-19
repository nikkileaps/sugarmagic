/**
 * Instanced-mask probe driver (Plan 070.5 / #360). QA-only, never shipped.
 *
 * Spawns the harness vite server, launches your installed Google Chrome
 * (channel:'chrome' -> real GPU + WebGPU), loads mask-probe.html, waits for
 * the render to settle, and screenshots it. The screenshot shows the bug
 * (back row: positionLocal, 2 of 3 boxes flat) next to the fix (front row:
 * positionGeometry, all ramp) -- durable, re-runnable proof, not a throwaway.
 *
 *   pnpm --filter @sugarmagic/perf-harness probe:mask [--out=path.png]
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
const CDP_PORT = 9224;
const PROFILE = join(homedir(), ".sugarmagic-perf-chrome");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = 5199;
const OUT = args.out ?? resolve(packageDir, "mask-probe.png");
const log = (...m) => console.log("[mask-probe]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/mask-probe.html`, {
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
    const url = `http://localhost:${PORT}/mask-probe.html`;
    log("launching real Chrome (binary + CDP, real GPU) ...");
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}-maskprobe`,
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
    let page = ctx.pages().find((p) => p.url().includes("mask-probe.html"));
    if (!page) {
      page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    await page.waitForFunction(() => globalThis.__maskProbeReady === true, {
      timeout: 20000
    });
    await sleep(500);
    await page.screenshot({ path: OUT });
    log(`screenshot -> ${OUT}`);
    log(
      "EXPECT: back row (positionLocal) has its x=6 & x=12 boxes FLAT pink; " +
        "front row (positionGeometry) has all three ramping dark->pink."
    );
    await browser.close().catch(() => {});
    for (const p of ctx.pages()) await p.close().catch(() => {});
  } finally {
    vite?.kill();
  }
}

main().catch((e) => {
  console.error("[mask-probe] FAILED:", e.message);
  process.exit(1);
});
