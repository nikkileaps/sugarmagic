/**
 * Render-frame attribution (Plan 070.1).
 *
 * Attaches over CDP to a Chrome you launched with the debug port, finds
 * the running preview, and drives the runtime host's `window.__smperf`
 * A/B toggles to attribute the ~27ms render cost. For each condition it
 * flips the toggle, lets the scene settle, then averages the host's own
 * 1Hz `window.__smperfStats` (frame / world / session / render-cpu /
 * gpu+rest ms). Prints a table ready to paste into the plan doc.
 *
 * SETUP (does NOT touch your normal Chrome — launches a separate instance
 * with its own profile dir so the debug port is honored alongside it):
 *   1. open -na "Google Chrome" --args --remote-debugging-port=9222 \
 *        --user-data-dir="$HOME/.sugarmagic-perf-chrome" \
 *        --disable-gpu-vsync --disable-frame-rate-limit
 *      (reuses the same profile dir each run, so you sign in once, ever.)
 *   2. In that window: open Studio -> load project -> start preview -> get
 *      INTO the scene (a scatter-heavy region: the lavender meadow).
 *
 * Then:  node driver/attribute-render.mjs [--seconds=4] [--port=9222]
 *
 * To also measure the reboot cost, restart the preview once while this is
 * NOT running, then read `window.__smperfStats.lastBootMs` (the script
 * prints whatever value is present).
 */

import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port ?? 9222);
const SECONDS = Number(args.seconds ?? 4);
const MATCH = args.match ?? "preview.html";

const log = (...m) => console.log("[attr]", ...m);

// The A/B matrix. Each row is a `window.__smperf` config; the delta from
// baseline attributes that suspect's cost.
const CONDITIONS = [
  { name: "baseline", cfg: { log: true } },
  { name: "-shadows", cfg: { log: true, noShadows: true } },
  { name: "-scatter", cfg: { log: true, noScatter: true } },
  { name: "-landscape", cfg: { log: true, noLandscape: true } },
  { name: "-all", cfg: { log: true, noShadows: true, noScatter: true, noLandscape: true } }
];

async function measureCondition(preview, cfg, seconds) {
  // Set the toggle, then poll the host's published 1Hz stats and average
  // the snapshots that land during the window (skip the first to let the
  // toggle + a fresh 1Hz bucket settle).
  return preview.evaluate(
    async ({ cfg, seconds }) => {
      globalThis.__smperf = cfg;
      const seen = [];
      const end = performance.now() + seconds * 1000;
      let lastFrameStamp = -1;
      // Poll every 250ms; the host publishes ~1Hz, so dedupe by frameMs.
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          const s = globalThis.__smperfStats;
          if (s && s.frameMs !== lastFrameStamp) {
            lastFrameStamp = s.frameMs;
            seen.push({ ...s });
          }
          if (performance.now() >= end) {
            clearInterval(iv);
            resolve();
          }
        }, 250);
      });
      const samples = seen.slice(1); // drop the settling bucket
      const avg = (k) =>
        samples.length
          ? Number(
              (samples.reduce((a, s) => a + (s[k] ?? 0), 0) / samples.length).toFixed(2)
            )
          : null;
      return {
        buckets: samples.length,
        frameMs: avg("frameMs"),
        fps: avg("fps"),
        worldMs: avg("worldMs"),
        sessionMs: avg("sessionMs"),
        renderCpuMs: avg("renderCpuMs"),
        gpuRestMs: avg("gpuRestMs"),
        lastBootMs: globalThis.__smperfStats?.lastBootMs ?? null
      };
    },
    { cfg, seconds }
  );
}

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
  const preview =
    pages.find((p) => p.url().includes(MATCH)) ??
    pages.find((p) => p.url().includes("preview")) ??
    null;
  if (!preview) {
    throw new Error(
      `No preview page (url containing "${MATCH}"). Is the preview open + in the scene?`
    );
  }
  log(`measuring: ${preview.url()}`);

  const rows = [];
  for (const cond of CONDITIONS) {
    log(`condition ${cond.name} ...`);
    const r = await measureCondition(preview, cond.cfg, SECONDS);
    rows.push({ name: cond.name, ...r });
  }
  // Reset to off so the preview stops toggling shadows/landscape.
  await preview.evaluate(() => {
    globalThis.__smperf = false;
    globalThis.__smperfNoScatter = false;
  });

  const base = rows[0];
  const pad = (s, n) => String(s ?? "-").padEnd(n);
  log("=".repeat(78));
  log(
    pad("condition", 12) + pad("frame", 8) + pad("fps", 6) +
      pad("world", 7) + pad("session", 9) + pad("render-cpu", 12) +
      pad("gpu+rest", 10) + "d(frame)"
  );
  for (const r of rows) {
    const delta =
      r.frameMs != null && base.frameMs != null
        ? (r.frameMs - base.frameMs).toFixed(1)
        : "-";
    log(
      pad(r.name, 12) + pad(r.frameMs, 8) + pad(r.fps, 6) +
        pad(r.worldMs, 7) + pad(r.sessionMs, 9) + pad(r.renderCpuMs, 12) +
        pad(r.gpuRestMs, 10) + delta
    );
  }
  log("=".repeat(78));
  log(`reboot cost (lastBootMs): ${base.lastBootMs ?? "n/a — restart preview once to capture"}`);
  log("negative d(frame) on a '-suspect' row = that suspect's per-frame cost.");

  await browser.close();
}

main().catch((err) => {
  console.error("[attr] FAILED:", err.message);
  process.exit(1);
});
