/**
 * Launch the perf Chrome (Plan 070.1 tooling).
 *
 * Playwright OWNS the launch — this is the reliable path on macOS. Raw
 * `open -na` drops the debug flags (LaunchServices coalesces to your
 * running Chrome), and launching the .app binary directly gives windows
 * whose browser UI never paints (blank window + traffic lights only).
 * `launchPersistentContext` spawns Chrome correctly (painted, focusable),
 * persists the profile so you sign in ONCE, keeps `--remote-debugging-port`
 * open for the measure/attribute drivers, and uses real Chrome for WebGPU.
 *
 * Leaves your normal Chrome untouched (separate profile dir).
 *
 *   node driver/launch-perf-chrome.mjs   # stays running; Ctrl-C to close
 *
 * Then, in the window it opens: sign in -> load project -> start preview
 * -> walk into the scene. In another terminal:
 *   pnpm --filter @sugarmagic/perf-harness attribute:render
 */

import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port ?? 9222);
const URL = args.url ?? "http://localhost:5173/";
const PROFILE = args.profile ?? join(homedir(), ".sugarmagic-perf-chrome");

const log = (...m) => console.log("[launch]", ...m);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: null, // real window size, not a fixed viewport
  args: [
    `--remote-debugging-port=${PORT}`,
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit"
  ]
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(URL, { waitUntil: "domcontentloaded" }).catch((e) => {
  log(`nav warning: ${e.message.split("\n")[0]} (is the Studio dev server up at ${URL}?)`);
});

log(`Chrome up on :${PORT}, profile ${PROFILE}`);

// Screenshot + dump the interactive surface so we can SEE the real gate
// from here (independent of whatever the on-screen window is painting).
await page.waitForTimeout(3500);
const shot = join(homedir(), ".sugarmagic-perf-chrome", "studio-state.png");
try {
  await page.screenshot({ path: shot });
  const summary = await page.evaluate(() => {
    const txt = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 600);
    const buttons = [...document.querySelectorAll("button, [role=button], a")]
      .map((b) => (b.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 40);
    const inputs = [...document.querySelectorAll("input")].map(
      (i) => i.type + (i.placeholder ? `(${i.placeholder})` : "")
    );
    return { title: document.title, txt, buttons, inputs };
  });
  log(`SHOT: ${shot}`);
  log(`STATE: ${JSON.stringify(summary)}`);
} catch (e) {
  log(`inspect err: ${e.message.split("\n")[0]}`);
}
log("(process stays running to keep the browser open; Ctrl-C closes it)");

// Keep alive until the browser is closed or the process is signalled.
ctx.on("close", () => {
  log("browser closed; exiting.");
  process.exit(0);
});
process.on("SIGINT", async () => {
  await ctx.close().catch(() => {});
  process.exit(0);
});
// Park forever.
await new Promise(() => {});
