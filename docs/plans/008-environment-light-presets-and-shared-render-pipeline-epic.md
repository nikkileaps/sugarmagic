# Plan 008: Environment Light Presets and Shared Render Pipeline Epic

**Status:** Proposed  
**Date:** 2026-04-02

## Epic

### Title

Bring Sugarbuilder's environment light presets into `Build > Environment` while establishing one runtime-owned render pipeline for environment rendering across authoring, preview, and published web targets.

### Goal

Deliver the first real `Build > Environment` slice in Sugarmagic by:

- bringing over Sugarbuilder's authored light preset workflow
- making `Build > Environment` a real workspace instead of a stub
- treating environments as reusable authored definitions rather than region-owned state
- centralizing environment rendering semantics in `runtime-core`
- ensuring preview and published web targets use the same environment/rendering path
- setting a clean foundation for later fog, bloom, SSAO, sky, and cloud migration
- hardening the render pipeline so custom TSL/node-based rendering work can fail safely instead of poisoning the whole runtime

This epic is intentionally broader than a single dropdown.

The visible first slice is light presets.
The architectural purpose is to stop environment rendering from splitting into:

- a studio-only editor look
- a preview-only runtime look
- a published-target look

That exact split is what created many of the Sugarbuilder/Sugarengine parity failures.

## Why this epic exists

Plan 004 established `Build` workspace-kind navigation.

Plan 005 established preview as a real runtime session launched through the same host family as published targets.

Plan 006 established the first real asset-driven authored scene.

Plan 007 established a layout-only authoring camera without bleeding that camera into runtime.

What is still missing is the authored environment loop:

- choose a lighting preset
- see the world mood change immediately
- trust that preview and published output mean the same thing

This is also the place where the old split architecture hurt the most.

Sugarbuilder and Sugarengine repeatedly drifted around:

- renderer ownership
- shader/material semantics
- environment application order
- fog/sky/post behavior
- WebGPU migration details

So this epic must not be treated as "just port the preset picker".

It must set the permanent owner for environment rendering truth.

## Sugarbuilder behavior to preserve at the product level

This epic should preserve the strong parts of the Sugarbuilder environment workflow:

- a small set of intentional light presets with real mood differences
- immediate visual feedback in the authoring viewport
- presets that carry both light arrangement and atmosphere defaults
- a clear distinction between preset choice and fine-tuning adjustments
- environment edits as authored world truth, not editor-only chrome

Relevant local references:

- [Sugarbuilder `LightingSystem.ts`](/Users/nikki/projects/sugarbuilder/src/core/LightingSystem.ts)
- [Sugarbuilder `SkyManager.ts`](/Users/nikki/projects/sugarbuilder/src/core/SkyManager.ts)
- [Sugarbuilder `PostProcessing.ts`](/Users/nikki/projects/sugarbuilder/src/core/PostProcessing.ts)
- [Sugarbuilder `EditorViewportController.ts`](/Users/nikki/projects/sugarbuilder/src/editor/three/EditorViewportController.ts)
- [Sugarbuilder `defaults.ts`](/Users/nikki/projects/sugarbuilder/src/editor/domain/defaults.ts)
- [Sugarbuilder `MaterialRenderCache.ts`](/Users/nikki/projects/sugarbuilder/src/editor/services/MaterialRenderCache.ts)

Relevant Sugarengine references:

- [Sugarengine `Engine.ts`](/Users/nikki/projects/sugarengine/src/engine/core/Engine.ts)
- [Sugarengine `SkySystem.ts`](/Users/nikki/projects/sugarengine/src/engine/core/SkySystem.ts)
- [Sugarengine `PostProcessing.ts`](/Users/nikki/projects/sugarengine/src/engine/core/PostProcessing.ts)
- [Sugarengine preview entry](/Users/nikki/projects/sugarengine/src/preview.ts)

This epic should preserve the good product behavior from Sugarbuilder while avoiding Sugarengine's former problem of partially separate runtime interpretation.

## Corrected domain direction for this epic

Environment should **not** be treated as region-owned authored truth.

That would imply:

- entering a region always changes the environment
- one region can only mean one environment state
- time-of-day, gameplay, and transition logic become awkward or invalid

That is too rigid.

### Corrected domain model

This epic should introduce or formalize three separate concepts.

#### `EnvironmentDefinition`

Reusable authored environment truth.

Owns:

- light preset
- lighting adjustments
- fog settings
- bloom settings
- SSAO settings
- sky settings
- cloud settings
- backdrop settings if they remain part of authored environment truth

