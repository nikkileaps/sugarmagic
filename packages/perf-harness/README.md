# @sugarmagic/perf-harness

Standalone GPU perf tooling. **QA only -- never imported by the app.**

Drives the real `RenderView` loop from `@sugarmagic/render-web` in your
**installed Google Chrome** (headed, real GPU + WebGPU) via Playwright.
The Playwright-bundled Chromium (and the MCP browser) ship **no WebGPU**,
so `channel:'chrome'` is required.

## `measure:live` -- the real scene (option B)

Attaches over CDP to a Chrome you launched, finds the running preview
window, and measures the actual scene (scatter + ensure-loop machinery)
that the synthetic rig can't reproduce. Read-only.

```
# 1. Launch a SEPARATE debuggable Chrome (leaves your normal Chrome +
#    tabs untouched; own profile dir -> sign in once, ever):
open -na "Google Chrome" --args --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sugarmagic-perf-chrome" \
  --disable-gpu-vsync --disable-frame-rate-limit
# 2. In that window: Studio -> load project -> start preview -> get into
#    the scene (open the debug HUD's Renderer tab for draw/tri readouts).
# 3.
pnpm --filter @sugarmagic/perf-harness measure:live
```

Reports median/p95 frame time + fps and scrapes the HUD text. Use it to
A/B a fix: measure, apply the fix, rebuild, measure again.

## `capture` -- fully automated, ZERO human (Plan 070.1)

The one that matters. Claude/CI runs it start-to-finish: it launches a
real hardware-WebGPU Chrome itself (direct binary — the debug port works
and WebGPU renders on the actual GPU even if the browser toolbar doesn't
paint; we drive it entirely over CDP and never need to see it), drives
the Studio (start Preview -> New Game -> wait for the scene), runs the
host's `__smperfRun()` A/B matrix, and prints the table. No human, no
attaching to a hand-launched browser.

```
pnpm --filter @sugarmagic/perf-harness capture           # launches + closes Chrome
pnpm --filter @sugarmagic/perf-harness capture -- --keep # reuse Chrome next run (faster)
```

Notes: the Studio profile persists (project stays open, so no picking);
the game's "New Game" enters the scene without the sign-in wall (local
preview). Default region spawn sits near the 60fps vsync cap — drive the
player into a heavier viewpoint for render-bound numbers (movement
automation TBD).

## `attribute:render` -- split the render frame (Plan 070.1)

Same CDP attach as `measure:live`, but drives the runtime host's
`window.__smperf` A/B toggles to attribute the render cost. For each
condition (baseline, -shadows, -scatter, -landscape, -all) it flips the
toggle, lets the scene settle, and averages the host's own 1Hz
`window.__smperfStats` (frame / world / session / render-cpu / gpu+rest
ms), then prints a table. The `d(frame)` column on a `-suspect` row is
that suspect's per-frame cost.

```
# same setup as measure:live (Chrome on :9222, preview in a scatter-heavy scene)
pnpm --filter @sugarmagic/perf-harness attribute:render -- --seconds=4
```

The host probe is dev-only and off by default (`window.__smperf` unset).
It also publishes `window.__smperfStats.lastBootMs` -- restart the
preview once to capture the PREVIEW_BOOT reboot cost.

## `measure:load` -- synthetic sweep

Spawns a headed Chrome over a tunable plain-three load; sanity-checks the
rig and A/Bs isolated engine changes against synthetic draw/tri pressure.
Not representative of the engine's per-frame machinery.

```
pnpm --filter @sugarmagic/perf-harness measure:load -- --sweep=300,1500,4000,8000 --detail=32
```

A Chrome window opens (the driver controls it -- don't touch it). vsync is
unlocked so frame time reflects real GPU work.

## `dev` -- just look at it

```
pnpm --filter @sugarmagic/perf-harness dev
# http://localhost:5199/?meshes=600&detail=48
```

## Findings so far

- The always-on WebGPU timestamp-query "TEMP DEBUG" instrumentation cost
  ~0-0.3 ms/frame (noise) and was removed from `RenderView` outright.
- Synthetic plain load needs ~16k draws to reach 30fps on this GPU, but
  the real scene hits 30fps at ~596 draws / 665k tris -> the bottleneck
  is engine per-frame machinery (scatter compute, material
  multiplication), not draw/triangle count. Measure it with `measure:live`.
