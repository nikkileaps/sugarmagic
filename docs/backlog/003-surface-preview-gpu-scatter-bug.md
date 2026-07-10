# Backlog: Surface preview renders zero GPU-scatter grass instances

**Severity:** Medium (preview-only today; latent for any under-65k
landscape grass channel if the landscape datapoint below is wrong)

**Status:** Investigated 2026-07-10; root cause NOT confirmed —
needs a live WebGPU debugging session. All evidence below is
verified; candidates are ranked hypotheses.

## Symptom

Surface Library preview (apps/studio/src/viewport/
surfacePreviewViewport.tsx): a grass scatter layer renders ZERO
visible instances; a flowers layer in the SAME preview scene
renders correctly. The same grass layer renders correctly on the
landscape.

## Verified facts (do not re-derive)

- Instrumentation in surfacePreviewViewport logs
  `[surface-preview] scatter layer`: grass gets samples=1089,
  density=70, enabled, opacity 0.95, and the GPU pipeline builds
  3 bin InstancedMeshes (near/far/billboard) — nothing visible.
  Flowers: 49 samples, 2 bins, visible.
- The landscape's grass currently exceeds the 65,536-candidate
  GPU cap (~87k samples) and logs "GPU compute pipeline declined
  ... Falling back to CPU instancing" — so today's landscape
  grass is CPU-instanced and unaffected.
- OPEN QUESTION to confirm first: early light strokes (few
  painted texels, far under the cap) appeared to show tufts on
  the landscape, which would mean GPU grass DID render there and
  the bug is preview-context-specific. Confirm by painting a tiny
  grass patch on a fresh region and checking for the "declined"
  message absence + visible tufts.
- Structural difference between the working and broken layers:
  grass has a wind deform shader (foliage-wind, reads the
  `instanceOrigin` vec2 attribute in the vertex stage —
  packages/render-web/src/materialize/effect.ts:302) and a 3rd
  LOD bin (billboard). Flowers have neither.

## Ranked candidates (from 2026-07-10 investigation)

1. **Wind/instanceOrigin in the GPU path.** GPU bins attach
   `instanceOrigin` as a STORAGE attribute inside
   createScatterComputePipeline (compute-pipeline.ts:597-600)
   AFTER the material is created (scatter/index.ts:575-592); the
   CPU path attaches a plain InstancedBufferAttribute BEFORE
   material creation. TSL resolves attributes at first render so
   timing may not matter — but storage-vs-plain attribute reads
   in the vertex stage may differ. Test: a grass type with no
   wind through the GPU preview path.
2. **mesh.count vs indirect draw args** (compute-pipeline.ts:
   601-602): count = full sampleCount while compaction writes
   indirectDrawArgs; if the backend ever consults count over the
   indirect buffer, uncompacted garbage renders (or nothing).
3. **Two RenderViews / shared renderer**: prepareForRender guard
   keys on `${camera.uuid}:${renderer.info.frame}`; shared
   visible buffers could be clobbered between views. Doesn't
   explain flowers working; low.
4. Billboard-bin geometry or LOD assignment: logic reads correct
   for a 6.7m camera (near bin); low.

## Debug plan for the live session

1. Confirm the open question above (tiny grass patch, fresh region).
2. In the preview, readback visibleCount / indirectDrawArgs per
   bin after a few frames (three WebGPU buffer readback) — is
   compaction producing zero, or are instances drawn invisibly?
3. If drawn-but-invisible: null out the wind deform on the grass
   material in createScatterMaterialForGeometry and re-test —
   isolates the wind shader.
4. If compaction-zero: step the mark/scan/compact chain with the
   preview camera uniforms.

Investigation notes + full candidate table: session 2026-07-10.
The `[surface-preview] scatter layer` breadcrumb log in
surfacePreviewViewport.tsx is load-bearing for this — keep it.