#### `RegionEnvironmentBinding`

How a region relates to an environment.

Owns concepts like:

- default environment for that region
- optional override/transition policy later

It does **not** own full environment truth.

#### `RuntimeEnvironmentState`

What environment is actually active during preview or gameplay.

This belongs to runtime session state.

That means runtime is free to:

- keep the current environment across a region transition
- switch immediately to a bound environment
- blend between environments
- later respond to gameplay systems such as time-of-day, weather, or quest state

In short English pseudo code:

```text
environment definition = reusable authored environment truth
region = references an environment definition
runtime session = owns the currently active environment
```

This is the model the rest of this epic should follow.

## Product and UI clarification for this epic

The corrected domain model has an immediate shell implication.

The current `Build` subheader shape suggests that the selector in the row always means `Region`.

That works for:

- `Build > Layout`

It does **not** work cleanly for:

- `Build > Environment`

because Environment is not region-owned.

### Corrected Build context rule

Build context selection should be workspace-dependent.

That means:

- `Build > Layout`
  - context selector = `Region`
- `Build > Environment`
  - context selector = `Environment`
- `Build > Assets`
  - likely no region selector, or a library-oriented context if needed later

This epic should therefore avoid baking in the idea that the Environment workspace is editing "the environment of the currently selected region".

### First-slice UI recommendation

For the first Environment slice:

- no permanent left panel
- top/subheader context should select an `EnvironmentDefinition`
- context selector should support:
  - choosing an existing environment
  - creating a new environment
- right inspector should edit the selected `EnvironmentDefinition`
- region-oriented UI should later expose binding, for example:
  - `Default Environment` in a region inspector or layout-oriented region settings

This keeps the ownership legible:

- Environment workspace edits the reusable environment
- region-facing UI binds a region to one

## Core architecture clarification for this epic

### One runtime-owned environment rendering path

Environment rendering semantics must live in `runtime-core`.

That means `runtime-core` should become the owner of:

- canonical environment normalization
- environment definition to runtime descriptor derivation
- light preset catalog and preset application logic
- environment-to-scene application order
- sky / cloud / fog / post-processing semantic descriptors
- render compile-profile policy for environment materials/effects
- runtime diagnostics for environment/render failures

It must not live in:

- `apps/studio` as authoring-only viewport logic
- `targets/web` as target-only policy
- `packages/workspaces` as workspace-owned render behavior

In short English pseudo code:

```text
environment definition -> runtime-core environment descriptor
runtime-core environment descriptor -> runtime-core render pipeline application
apps/studio -> edits environment definition
region binding UI -> binds regions to environment definitions
targets/web -> hosts runtime-core pipeline
```

### Studio versus target ownership

This epic must keep the boundary we just fought for:

- `apps/studio` owns the Environment workspace UI and authoring orchestration
- `runtime-core` owns environment/render semantics
- `targets/web` owns web hosting around the runtime-core pipeline

So:

- Studio may host an authoring viewport
- Studio may host environment controls
- Studio may decide when preview starts and stops

But Studio must not become the owner of a separate environment renderer.

### Environment workspace shape for the first slice

For the first light-preset slice, `Build > Environment` should not require a permanent left panel.

Recommended first shape:

- left panel: `null`
- right panel: environment inspector
- center viewport: authored scene using the shared runtime-owned environment pipeline
- viewport overlays: optional and minimal

Why:

- presets and authored environment controls are inspector-shaped, not tree-shaped
- forcing a left panel early would create shell furniture without real ownership
- the first slice should stay focused on authored environment truth, not panel chrome

A left panel can be introduced later if Sugarmagic gains things like:

- environment library management
- sky/background asset browsing
- environment animation collections
- lookdev layers or render diagnostics panels

### Render pipeline shape for the first slice

For this epic, Sugarmagic should formalize a runtime-owned render-pipeline structure even if the first implementation still renders directly.

The plan should create a `runtime-core` rendering architecture with clear sub-owners, conceptually like:

- `rendering/capabilities`
- `rendering/renderer-config`
- `rendering/environment`
- `rendering/sky`
- `rendering/post`
- `rendering/materials`
- `rendering/diagnostics`
- `rendering/pipeline`

This is a system boundary, not necessarily a final folder commitment.

The important rule is:

- one owner for environment rendering semantics
- one place where renderer capabilities and compile profiles are resolved
- one place where host apps ask the runtime to apply an authored environment

### Custom shader and node-material rule

For Sugarmagic's environment and future custom shader work, this epic should explicitly favor:

