/**
 * Light budget driver. QA-only, never shipped.
 *
 * Spawns the harness vite server, launches your installed Google Chrome (real
 * GPU + WebGPU), walks the light-count sweep, and prints the table. The number
 * this produces is what the Studio warning threshold is set from -- the point
 * of the whole exercise is that the threshold is measured rather than guessed.
 *
 *   pnpm --filter @sugarmagic/perf-harness probe:light-budget [--out=path.json]
 *
 * Fails loudly rather than printing a partial table: a sweep that died halfway
 * looks like a machine that got fast at 32 lights.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Direct-binary launch + CDP attach, not chromium.launch(): a Playwright-
// launched Chrome does not get real WebGPU here. Same lesson as sky-probe.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9227;
const PROFILE = join(homedir(), ".sugarmagic-perf-chrome-lightbudget");
const PORT = 5197;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const OUT = args.out ?? resolve(packageDir, "light-budget.json");
const log = (...m) => console.log("[light-budget]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

const pageUrl =
  `http://localhost:${PORT}/light-budget-probe.html` +
  (args.counts ? `?counts=${args.counts}` : "");

async function main() {
  let vite;
  let chrome;
  let browser;
  try {
    if (!(await up(pageUrl))) {
      log("starting vite dev server ...");
      vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT)], {
        cwd: packageDir,
        stdio: "ignore"
      });
      for (let i = 0; i < 40 && !(await up(pageUrl)); i += 1) await sleep(500);
      if (!(await up(pageUrl)))
        throw new Error("vite dev server never came up");
    }

    log("launching real Chrome (binary + CDP, real GPU) ...");
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}`,
        "--no-first-run",
        "--no-default-browser-check",
        pageUrl
      ],
      { detached: true, stdio: "ignore" }
    );
    chrome.unref();
    const cdpUrl = `http://127.0.0.1:${CDP_PORT}/json/version`;
    for (let i = 0; i < 40 && !(await up(cdpUrl)); i += 1) await sleep(500);
    if (!(await up(cdpUrl))) throw new Error("Chrome debug port never came up");

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("light-budget-probe"));
    if (!page) page = await ctx.newPage();
    // Surface whatever the page says, so a module that fails to load reads as
    // its own error instead of as a bare timeout.
    page.on("console", (message) => {
      if (message.type() === "error") log("page error:", message.text());
    });
    page.on("pageerror", (error) => log("page threw:", error.message));
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof globalThis.__smLightBudget === "function",
      { timeout: 30000 }
    );

    log("sweeping light counts (this takes a couple of minutes) ...");
    const result = await page.evaluate(() => globalThis.__smLightBudget());
    if (!result?.rows?.length) throw new Error("sweep produced no rows");

    console.log("\n" + result.table + "\n");
    writeFileSync(OUT, JSON.stringify(result.rows, null, 2));
    log(`rows -> ${OUT}`);

    await browser.close().catch(() => {});
    for (const p of ctx.pages()) await p.close().catch(() => {});
  } finally {
    vite?.kill();
  }
}

main().catch((error) => {
  console.error("[light-budget] FAILED:", error.message);
  process.exit(1);
});
