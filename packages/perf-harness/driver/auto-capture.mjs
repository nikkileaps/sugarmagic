/**
 * Fully-automated render-frame capture (Plan 070.1) — ZERO human in the loop.
 *
 * Claude (or CI) runs this start-to-finish: it launches a real, hardware-
 * WebGPU Chrome itself (direct binary — the debug port works and WebGPU
 * renders on the actual GPU even though the browser toolbar may not paint;
 * we never need to SEE the window, only drive it over CDP), then drives the
 * Studio: start Preview -> New Game -> wait for the scene -> run the host's
 * `__smperfRun()` A/B matrix -> print the table.
 *
 * Why this exists: attaching to a human-launched Chrome was the slow,
 * painful bottleneck. `open -na` drops the debug flags; a painted window
 * isn't needed. This owns the whole thing.
 *
 *   node driver/auto-capture.mjs [--port=9223] [--studio=http://localhost:5173]
 *                               [--wd=60000] [--keep]
 *
 * --keep leaves Chrome running for the next capture (faster; reuses the
 * signed-in/loaded profile). Default closes the launched Chrome at the end
 * unless it was already running when we attached.
 */

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port ?? 9223);
const STUDIO = args.studio ?? "http://localhost:5173/";
const WD = Number(args.wd ?? 60000);
const KEEP = args.keep === "true";
const PROFILE = join(homedir(), ".sugarmagic-perf-chrome");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const log = (...m) => console.log("[capture]", ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = `http://127.0.0.1:${PORT}`;

async function portUp() {
  try {
    const r = await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("[capture] WATCHDOG — aborting");
    process.exit(2);
  }, WD);

  let launchedByUs = false;
  if (!(await portUp())) {
    log("launching hardware-WebGPU Chrome (headed, own profile) ...");
    const child = spawn(
      CHROME,
      [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
        STUDIO
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    launchedByUs = true;
    for (let i = 0; i < 40 && !(await portUp()); i += 1) await sleep(500);
    if (!(await portUp())) throw new Error("Chrome debug port never came up");
  } else {
    log("attaching to Chrome already on :" + PORT);
  }

  const browser = await chromium.connectOverCDP(cdp);
  const ctx = browser.contexts()[0];
  const findStudio = () => ctx.pages().find((p) => p.url().includes("5173") && !p.url().includes("preview.html"));
  const findPreview = () => ctx.pages().find((p) => p.url().includes("preview.html"));

  // Ensure a Studio page exists.
  let studio = findStudio();
  if (!studio) {
    studio = await ctx.newPage();
    await studio.goto(STUDIO, { waitUntil: "domcontentloaded" });
  }
  await studio.waitForTimeout(1500);

  // Start Preview if not already running (button reads "Preview" -> "Stop Preview").
  if (!findPreview()) {
    log("starting Preview ...");
    await studio.evaluate(() => {
      const b = [...document.querySelectorAll("button,[role=button]")].find(
        (x) => /(^|\s)Preview$/i.test((x.textContent || "").trim()) || /▶Preview/.test(x.textContent || "")
      );
      b?.click();
    });
    for (let i = 0; i < 30 && !findPreview(); i += 1) await sleep(500);
  }
  const preview = findPreview();
  if (!preview) throw new Error("preview.html never opened");
  log("preview page: " + preview.url());

  // If at the start menu, click New Game and wait for the scene.
  await preview.waitForTimeout(1500);
  const atStartMenu = await preview.evaluate(() =>
    [...document.querySelectorAll("button,[role=button]")].some((b) => /new game/i.test(b.textContent || ""))
  );
  if (atStartMenu) {
    log("clicking New Game ...");
    await preview.evaluate(() => {
      const b = [...document.querySelectorAll("button,[role=button]")].find((x) => /new game/i.test(x.textContent || ""));
      b?.click();
    });
  }

  // Wait until the host is live (its __smperfRun is exposed). If it stalls
  // and the game is sitting on the "Sign In to Play" wall, fill the test
  // creds from env (SM_TEST_EMAIL / SM_TEST_PASSWORD) and retry once.
  log("waiting for the scene to boot ...");
  let ready = false;
  let triedSignIn = false;
  for (let i = 0; i < 40; i += 1) {
    ready = await preview.evaluate(() => typeof globalThis.__smperfRun === "function");
    if (ready) break;
    if (i === 8 && !triedSignIn && process.env.SM_TEST_EMAIL && process.env.SM_TEST_PASSWORD) {
      triedSignIn = true;
      const filled = await preview.evaluate((creds) => {
        const email = document.querySelector('input[type=email], input[name*=email i], input[placeholder*=email i]');
        const pass = document.querySelector('input[type=password]');
        if (!email || !pass) return false;
        const set = (el, v) => {
          const proto = Object.getPrototypeOf(el);
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        set(email, creds.email);
        set(pass, creds.password);
        const btn = [...document.querySelectorAll("button")].find((b) => /^sign in$/i.test((b.textContent || "").trim()));
        btn?.click();
        return true;
      }, { email: process.env.SM_TEST_EMAIL, password: process.env.SM_TEST_PASSWORD });
      if (filled) log("filled sign-in from env creds, retrying ...");
    }
    await sleep(500);
  }
  if (!ready) throw new Error("__smperfRun never appeared (host didn't boot; sign-in may be blocking — set SM_TEST_EMAIL/SM_TEST_PASSWORD)");
  await preview.waitForTimeout(1500); // let it settle

  log("running A/B matrix (~20s) ...");
  const res = await preview.evaluate(async () => globalThis.__smperfRun());
  clearTimeout(watchdog);
  console.log("\n" + (res?.table ?? JSON.stringify(res)));
  const boot = await preview.evaluate(() => globalThis.__smperfStats?.lastBootMs ?? null);
  console.log("reboot(lastBootMs): " + boot);

  if (launchedByUs && !KEEP) {
    await browser.evaluate?.(() => {}).catch(() => {});
    // Close the Chrome we launched.
    for (const p of ctx.pages()) await p.close().catch(() => {});
    await browser.close().catch(() => {});
    log("closed the Chrome we launched (pass --keep to reuse it).");
  } else {
    await browser.close().catch(() => {}); // detach only
    log("left Chrome running for reuse.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[capture] FAILED:", e.message);
  process.exit(1);
});