- TSL / NodeMaterial-based authoring
- profile-aware compilation
- per-host instance compilation where renderer state is unsafe to share

And explicitly avoid reintroducing:

- `ShaderMaterial` as the default extensibility path
- `onBeforeCompile` patch stacks as the main environment pipeline
- host-local shader mutation that diverges between authoring and runtime

This is supported both by our own experience and by Three.js' current direction:

- `WebGPURenderer` is designed as the modern path and can fall back to WebGL2 ([Three.js manual](https://threejs.org/manual/en/webgpurenderer))
- TSL is renderer-agnostic and intended to preserve semantics across backends ([TSL spec](https://threejs.org/docs/TSL.html))
- Three.js' renderer docs explicitly support precompilation and runtime stats for managing shader/runtime stalling and debugging ([WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer.html))

### Fault isolation and error handling rule

This epic should define a real failure strategy for WebGPU-era rendering.

If one environment effect or node compile fails, Sugarmagic should not lose the entire scene if it can avoid it.

The render pipeline should be structured so that each major environment layer can fail independently:

- lighting preset application
- fog application
- sky dome material
- cloud layer material
- post-processing node graph

Pseudo code:

```text
validate canonical environment definition
build runtime environment descriptor
for each environment layer:
  try compile/apply layer
  if layer fails:
    record structured diagnostic
    apply safe fallback for that layer
continue rendering remaining layers
surface diagnostics to studio host
```

This should become a core runtime rule.

It is especially important because Sugarbuilder already learned that WebGPU/node materials can carry renderer-specific internal state and should not be blindly shared across surfaces.

## Research notes that influence this epic

The following current Three.js guidance should shape the design:

1. `WebGPURenderer` is the next-generation renderer, is initialized asynchronously, and is intended to fall back to WebGL2 when WebGPU is unavailable ([Three.js WebGPU manual](https://threejs.org/manual/en/webgpurenderer)).
2. TSL is intended to stay renderer-agnostic and can be extended through nodes rather than material-specific hacks ([TSL specification](https://threejs.org/docs/TSL.html)).
3. Three.js renderer docs explicitly support shader precompilation via `compile()` / `compileAsync()` and runtime GPU stats through `renderer.info`, which should inform warmup and diagnostics policy ([WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer.html)).
4. Three.js renderer docs also call out development-time shader error reporting, which should inform Sugarmagic's diagnostics approach rather than leaving failures silent ([WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer.html)).

We should not over-read those docs into "one magic built-in pipeline solves everything".

What they support is a clean policy direction:

- use one renderer family
- use one material/shader language family
- make compile profiles explicit
- warm up intentionally
- keep diagnostics real

## Scope of the epic

### In scope

- introduce canonical reusable environment definitions
- introduce region-to-environment binding as a separate concept
- keep active environment in runtime session state rather than region-authored state
- port Sugarbuilder light presets into Sugarmagic as canonical environment data
- create a runtime-core environment descriptor and application path
- create a runtime-core render pipeline seam for environment application
- make Studio authoring viewport and preview use the same environment application semantics
- keep published web target on the same path as preview for environment rendering
- implement `Build > Environment` as a real workspace
- deliver the first user-visible control set for environment light presets
- define fault-isolated layer application and structured render diagnostics
- define warmup/precompile policy for environment materials/effects

### Out of scope for this epic

- full sky editor parity
- full cloud editor parity
- full bloom/SSAO tuning parity
- environment animation authoring
- HDRI or environment-map authoring
- complete VFX/compositing workflows
- advanced render graph tooling UI
- asset-editor render pipeline migration beyond what is required for shared environment semantics
- full region-to-environment transition authoring policy beyond the first binding model

Those can follow, but this epic should make them easier rather than postponing the architectural foundation again.

## Stories

### Story 1: Introduce canonical EnvironmentDefinition and RegionEnvironmentBinding

Define environment ownership correctly before implementing controls.

#### Tasks

1. Introduce a canonical `EnvironmentDefinition` model for reusable authored environment truth.
2. Introduce a separate `RegionEnvironmentBinding` concept rather than expanding region-owned environment state into full environment truth.
3. Define the first runtime-session concept for currently active environment state.
4. Derive the initial environment-definition shape from Sugarbuilder's `EnvironmentDocument`, but adapt naming to Sugarmagic's domain model rather than copying blindly.
5. At minimum define canonical ownership for:
   - lighting preset
   - lighting adjustments
   - fog settings
   - bloom settings
   - SSAO settings
   - sky settings
   - backdrop toggles if they remain part of authored environment truth
6. Keep persistent editor UI state out of the canonical environment model.

#### Acceptance criteria

- Sugarmagic has reusable authored environment definitions.
- Regions bind to environments instead of owning full environment truth.
- Active runtime environment is modeled as runtime-session state, not region-authored state.
- The environment model is rich enough to support later sky/fog/post stories without another domain rewrite.

### Story 2: Correct the Build workspace context model for Environment

Make the shell reflect the corrected ownership model.

#### Tasks

1. Define Build context selection as workspace-dependent rather than universally region-dependent.
2. Ensure `Build > Layout` remains region-scoped.
3. Ensure `Build > Environment` becomes environment-scoped.
4. Define the first Environment workspace selection flow:
   - choose existing environment
   - create new environment
5. Define where region-to-environment binding will live in the product without conflating it with environment editing.

#### Acceptance criteria

- The shell no longer implies that Environment is region-owned truth.
- `Build > Environment` selects and edits an environment definition.
- The product direction for region binding is explicit even if the full binding UI lands later in the epic.

### Story 3: Establish the runtime-core environment rendering seam

Create the permanent owner for environment rendering semantics.

#### Tasks

1. Define a runtime-core environment descriptor that is derived from the canonical environment definition.
2. Define a runtime-core render pipeline seam responsible for:
   - renderer capability awareness
   - compile profile selection
   - environment layer application order
   - diagnostics collection
3. Keep host apps out of environment application logic.
4. Ensure the seam is shared by:
   - Studio authoring viewport
   - preview
   - `targets/web` published host
5. Define the lifecycle contract for apply / update / resize / dispose.

#### Acceptance criteria

- `runtime-core` is the semantic owner of environment rendering.
- Studio and web target code do not each invent their own environment application logic.
- The runtime can apply the same environment definition through the same path in authoring, preview, and published web target contexts.

### Story 4: Port Sugarbuilder light presets into runtime-core

Bring over the proven authored lighting presets first.

#### Tasks

1. Port Sugarbuilder's preset catalog from `LightingSystem.ts` into a runtime-core environment lighting module.
2. Preserve the authored preset identities:
   - `default`
   - `noon`
   - `late_afternoon`
   - `golden_hour`
   - `night`
3. Preserve the preset behavior model:
   - concrete light layout
   - background color
   - fog defaults where relevant
   - adjustment layering on top of presets
4. Keep preset semantics separate from workspace UI.
5. Define runtime normalization rules so malformed preset data does not crash application.

#### Acceptance criteria

- Sugarmagic can express and apply the same authored light presets Sugarbuilder already proved out.
- Preset meaning lives in runtime-core, not in a Studio-only form component.
- Light preset application is deterministic and shared across authoring, preview, and published target host paths.

### Story 5: Implement the first runtime-owned environment application path

Make environment actually affect the scene through the new owner.

#### Tasks

1. Implement runtime-core environment application for the first slice:
   - scene background
   - scene fog
   - concrete scene lights from preset
2. Define stable application ordering.
3. Ensure repeated application replaces prior environment state cleanly rather than leaking lights/effects.
4. Provide safe fallbacks for missing or invalid environment data.
5. Expose structured diagnostics when environment application fails.

Pseudo code:

```text
clear prior runtime-owned environment state
normalize authored environment definition
apply background
apply preset lights
apply fog
record diagnostics
```

#### Acceptance criteria

- Changing the active environment changes the actual authored scene render, not a fake editor overlay.
- Reapplying environment settings does not leak old lights or leave stale scene state behind.
- Environment failures are reported structurally rather than only as ad hoc console noise.

### Story 6: Share the same environment application path across Studio and web target host

Make parity real instead of aspirational.

#### Tasks

1. Refactor Studio authoring viewport to consume the runtime-core environment pipeline instead of directly owning environment rendering logic.
2. Refactor `targets/web` to use that same runtime-core environment pipeline.
3. Keep preview orchestration in `apps/studio` while keeping environment rendering semantics out of `apps/studio`.
4. Verify that preview and published web target host use the same environment application path.
5. Add tests proving the same authored environment descriptor yields the same runtime-applied scene state.

#### Acceptance criteria

- Studio authoring viewport does not become a second environment renderer.
- Preview and published web target host do not drift on light preset interpretation.
- The package boundary remains:
  - `runtime-core` = semantics
  - `targets/web` = host
  - `apps/studio` = editing/orchestration

### Story 7: Implement Build > Environment first-slice UI around light presets

Make the first user-facing environment workflow real.

#### Tasks

1. Replace the current Environment workspace stub.
2. Use no permanent left panel for the first slice.
3. Make the Environment workspace context selector environment-based, not region-based.
4. Add the ability to choose an existing environment definition and create a new one.
5. Add a right-panel environment inspector focused on light presets first.
6. Support selecting a light preset and applying it through the canonical command boundary.
7. Live-update the viewport through the runtime-owned environment path.
8. Keep preview/commit rules explicit if draft editing is introduced.

#### Acceptance criteria

- `Build > Environment` is a real workspace.
- The first visible workflow is choosing an environment definition and editing its light preset.
- The viewport updates immediately through shared runtime semantics.
- This slice does not introduce a fake editor-only environment render path.
- The shell no longer visually implies that Environment editing is region-owned.

### Story 8: Add render diagnostics, warmup policy, and failure isolation

Make the pipeline trustworthy under WebGPU-era instability.

#### Tasks

1. Define a runtime diagnostic model for environment/render pipeline issues.
2. Add development-time reporting for:
   - environment normalization failures
   - layer compile failures
   - host capability mismatches
3. Define warmup policy for environment-related materials/effects.
4. Use precompile/warmup where appropriate so first-use stutter is reduced.
5. Ensure one failed environment layer falls back without taking down the full scene where possible.
6. Keep diagnostics host-readable so Studio can later surface them intentionally.

#### Acceptance criteria

- Environment rendering failures are diagnosable.
- Runtime can degrade gracefully when a layer fails.
- The plan does not depend on silent shader failures or host-specific guesswork.

## Suggested implementation order

1. Story 1 — canonical environment and binding model
2. Story 2 — corrected Build context model
3. Story 3 — runtime-core environment/render seam
4. Story 4 — light preset catalog in runtime-core
5. Story 5 — first runtime-owned environment application path
6. Story 6 — share it across Studio and `targets/web`
7. Story 7 — Environment workspace preset UI
8. Story 8 — diagnostics and warmup hardening

This order is intentional.

Do not start with a preset dropdown in Studio and "wire it later".
That is how we recreate the split.

## Verification strategy

### Domain verification

1. Verify environment definitions survive save and reload.
2. Verify region-to-environment bindings survive save and reload.
3. Verify environment edits mutate canonical authored truth through commands.

### Rendering verification

1. Verify switching presets changes authored scene lighting immediately in Studio.
2. Verify the same environment definition produces the same preset result in preview.
3. Verify the same environment definition produces the same preset result in the published web host path.
4. Verify old lights/fog do not leak after repeated preset switches.

### Boundary verification

1. Verify `apps/studio` does not own a second environment renderer.
2. Verify `targets/web` does not own environment semantics.
3. Verify `packages/workspaces` own controls only, not render truth.
4. Verify regions do not directly own full environment truth.

### Diagnostics verification

1. Verify malformed environment data yields structured diagnostics.
2. Verify a failed environment layer falls back without crashing the whole host when possible.
3. Verify development-time render errors are surfaced in a way a user or developer can act on.

## Anti-patterns this epic must avoid

Do not introduce:

- a Studio-only environment renderer
- a preview-only environment renderer
- separate preset tables in UI and runtime-core
- `ShaderMaterial` as the default escape hatch for environment authoring
- `onBeforeCompile` patch chains as the primary environment system
- shared live node-material instances across incompatible surfaces/hosts
- host-local hacks that change authored environment meaning
- region-owned full environment truth
- a universal Build selector that silently implies every workspace is region-scoped
- a fake left panel with no real owner or workflow

## References

### Local references

- [Sugarmagic `runtime-core/environment`](/Users/nikki/projects/sugarmagic/packages/runtime-core/src/environment/index.ts)
- [Sugarmagic `targets/web/runtimeHost.ts`](/Users/nikki/projects/sugarmagic/targets/web/src/runtimeHost.ts)
- [Sugarmagic `Build > Environment` stub](/Users/nikki/projects/sugarmagic/packages/workspaces/src/build/environment/index.tsx)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 008: Material Semantics and Compile Profiles](/Users/nikki/projects/sugarmagic/docs/adr/008-material-semantics-and-compile-profiles.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 009: Material Compilation and Shader Pipeline Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)

### External references

- [Three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer)
- [Three.js TSL specification](https://threejs.org/docs/TSL.html)
- [Three.js WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js NodeMaterial docs](https://threejs.org/docs/pages/NodeMaterial.html)
