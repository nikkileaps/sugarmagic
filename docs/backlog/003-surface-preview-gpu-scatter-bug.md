# RESOLVED: GPU scatter rendered zero instances (mid-render-pass compute)

**Status:** FIXED 2026-07-10. Kept for the mechanism writeup — this
failure mode is subtle and will tempt someone to reintroduce it.

## Symptom

Any scatter layer whose GPU compute pipeline included a billboard
LOD bin rendered ZERO instances across ALL its bins (grass types
ship 3 bins; the built-in flowers ship 2, which is why flowers
survived and grass vanished). Seen in the Surface Library preview;
also latent for any under-65k-sample landscape grass channel.

## Root cause (proven via standalone repro + GPU buffer readback)

The scatter compute chain (candidates -> markVisible -> scan ->
compact) was dispatched via `renderer.compute()` from inside
`mesh.onBeforeRender` — i.e. MID-RENDER-PASS in three's WebGPU
backend. In the 3-bin configuration this silently corrupted the
compaction: `candidateActive` was correct (~1052/1089) but every
bin's `frameActive`/`visibleCount` read back 0, with no WebGPU
validation errors. The identical dispatches issued OUTSIDE the
render pass produced correct output (visibleCount=1052) — verified
by direct storage-buffer readback.

## Fix (single enforcer)

- `RenderView.renderOnce` runs a scatter pre-pass BEFORE
  `renderPipeline.render()`: it traverses the scene and invokes
  `object.userData.sugarmagicScatterPrepare(renderer, camera)`.
  Gated on `renderPipeline` existing — dispatching before backend
  init eats the pipeline's one-shot candidate build.
- The scatter builder sets that userData hook on each bin mesh and
  does NOT register `onBeforeRender`. Two dispatch paths interleave
  their per-camera-frame guards and reintroduce the mid-pass
  corruption every other frame — this was observed, not theorized.
  ADR 014 makes RenderView the only view class, so the pre-pass
  covers every render surface.

## Known limitation

Renders that bypass a RenderView loop (one-off captures /
thumbnails rendering a scene containing GPU scatter) do not run
the pre-pass and will show no scatter. Previously they showed
corrupt-or-none for multi-bin layers anyway. If a capture path
ever needs scatter, call the mesh's `sugarmagicScatterPrepare`
before rendering.

## Debugging technique worth remembering

A standalone Vite page (apps/studio/repro-scatter.html, deleted
with this fix — see git history at the fix commit) building the
scatter path against `createEmptyContentLibrarySnapshot` built-ins,
driven by Playwright with WebGPU, with
`renderer.getArrayBufferAsync(storageAttribute)` readbacks per
compute stage. Bisection knobs as URL params. This turned an
"invisible grass" report into a per-stage numeric diff in minutes.
