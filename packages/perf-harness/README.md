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
# 1. Quit Chrome completely (Cmd-Q), then:
open -a "Google Chrome" --args --remote-debugging-port=9222 \
  --disable-gpu-vsync --disable-frame-rate-limit
# 2. Open Studio -> load project -> start preview -> get into the scene
#    (open the debug HUD's Renderer tab for draw/tri readouts).
# 3.
pnpm --filter @sugarmagic/perf-harness measure:live
```

Reports median/p95 frame time + fps and scrapes the HUD text. Use it to
A/B a fix: measure, apply the fix, rebuild, measure again.

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
