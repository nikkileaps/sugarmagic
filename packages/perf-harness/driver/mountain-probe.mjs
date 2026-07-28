/**
 * Mountain silhouette probe driver. QA-only, never shipped.
 *
 *   pnpm --filter @sugarmagic/perf-harness probe:mountain [--out=path.png]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9230;
const PORT = 5198;
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const OUT = args.out ?? resolve(packageDir, "mountain-probe.png");
const log = (...m) => console.log("[mountain-probe]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

async function main() {
  let vite, chrome, browser;
  const url = `http://localhost:${PORT}/mountain-probe.html`;
  try {
    if (!(await up(url))) {
      log("starting vite ...");
      vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT)], {
        cwd: packageDir,
        stdio: "ignore"
      });
      for (let i = 0; i < 40 && !(await up(url)); i += 1) await sleep(500);
      if (!(await up(url))) throw new Error("vite never came up");
    }
    log("launching real Chrome (binary + CDP, real GPU) ...");
    chrome = spawn(
      CHROME,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${join(homedir(), ".sugarmagic-perf-chrome")}-mtnprobe`,
        "--no-first-run",
        "--no-default-browser-check",
        url
      ],
      { detached: true, stdio: "ignore" }
    );
    chrome.unref();
    const cdp = `http://127.0.0.1:${CDP_PORT}/json/version`;
    for (let i = 0; i < 40 && !(await up(cdp)); i += 1) await sleep(500);
    if (!(await up(cdp))) throw new Error("Chrome debug port never came up");

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("mountain-probe.html"));
    if (!page) page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__probeReady === true, { timeout: 30000 });
    await sleep(600);
    await page.screenshot({ path: OUT });
    log(`screenshot -> ${OUT}`);
    const diag = await page.evaluate(() => globalThis.__mountainProbe);
    console.log("\n=== MOUNTAIN DIAGNOSTICS ===");
    console.log((diag?.report ?? []).join("\n"));
    if (diag?.errors?.length) console.log(`\nerrors:\n${diag.errors.join("\n")}`);
    await browser.close().catch(() => {});
    for (const p of ctx.pages()) await p.close().catch(() => {});
  } finally {
    vite?.kill();
  }
}

main().catch((e) => {
  console.error("[mountain-probe] FAILED:", e.message);
  process.exit(1);
});
