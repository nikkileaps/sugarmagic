# Plan 030: Environment Lighting Model and Post-Process Stack Authoring Epic

**Status:** Implemented
**Date:** 2026-04-14

## Epic

### Title

Replace the opaque lighting-preset-plus-scalars model with explicit authored lighting, extend fog with color, and make `EnvironmentDefinition.postProcessShaders` a real, UI-editable stack of shader-graph-compiled post-process effects.

### Goal

Raise the environment authoring surface to the level required to produce stylized, painterly PBR scenes (sun-warm roofs, cool shadows, tinted haze, color-graded mood) — and do it by leveraging the shader graph pipeline from Plan 029 instead of bolting on more hardcoded runtime logic.

Two product outcomes:

1. **Authored lighting.** Authors can rotate the sun, pick its color and intensity, add an optional rim/back light, control how ambient is derived from the sky, and tint fog. Presets become *starting points* that populate these fields, not opaque black boxes.
2. **Authored post-process stack.** Authors can stack color grading, tone mapping, vignette, fog-tint, and bloom (any number, any order) directly in the Environment pane — all backed by built-in shader graphs from Plan 029 — with live preview.

One architectural outcome:

- **Fix the pre-existing layer violation** in `packages/runtime-core/src/render/graph.ts` and `packages/runtime-core/src/render/environment-scene.ts`. Both import `three`, `three/tsl`, and `three/webgpu` today. Lighting instantiation, sky mesh construction, and bloom pass composition move to `packages/render-web` (the Plan 029 package). Runtime-core keeps pure resolution/semantics.

This epic is deliberately **environment-only**. PBR surface shaders, foliage surface shading, and texture-set import are a separate follow-up epic (Plan 031).

### Why this epic exists

The engineer shipped a complete shader graph pipeline in Plan 029, including a `post-process` target kind and a wired-up `EnvironmentDefinition.postProcessShaders: PostProcessShaderBinding[]` contract. The pipeline is ready. The environment model is not.

Today's state:

- `EnvironmentDefinition.lighting` exposes `preset: LightingPreset` + scalar `adjustments: { ambientIntensity, keyIntensity, shadowDarkness, warmth }`. `shadowDarkness` is declared but **never consumed** in runtime. `warmth` is a wobbly HSL nudge that cannot express "the sun is coming from the upper-right at 30° elevation in a golden_hour color."
- The actual light rigs — directional positions, hemisphere colors, light counts per preset — are **hardcoded inside `runtime-core/src/render/environment-scene.ts`** in a `LIGHTING_PRESETS` constant. Authors cannot see them, change them, or override them.
- `EnvironmentDefinition.postProcessShaders` is defined in the domain and resolved by `resolveEnvironmentWithPostProcessChain()`, but **nothing applies it yet**. Post-process today is a single hardcoded bloom pass composed in `runtime-core/src/render/graph.ts`.
- Both `environment-scene.ts` and `graph.ts` import `three`, `three/tsl`, and `three/webgpu`. These are pre-existing layer violations from before Plan 029 drew the runtime-core / render-web line.

The visual target (stylized painterly RPG scene, PBR-based, reference from user) needs:

- Explicit warm directional sun + cool-tinted ambient (authored directionality, not a scalar warmth knob).
- Color grading + tone mapping + vignette as **the primary mood lever** (this is where "PBR scene" becomes "painterly PBR scene").
- Colored atmospheric fog that ties to sun/sky color.
- A bloom pass that is **part of the authored stack**, not a hardcoded branch of the render graph.

All of this is achievable in-engine today once the environment model is upgraded and the post-process stack is wired to ShaderRuntime.

## Relationship to existing work

- **Plan 029 (Shader Graph Pipeline)** — supplies the `post-process` target kind, `ShaderRuntime.applyShader()` for post targets, revision-based invalidation, and the Render workspace. This epic consumes those contracts and ships a library of built-in post-process graphs on top of them.
- **Plan 008 (Environment Light Presets and Shared Render Pipeline)** — established single-owner environment rendering in runtime-core. This epic *moves* light/sky/fog instantiation out of runtime-core into render-web, correcting a layer debt that predates Plan 029. Plan 008's goal of "preview and published targets mean the same thing" is preserved; only the physical location of the Three.js code changes.
- **Proposal 009 (Material Compilation and Shader Pipeline Architecture)** — Plan 029 implemented the shader half. This epic proves out the post-process part of that architecture by shipping real authored post-process graphs.
- **Plan 031 (PBR Surface and Foliage)** — follow-up epic, out of scope here. A separate conversation is needed about texture-set import and how foliage wind stacks with a PBR surface shader.

## Scope

### In scope

- Rework `EnvironmentDefinition.lighting` in domain: explicit `sun`, optional `rim`, authored `ambient`, retained `preset` as a template selector.
- Extend `FogSettings` with color + height falloff; tie default color to sun/sky when preset is applied.
- Retire `shadowDarkness` (dead field) and retire `warmth` (replaced by direct sun color authoring).
- Migrate the hardcoded `LIGHTING_PRESETS` constant from `runtime-core/src/render/environment-scene.ts` into **preset templates** that populate the new authored fields when a preset is selected. No more hidden rig.
- Move Three.js light/sky/fog instantiation out of runtime-core into `packages/render-web`. Runtime-core keeps only `resolveEnvironmentDefinition`, preset→field application helpers, and `ResolvedEnvironment` shapes.
- Ship built-in post-process shader graphs (one per file, via `createDefault*PostProcessShaderGraph()` factories following the Plan 029 foliage-wind convention):
  - `color-grade` — lift / gamma / gain + saturation + contrast
  - `tonemap` — ACES-fitted or Reinhard, selectable via enum parameter; authored exposure
  - `vignette` — radial darken, tint-colorable, softness-adjustable
  - `fog-tint` — depth-driven color mix against a color parameter (consumes depth; color defaults to fog color)
  - `bloom` — replaces the hardcoded bloom in `graph.ts`; same TSL bloom under the hood, exposed through the graph API
- Wire `EnvironmentDefinition.postProcessShaders` through `ShaderRuntime.applyShader({ targetKind: "post-process", renderPipeline })` on environment apply. Order respects `binding.order`, respects `binding.enabled`, runs on environment change.
- Environment pane (in the Build product mode, or moved to Render — see open question) gains a **post-process stack editor**:
  - Ordered list of bindings
  - Add/remove/reorder
  - Enable/disable per binding
  - Per-binding parameter inspector (inline, reads shader definition parameters)
  - Add-menu sources from `contentLibrary.shaderDefinitions` filtered to `targetKind: "post-process"`
- Environment pane gains a **sun/lighting inspector**:
  - Sun azimuth (0–360°) + elevation (−90 to 90°) sliders with a live 2D direction preview
  - Sun color picker + intensity + cast-shadows toggle
  - Rim light toggle + azimuth/elevation/color/intensity when enabled
  - Ambient mode selector (`sky-driven` | `flat`), plus color/intensity when flat
  - Fog color picker + density + height-falloff
- **First-class sun shadow authoring** via Three's WebGPU `CSMShadowNode`:
  - Single authored `lighting.sun.shadows` block on `EnvironmentDefinition`: enabled, quality preset, distance, strength, softness, bias, normalBias.
  - Quality preset (`low`/`medium`/`high`/`ultra`) drives cascade count, shadow map size, and PCF sampling internally — authors don't pick cascade count or split mode directly.
  - Single implementation path in `EnvironmentSceneController`; used by Studio authoring viewport and published runtime identically.
  - Cheap live edits (distance/strength/softness) update uniforms; expensive ones (quality change) rebuild the shadow setup.
- **Command surface policy:** extend the currently-shipped environment and post-process command family — do not rename. Specifically:
  - Lighting, rim, ambient, fog, and any other `EnvironmentDefinition`-scoped edits route through the existing `UpdateEnvironmentDefinitionCommand` (`packages/domain/src/commands/index.ts:208`). New authored fields (sun azimuth, etc.) are reached via this one command by supplying a whole updated definition.
  - Post-process stack edits route through the existing `AddPostProcessShaderCommand` / `RemovePostProcessShaderCommand` / `UpdatePostProcessShaderOrderCommand` / `UpdatePostProcessShaderParameterCommand` / `TogglePostProcessShaderCommand` family — already shipped, already handled by the reducer in `authoring-session/index.ts`.
  - No new command types, no renames in this epic. Finer-grained lighting commands (e.g. `UpdateEnvironmentSunCommand`) are a potential future refactor, not in scope here.
- Integration tests in `packages/testing`: environment-runtime test is extended to assert sun direction, fog color, and authored post-process ordering flow through the apply path.

### Out of scope (explicitly)

- PBR surface shader graph (`pbr-surface`) — next epic (Plan 031).
- Texture-set import from Substance — next epic.
- Foliage surface shader (translucency, hue variation) — next epic.
- SSAO re-enablement. SSAO is a g-buffer effect, not a post-process in the authored sense; it stays as a scalar setting and remains disabled in the render graph until the Three.js GTAO node is stable. Not blocking for this look.
- 3D LUT file import. Authored lift/gamma/gain + saturation is sufficient for MVP; LUT import can follow later.
- Volumetric fog / height fog with geometry. Flat depth-based fog-tint is the MVP.
- Per-asset shadow opt-out (e.g., a specific mesh that should not cast shadows despite being in a scene where the sun casts). All `PlacedAssetInstance` meshes currently cast shadows by default via the host's `enableShadowsOnObject` pass; per-asset override is a follow-up if authors need it.
- Shadow debug visualization (cascade-color overlay, shadow camera bounds gizmo) — useful for engine debugging but not authored state. Belongs in a dev-only debug HUD card (Plan 027), not on `EnvironmentDefinition`.
- Per-preset shadow defaults. v1 ships identical shadow defaults across every preset and tunes after seeing real reference scenes.
- Workspace restructure. The stack editor lives in the existing Environment pane.

## Architecture rework

### Current lighting flow (before this epic)

```
EnvironmentDefinition (domain)
├── lighting.preset: LightingPreset (enum)
└── lighting.adjustments: { ambientIntensity, keyIntensity, shadowDarkness, warmth }
                    │
                    ▼
runtime-core/src/render/environment-scene.ts  ← has three.js imports (violation)
├── Hardcoded LIGHTING_PRESETS[preset] → { lights[], backgroundColor }
├── shiftWarmth(color, adjustments.warmth)   ← only user-facing authoring lever
├── new THREE.DirectionalLight / HemisphereLight / AmbientLight
└── scene.add(light)
```

Authors cannot rotate the sun. They cannot change its color outside the `warmth` nudge. `shadowDarkness` is a dead write.

### Target lighting flow (after this epic)

```
EnvironmentDefinition (domain)
├── lighting.preset: LightingPreset            (template selector)
├── lighting.sun: SunLight                      (azimuth, elevation, color, intensity, castShadows)
├── lighting.rim: RimLight | null               (optional back-rim)
├── lighting.ambient: AmbientConfig             ({ mode: "sky-driven" | "flat", color?, intensity })
└── atmosphere.fog: FogSettings                 (+ color, + heightFalloff)
                    │
                    ▼
runtime-core/src/environment/  (pure resolution)
├── resolveEnvironmentDefinition()
├── applyLightingPresetTemplate()       ← populates sun/rim/ambient fields from a preset snapshot
└── no three.js — purely data
                    │
                    ▼
render-web/src/environment/  (new)   ← all three.js lives here
├── EnvironmentSceneController (moved from runtime-core)
├── lightFromSunDescriptor() / lightFromRimDescriptor() / skyDrivenAmbientFromSky()
└── buildSkyMaterial()
```

The move from runtime-core to render-web is not a rewrite — it is a **relocation + tightening of the interface** the web host consumes. Runtime-core exports descriptors; render-web turns them into Three.js lights.

### Current post-process flow (before this epic)

```
runtime-core/src/render/graph.ts   ← has three.js imports (violation)
├── scenePass = pass(scene, camera)
├── bloomPass = bloom(sceneColor, 0.4, 0.4, 0.9)   ← hardcoded
├── baseOutputNode = sceneColor.add(bloomPass)
└── pipeline.outputNode = baseOutputNode

EnvironmentDefinition.postProcessShaders: PostProcessShaderBinding[]   ← never read
```

### Target post-process flow (after this epic)

```
EnvironmentDefinition.postProcessShaders: PostProcessShaderBinding[]
  ├── { shaderDefinitionId: ":built-in:color-grade", parameters: {...}, order: 0, enabled: true }
  ├── { shaderDefinitionId: ":built-in:bloom", parameters: {...}, order: 1, enabled: true }
  ├── { shaderDefinitionId: ":built-in:tonemap", parameters: {...}, order: 2, enabled: true }
  └── { shaderDefinitionId: ":built-in:vignette", parameters: {...}, order: 3, enabled: true }
                    │
                    ▼
render-web/src/environment/applyPostProcessStack.ts  (new)
├── resolveEnvironmentWithPostProcessChain()
├── For each enabled binding in order:
│   └── ShaderRuntime.applyShader({ targetKind: "post-process", renderPipeline, previousOutputNode })
└── Sets pipeline.outputNode to the final composed node
```

Each post-process binding composes onto the previous one's output node. The ShaderRuntime's post-process finalizer (already built in Plan 029) produces a `colorNode` from the IR; the runtime host wires them in order. This is exactly the `getBaseOutputNode()` / `setPostProcessOutputNode()` API the shader graph epic left behind.

### Fog has a single runtime authority: the authored `fog-tint` post-process graph

Fog today is `scene.fog = new THREE.FogExp2(color, density)` — a scene-level `THREE.Fog` object consumed internally by every fog-aware material. The naïve "also add a post-process fog-tint" path creates a dual-enforcer: two systems, both computing a visually-similar effect, both reading from the same authored settings, no single source of truth at the render layer. That violates the repo's rule against duplicated runtime-visible behavior.

**Decision:** authored `fog-tint` is the sole runtime realization of fog semantics. `scene.fog` is removed from the render path.

Concretely:

- `EnvironmentDefinition.atmosphere.fog` (the authored `FogSettings`) remains the single **authored** source of truth — authors still think of fog as "an environment property." Nothing changes at the authoring layer conceptually.
- At runtime, `FogSettings` is realized by **exactly one mechanism**: if `fog.enabled` is true, a `:built-in:fog-tint` post-process binding must be present in the stack. Its `color`, `density`, and `heightFalloff` parameters mirror the authored `FogSettings`. The fog inspector UI (Story 8) edits the fog settings directly; the post-process stack editor shows the bound fog-tint entry and can edit its parameters too — both write to the same underlying `FogSettings` fields.
- `runtime-core/src/render/environment-scene.ts` (now in `render-web`) no longer sets `scene.fog`. Materials that previously read `THREE.Fog` uniforms simply don't get them. Post-process depth-based fog composites uniformly across the whole frame instead.
- The migration (Story 1 normalization) auto-inserts a `:built-in:fog-tint` binding into `postProcessShaders` for any environment where `fog.enabled` was true, with parameters derived from `fog.color`, `fog.density`, and `fog.heightFalloff`. Same pattern as the bloom migration in Story 7.
- If a future material needs fog-aware shading at the material level (e.g., a water shader fading into distance), it reads fog color/density via `input.parameter` bindings to the same authored `FogSettings` — the `ShaderRuntime` exposes them as named scene parameters. Still one source of truth; different consumers, same data.

**Trade-off acknowledged:** we lose Three's built-in material-level fog on all existing opaque geometry. In practice this is fine because (a) post-process depth-fog composites uniformly regardless of material, (b) the visible difference is negligible for the target stylized look, and (c) keeping both was exactly the duplicated-behavior trap the user flagged.

## Domain contract changes

All changes land in `packages/domain/src/content-library/index.ts` and are version-gated via `normalizeContentLibrarySnapshot` so existing documents upgrade cleanly.

```typescript
// New descriptor shapes

export interface SunLight {
  azimuthDeg: number;         // 0–360, compass around world Y
  elevationDeg: number;        // -90 to 90, negative = below horizon (moon, night)
  color: number;               // 24-bit RGB
  intensity: number;           // scalar
  castShadows: boolean;
}

export interface RimLight {
  azimuthDeg: number;
  elevationDeg: number;
  color: number;
  intensity: number;
}

export type AmbientMode = "sky-driven" | "flat";

export interface AmbientConfig {
  mode: AmbientMode;
  // Only consumed when mode === "flat". In "sky-driven" mode,
  // ambient derives from atmosphere.sky.topColor / bottomColor.
  color: number;
  intensity: number;
}

// Reworked lighting block
export interface EnvironmentLighting {
  preset: LightingPreset;       // retained as a template selector
  sun: SunLight;                 // required (always on)
  rim: RimLight | null;          // null = no rim light
  ambient: AmbientConfig;
}

// Reworked fog (backward-compatible: old { enabled, density } upgrades)
export interface FogSettings {
  enabled: boolean;
  density: number;
  color: number;                // 24-bit RGB; default derives from preset
  heightFalloff: number;         // 0 = uniform, 1 = strong height falloff
}
```

**Retired fields:**

- `LightingAdjustments.shadowDarkness` — dead in runtime.
- `LightingAdjustments.warmth` — replaced by direct sun color.
- `LightingAdjustments` as a whole type disappears; `ambientIntensity` becomes `ambient.intensity`, `keyIntensity` becomes `sun.intensity`.
- `BloomSettings` and `atmosphere.bloom` — **deleted, not deprecated**. Bloom lives exclusively as a `:built-in:bloom` post-process binding in `postProcessShaders`. Migration in Story 1 moves the old scalar values into a binding's parameters, then drops the field. No parallel scalar copy is retained. Same single-authority rule as fog.

**Preset templates:**

A new `LIGHTING_PRESET_TEMPLATES: Record<LightingPreset, EnvironmentLighting>` constant in domain captures what the hardcoded runtime-core rigs expressed — but now as authored defaults the UI exposes. `applyLightingPresetTemplate(definition, preset)` copies the template into the definition, leaving the author free to tweak.

**Normalization:**

`normalizeContentLibrarySnapshot` upgrades old environments:

- Missing `sun` → derived from old preset rig's primary directional (position → azimuth/elevation).
- Missing `rim` → `null` for default/noon/night, populated for late_afternoon/golden_hour (which already had a secondary cool back-directional in the hardcoded rig).
- Missing `ambient` → `{ mode: "sky-driven", color: 0x888888, intensity: 0.5 }`.
- Missing `fog.color` → derive from `atmosphere.sky.bottomColor` at normalization time.
- Old `warmth`/`keyIntensity`/`ambientIntensity`/`shadowDarkness` → migrated into new fields then dropped.

## Stories

### Story 1: Domain lighting model rework + preset templates

**Goal.** Replace opaque preset+scalars with explicit authored sun/rim/ambient. Preserve existing presets as templates the UI applies.

**Tasks.**

- Add `SunLight`, `RimLight`, `AmbientConfig`, `AmbientMode`, reworked `EnvironmentLighting` types to `content-library/index.ts`.
- Retire `LightingAdjustments`, `shadowDarkness`, `warmth` from domain.
- Define `LIGHTING_PRESET_TEMPLATES: Record<LightingPreset, EnvironmentLighting>` — one template per existing preset. Translate the hardcoded rigs from `runtime-core/src/render/environment-scene.ts:LIGHTING_PRESETS` into authored template form (positions → azimuth/elevation, colors stay as hex).
- Add `applyLightingPresetTemplate(definition, preset): EnvironmentDefinition` helper replacing `applyLightingPresetToEnvironmentDefinition`.
- Extend `FogSettings` with `color` and `heightFalloff`; update `DEFAULT_FOG_SETTINGS` (add one if none exists) and tie default fog color to the preset's sky bottom color.
- Update `createDefaultEnvironmentDefinition` to initialize new fields.
- Update `normalizeContentLibrarySnapshot` with the migration rules above; add a version bump on `identity.version` for ContentLibrary to 2.
- **Fog migration (single-enforcer):** during normalization, if `atmosphere.fog.enabled === true` and no `:built-in:fog-tint` binding exists in `postProcessShaders`, auto-insert one with parameters `{ color: fog.color, density: fog.density, heightFalloff: fog.heightFalloff }`. Subsequent edits to the fog inspector write to the authored `FogSettings` fields; a small helper propagates those writes to the bound fog-tint binding's parameters (both live on the same document; one revision bump covers both). This makes `FogSettings` the authored source and `fog-tint` the sole runtime realization.
- Unit test the migration: a v1 environment with `warmth: 0.3, keyIntensity: 1.0, preset: "golden_hour"` upgrades to the expected sun direction/color/intensity.
- Unit test the fog migration: a v1 environment with `fog.enabled: true, fog.density: 0.008` (and no existing fog-tint binding) upgrades to contain exactly one `:built-in:fog-tint` binding with matching parameters.

**Acceptance.**

- All three `LightingAdjustments`/`warmth` references in the codebase are removed or migrated.
- `normalizeContentLibrarySnapshot` round-trips a v1 document to v2 with no data loss from the authoring intent (colors, intensities, fog density preserved; new fields populated from preset).
- `applyLightingPresetTemplate(def, "golden_hour")` produces a definition whose sun is in the south-west at ~25° elevation, warm-cream color, ~0.9 intensity, and whose rim is a cool fill in the north-east (matching the old hardcoded `golden_hour` rig's secondary directional).
- Every v2 environment with `fog.enabled: true` has exactly one `:built-in:fog-tint` binding whose parameters mirror the authored `FogSettings`. Editing the fog inspector keeps them in sync; the post-process stack UI shows the bound fog-tint entry as such.

---

### Story 2: Relocate environment Three.js code from runtime-core to render-web

**Goal.** Fix the pre-existing layer violation. Runtime-core keeps domain resolution + descriptor shapes; all Three.js lives in render-web.

**Tasks.**

- Create `packages/render-web/src/environment/` with:
  - `EnvironmentSceneController.ts` — moved from `runtime-core/src/render/environment-scene.ts`, accepts `EnvironmentDefinition` and creates Three.js lights from the new `SunLight`/`RimLight`/`AmbientConfig` descriptors (not from a hidden preset rig).
  - `skyMaterial.ts` — moved `buildSkyMaterial()` here.
  - `index.ts` barrel.
- Delete `runtime-core/src/render/environment-scene.ts` (or reduce it to pure-data helpers if anything there survives the split).
- **Remove `scene.fog` assignment from the relocated `EnvironmentSceneController`.** Fog is now realized exclusively through the `:built-in:fog-tint` post-process binding (wired in Story 4, migration auto-inserted in Story 1). No `THREE.FogExp2` or `THREE.Fog` is constructed anywhere in the render path. This is the concrete removal of the pre-existing dual-enforcer.
- Add a pure `computeSkyDrivenAmbient(sky: SkySettings): { color: number; intensity: number }` in runtime-core (no Three.js) that computes a hemisphere-style ambient from the sky gradient. `EnvironmentSceneController` in render-web calls this when `ambient.mode === "sky-driven"`.
- Update `targets/web/src/runtimeHost.ts` to import `EnvironmentSceneController` from `@sugarmagic/render-web` instead of `@sugarmagic/runtime-core`.
- Update `apps/studio/src/viewport/authoringViewport.ts` similarly.
- Update `tooling/check-package-boundaries.mjs` to forbid `three`, `three/webgpu`, `three/tsl` imports under `packages/runtime-core/src/environment/**` and `packages/runtime-core/src/render/**`. **Scoped narrowly on purpose:** `player/`, `npc/`, `item/`, and `landscape/` all import `three` today and cleaning those up is explicitly out of scope for this epic — they are a separate follow-up. The guardrail here only covers the modules this epic actually relocates.

**Acceptance.**

- `grep -rn "from \"three" packages/runtime-core/src/environment/ packages/runtime-core/src/render/environment-scene.ts` returns zero matches. (`render/graph.ts` is addressed in Story 7; `render/pipeline.ts` and other runtime-core modules are explicitly out of scope.)
- `tooling/check-package-boundaries.mjs` run passes for the scoped directories, and intentionally fails if a `three` import is reintroduced into the environment module. (A parallel guardrail for the remaining runtime-core modules is tracked as a separate follow-up ticket, not blocked on this epic.)
- Existing environment runtime tests (`packages/testing/src/environment-runtime.test.ts`, renamed to `render-web-environment.test.ts` in Story 10) still pass after the relocation.
- `grep -rn "scene\.fog\|FogExp2\|new THREE\.Fog" packages/render-web/src/ targets/web/src/ packages/runtime-core/src/` returns zero matches — fog has exactly one runtime enforcer, the `fog-tint` post-process binding.
- Studio authoring viewport and published web target both render environments correctly (manual smoke test: switch presets, see the scene change, including fog tint).

---

### Story 3: First-class sun shadow authoring with WebGPU cascaded shadows

**Goal.** Replace the current "single fixed shadow map with hardcoded frustum" rig with authored shadow controls on `EnvironmentDefinition.lighting.sun.shadows`, realized by a single `CSMShadowNode`-based path in `EnvironmentSceneController`. Same path in Studio and runtime — the WebRenderHost consolidation pattern extended to shadows.

**Motivation.** The current setup (hardcoded ±50 world-unit frustum, 2K single shadow map, PCF-soft) produces acceptable shadows on small authored scenes but breaks down as soon as the scene gets bigger than a handful of buildings: near-camera detail goes mushy, far-camera shadows disappear, artifacts appear on moving viewpoints. For the stylized-outdoor target look, cascaded shadows are the standard solution. Three's WebGPU stack ships `CSMShadowNode` specifically for this.

Equally important: today's shadow parameters are literally invisible to authors — the frustum size, bias, and softness are magic numbers in `createDirectionalLight()`. Every time we want to tweak them we're editing engine code. That's exactly the "hidden rig" problem Story 1 fixed for lighting. Shadows deserve the same first-class authoring treatment.

**Authored domain shape.** Add `shadows` to the existing `SunLight` interface in `packages/domain/src/content-library/index.ts`:

```typescript
export type ShadowQuality = "low" | "medium" | "high" | "ultra";

export interface SunShadowSettings {
  enabled: boolean;
  quality: ShadowQuality;
  /** World-space distance the shadow cascades cover from the camera. */
  distance: number;
  /** 0..1 — multiplier on shadow darkness (alpha of the shadow region). */
  strength: number;
  /** 0..1 — PCF softness factor; drives sample radius within the quality preset. */
  softness: number;
  /** Shadow acne prevention. Small negative values (~-0.0001) are typical. */
  bias: number;
  /** Normal-offset bias; typical range 0.01..0.1. */
  normalBias: number;
}

export interface SunLight {
  // ...existing fields...
  shadows: SunShadowSettings;
}
```

Intentionally **not** on the authored shape (see Out of scope):

- `technique` — one implementation, no author-facing toggle.
- `cascades.count` / `cascades.mode` / `cascades.fade` / `cascades.margin` — driven by the quality preset internally.
- `shadowDebug` — belongs in the debug HUD card, not in saved project data.

**Quality preset table.** Concrete numbers, no engineer's-choice-on-the-day:

| Quality | Cascade count | Map size per cascade | PCF samples | Typical GPU cost vs. base (no shadows) |
|---|---|---|---|---|
| low | 1 | 1024 | 1 (hard) | ~1.3× |
| medium | 2 | 2048 | 4 | ~2× |
| high | 3 | 2048 | 9 | ~3.5× |
| ultra | 4 | 4096 | 16 | ~6–8× |

`low` is appropriate for mid-range laptops or web builds targeting broad hardware. `high` is the recommended default for Studio. `ultra` is for screenshots / hero shots only.

**Defaults.** Until per-preset shadow tuning lands, every lighting preset ships the same shadow defaults:

```typescript
const DEFAULT_SUN_SHADOWS: SunShadowSettings = {
  enabled: true,
  quality: "high",
  distance: 80,
  strength: 1,
  softness: 0.5,
  bias: -0.0001,
  normalBias: 0.05
};
```

**Tasks.**

- Extend `SunLight` in domain with `shadows: SunShadowSettings`. Update the five preset templates in `LIGHTING_PRESET_TEMPLATES` to include `shadows: DEFAULT_SUN_SHADOWS`. Update `normalizeContentLibrarySnapshot` to fill in `shadows` on any upgraded v2 document that's missing it (defaults to `DEFAULT_SUN_SHADOWS`).
- Rework `EnvironmentSceneController.createDirectionalLight()` in `packages/render-web/src/environment/`:
  - When `shadows.enabled === false`, the sun is a plain `DirectionalLight` with `castShadow = false`.
  - When enabled, attach a `CSMShadowNode` to the sun with cascade count + map size + PCF samples driven by the quality preset. Distance controls the overall cascade coverage; bias/normalBias wire through; strength and softness drive the node's exposed uniforms.
  - The CSM setup is **created once per quality change** and cached on the controller; distance/strength/softness/bias/normalBias edits update uniforms in place (cheap), same pattern as the bloom node cache in `ShaderRuntime`.
- Add a pure runtime-core helper `expandShadowQuality(quality)` → `{ cascadeCount, mapSize, pcfSamples }` so the mapping lives in one data-driven place and can be unit-tested without Three.js imports. `EnvironmentSceneController` calls this to parameterize the CSM setup.
- Ensure `WebRenderHost.enableShadowsOnObject(root)` continues to be the single authority for marking mesh geometry shadow-participating. Document (in the host file header or an adjacent readme) that all `PlacedAssetInstance` meshes cast shadows by default — per-asset opt-out is not part of this story but is a reasonable future addition.
- Performance guardrail: the ShaderRuntime already notes TSL cache behavior; add an equivalent note on the shadow controller explaining that quality changes trigger a full CSM rebuild while other shadow parameters update uniforms in place. This avoids re-learning the pattern next time someone adds a shadow knob.
- Authoring UI in the sun/lighting inspector (part of Story 8's scope, listed here for completeness):
  - Primary controls: Cast Shadows toggle, Quality select, Distance / Strength / Softness sliders.
  - **Advanced section (collapsed by default):** Bias / Normal Bias sliders.
  - No technique picker, no cascade count, no debug viz.
- Integration test in `packages/testing/src/render-web-environment.test.ts` (or the renamed equivalent from Story 10): an environment with `shadows.enabled: true, quality: "medium"` produces a shadow-casting directional light with the expected cascade count. Disabling shadows removes the shadow configuration.

**Acceptance.**

- A preset-default environment casts visible soft shadows from the sun on geometry in both Studio and runtime preview, identical between the two hosts.
- Changing Quality from `medium` to `high` in the inspector visibly improves shadow resolution on close-camera detail; reverting restores the cheaper look. Done live, no reload.
- Changing Distance, Strength, Softness in the inspector live-updates without any visible stutter from shader recompilation — verifies the uniform-update path, not the rebuild path.
- Changing Quality triggers one detectable rebuild (a small frame hitch is acceptable). Distance/Strength/Softness edits do NOT trigger a rebuild.
- The hardcoded 2048/±50/PCFSoft configuration is removed from `createDirectionalLight`. Sun shadow behavior is now entirely driven by the authored `SunShadowSettings`.
- No shadow authoring state leaks into editor-only surfaces: `EnvironmentDefinition` is still the single source of truth, no `debugShadowSettings` or similar added elsewhere.
- Unit test for `expandShadowQuality` covers all four presets.
- Documentation note on `EnvironmentSceneController` explicitly states the quality-change-rebuilds / other-edits-update-uniforms contract.

**What this does NOT solve.** Worth stating up front so nobody expects shadows alone to produce the reference look:

- Shadows without good sky ambient still look graphic and flat. Sky-driven ambient (already in Story 1) is a necessary counterpart.
- Shadows without IBL / environment map sampling don't get the "lit by the world" feel Blender's default produces. IBL is a separate concern — not this epic.
- Shadows won't rescue a scene where bloom is cranked (dominant colors smear across shadow regions) or where tonemap exposure is wrong (crushed blacks eat shadow detail). These are tuning problems at the post-process layer.

**What this does solve.** Stable, tunable, authored sun shadows — the foundation every other stylized-outdoor technique stacks on top of.

---

### Story 4: Wire authored post-process stack through ShaderRuntime

**Goal.** `EnvironmentDefinition.postProcessShaders` actually runs at runtime, composed through the ShaderRuntime's post-process finalizer in order.

**Tasks.**

- In `packages/render-web/src/environment/applyPostProcessStack.ts` (new), implement a function that:
  - Takes the resolved post-process chain (already sorted + enabled-filtered by `resolveEnvironmentWithPostProcessChain`).
  - For each binding, calls `ShaderRuntime.applyShader({ targetKind: "post-process", renderPipeline, previousOutputNode })`.
  - Passes `previousOutputNode` from one binding to the next as the input so they compose.
  - After the last binding, calls `renderPipeline.setOutputNode(finalNode)` via the existing `setPostProcessOutputNode()` API on `RuntimeRenderPipeline`.
  - If the chain is empty, falls back to `getBaseOutputNode()` (the scene pass). Bloom is no longer hardcoded — see Story 7.
- Verify the Plan 029 post-process finalizer accepts `previousOutputNode` as input. If it doesn't, extend the `ShaderApplyTarget` discriminated union and the post-process finalizer to thread a "previous" input node. This is a small API tightening, not a rewrite.
- Hook `applyPostProcessStack` into `runtimeHost.ts` so it fires on every environment apply (post-process chain changes when the environment changes, and when an authored binding is added/removed/reordered — revision-based invalidation handles the latter).
- Expose the ShaderRuntime's compile diagnostics for post-process bindings to the debug HUD (Plan 027 HUD card), so authoring a broken post-process graph surfaces visibly.

**Acceptance.**

- An empty post-process chain renders the scene identically to pre-epic minus bloom (which moves into the stack in Story 7).
- A post-process chain with two bindings (color-grade then vignette) renders the vignette on top of the graded output, not on the ungraded scene.
- Reordering bindings via a command triggers re-application on next apply (revision counter advances → ShaderRuntime cache key changes → re-finalization).
- Disabling a binding removes it from the composed chain without recompilation (pure filter on apply).

---

### Story 5: Extend shader node registry with capabilities required by post-process graphs

**Goal.** Honestly close the gap between what Plan 029's node registry ships and what the built-in post-process graphs in Story 6 need. Every node used by a built-in graph must exist in the registry, be validated by the compiler, and be realized by the post-process finalizer. No hand-waving.

**What Plan 029 already ships that these graphs can use as-is:**

- Inputs: `input.scene-color`, `input.scene-depth`, `input.screen-uv`, `input.parameter`, `input.constant-color`, `input.uv`, `input.world-position`, `input.camera-position`, `input.view-direction`, `input.time`
- Math: `math.add`, `math.subtract`, `math.multiply`, `math.divide`, `math.sin`, `math.cos`, `math.abs`, `math.clamp`, `math.lerp` (mix), `math.dot`, `math.normalize`, `math.length`, `math.combine-vector`, `math.split-vector`
- Output: `output.post-process`
- Helper pattern: `effect.*` engine-owned helper nodes (precedent: `effect.wind-sway`)

**New nodes required, added in this story:**

Math / scalar operations (all take + produce `float` or `float3` with coercion matching Plan 029's rules):

- `math.pow` — base, exponent → base^exponent. Needed by color-grade (gamma correction) and vignette (falloff shaping).
- `math.exp` — x → e^x. Needed by fog-tint exponential formula.
- `math.min`, `math.max` — standard reducers.
- `math.saturate` — clamp to [0, 1]. Convenience over `math.clamp` with literal bounds.
- `math.smoothstep` — edge0, edge1, x → smoothstep. Needed by vignette edge falloff.
- `math.distance` — a, b → |a − b|. Needed by vignette radial mask. (Alternative: express as `length(subtract(a, b))` using existing nodes; shipping a dedicated node is cleaner and matches author expectations.)

Color convenience:

- `color.luminance` — rgb → float. Standard Rec. 709 weights. Needed by color-grade saturation (mix rgb toward grayscale). Technically expressible via `dot(rgb, (0.2126, 0.7152, 0.0722))` with existing nodes, but ugly enough that a dedicated node is worth it.

Engine-owned helper nodes (following `effect.wind-sway` precedent — defined in domain registry, realized by the post-process finalizer in render-web):

- `effect.bloom-pass` — wraps Three's TSL `bloom()` helper. Parameters: `strength: float, radius: float, threshold: float`. Output: `float3` bloom contribution to composite with scene color.
- `effect.tonemap-aces` — wraps the Narkowicz ACES fit. Parameter: `exposure: float`. Input: `float3` pre-exposure color. Output: `float3` tonemapped color.
- `effect.tonemap-reinhard` — wraps `c / (1 + c)`. Parameter: `exposure: float`. Same input/output shape as `effect.tonemap-aces`. (Two separate helpers instead of one enum-branching node — see open question 3 in this epic: authors pick a tonemap once, so an enum branch adds graph complexity and a conditional-branch node type the registry doesn't have. Two graphs is cleaner.)

**Tasks.**

- Add the eight new `math.*` / `color.*` node definitions to `SHADER_NODE_DEFINITIONS` in `packages/domain/src/shader-graph/index.ts` with correct port shapes, type signatures, and coercion rules matching existing math node conventions.
- Add the three `effect.bloom-pass` / `effect.tonemap-aces` / `effect.tonemap-reinhard` helper node definitions to the same registry.
- Extend the post-process finalizer in `packages/render-web/src/` (the file Plan 029 shipped) to realize each new node type: math/color nodes map directly to TSL ops (`pow`, `exp`, `min`, `max`, `saturate`, `smoothstep`, `distance`, `luminance`); helper nodes call the corresponding Three TSL helpers or inline the fitted formulas.
- Extend `packages/testing/src/shader-runtime-contract.test.ts` with a compile-and-finalize unit test per new node type (11 new tests, one per node). Each constructs a minimal graph using the node and asserts the IR and finalized TSL shape.

**Acceptance.**

- All 11 new node definitions appear in the registry, show up in the Render workspace node palette, and pass validation.
- The post-process finalizer in render-web realizes each new node correctly (verified by the per-node tests).
- No node Story 6's built-in graphs depend on remains undefined.

---

### Story 6: Built-in post-process shader graphs

**Goal.** Ship the six named built-in post-process graphs using the registry from Story 5 so authors have a real starting library. (Tonemap splits into two — ACES and Reinhard — as separate graphs.)

**Tasks.**

Each graph is a factory following the Plan 029 `createDefaultFoliageWindShaderGraph` convention, living in `packages/domain/src/shader-graph/` and registered by `content-library/index.ts:createBuiltInShaderDefinitions`.

All graphs consume `input.scene-color` as their primary input (from the previous post-process stage's output) and write to `output.post-process`.

- **`createDefaultColorGradePostProcessShaderGraph`**. Parameters: `{ lift: color3, gamma: color3, gain: color3, saturation: float, contrast: float }`. Graph: `c = sceneColor * gain + lift` → `c = pow(c, 1 / gamma)` (using `math.pow` and `math.divide`) → `grey = color.luminance(c)` broadcast to rgb → `c = lerp(grey, c, saturation)` → `c = lerp(vec3(0.5), c, contrast)`.
- **`createDefaultTonemapAcesPostProcessShaderGraph`**. Parameter: `{ exposure: float }`. Graph: `c = sceneColor * exposure` → `effect.tonemap-aces(c)` → output. (Formula lives inside the helper node, not in the graph.)
- **`createDefaultTonemapReinhardPostProcessShaderGraph`**. Parameter: `{ exposure: float }`. Graph: `c = sceneColor * exposure` → `effect.tonemap-reinhard(c)` → output.
- **`createDefaultVignettePostProcessShaderGraph`**. Parameters: `{ color: color3, intensity: float, softness: float, radius: float }`. Graph consumes `input.screen-uv`. Compute `d = math.distance(uv, vec2(0.5))` → `mask = math.smoothstep(radius - softness, radius, d) * intensity` (using `math.smoothstep`, `math.subtract`, `math.multiply`) → `c = lerp(sceneColor, color, mask)`.
- **`createDefaultFogTintPostProcessShaderGraph`**. Parameters: `{ color: color3, density: float, heightFalloff: float }`. Graph consumes `input.scene-color` and `input.scene-depth`. Compute `f = 1 - math.exp(-depth * density)` (using `math.exp`, `math.multiply`, `math.subtract` with a constant-1 input) → `c = lerp(sceneColor, color, f)`. `heightFalloff` parameter is plumbed but treated as a world-Y modulation in v1; if that can't be computed in screen-space post-process cleanly, fall back to ignoring it and document the limitation.
- **`createDefaultBloomPostProcessShaderGraph`**. Parameters: `{ strength: float, radius: float, threshold: float }`. Graph: `sceneColor` → `effect.bloom-pass(sceneColor, strength, radius, threshold)` → `c = sceneColor + bloom`. (The bloom compute lives inside the helper; the graph just drives its parameters and composites.)

All six are registered in `createBuiltInShaderDefinitions()` with IDs like `${projectId}:shader:color-grade`, `${projectId}:shader:tonemap-aces`, `${projectId}:shader:tonemap-reinhard`, etc. They appear in the Render workspace and the Environment post-process add-menu.

Each factory requires:

- A header comment stating what the graph does and what it consumes/produces.
- Parameter definitions with sensible defaults (e.g., ACES exposure defaults to 1.0, vignette softness to 0.3, fog density matches current preset defaults).
- A deterministic scheme for node positions so repeated invocations produce byte-identical JSON (matches Plan 029 foliage-wind default).

**Acceptance.**

- Six built-in post-process shader graphs exist, each with a header comment and factory function.
- Each compiles cleanly through the Plan 029 semantic compiler (no diagnostics).
- Each finalizes to a valid `colorNode` via the post-process finalizer in render-web.
- `packages/testing/src/shader-runtime-contract.test.ts` is extended with one compile-and-finalize test per graph (six new tests on top of the 11 per-node tests from Story 5).
- The Render workspace lists all six under built-in shaders.
- The Environment post-process add-menu offers all six.

---

### Story 7: Remove hardcoded bloom and delete `BloomSettings` from domain

**Goal.** `runtime-core/src/render/graph.ts` stops owning bloom; the `bloom` built-in graph in Story 6 replaces it. This also clears the three.js imports from that file — second half of the Story 2 layer fix. **Critically**, this is also where `BloomSettings` and `atmosphere.bloom` disappear from the domain entirely: bloom has exactly one authored home, the post-process binding, with no parallel scalar copy. No dual-truth, same rule as fog.

**Why delete instead of deprecate.** Unlike fog, bloom is not a world-state concept — no gameplay reads "is there bloom." Bloom is a visual post effect that happened to live in `atmosphere.bloom` only because Sugarbuilder had nowhere else to put it. Now that a real post-process stack exists, the binding *is* the authored truth. Keeping `BloomSettings` around as a "cosmetic scalar" would exactly reproduce the duplicated-runtime-visible-behavior trap the repo forbids.

**Tasks.**

- Delete the hardcoded `bloom()` pass and `sceneColor.add(bloomPass)` composition from `runtime-core/src/render/graph.ts`.
- `getBaseOutputNode()` now returns the raw `scenePass.getTextureNode("output")` (no bloom added).
- Move the Three.js-dependent parts of the render graph (`RenderPipeline`, `scenePass`, `pass()` construction) into `packages/render-web/src/render/`. Runtime-core keeps only the pipeline-shaped interface consumed by the host.
- **Delete `BloomSettings` from `packages/domain/src/content-library/index.ts` and `atmosphere.bloom` from `EnvironmentDefinition`.** Remove `DEFAULT_BLOOM_SETTINGS` and any references in `createDefaultEnvironmentDefinition`, the `applyBloom` helper in `render/graph.ts`, and anywhere else that imports `BloomSettings`.
- **Migration (part of Story 1's normalization, restated here for completeness):** when `normalizeContentLibrarySnapshot` encounters a v1 document with `atmosphere.bloom.enabled === true` and no existing `:built-in:bloom` binding in `postProcessShaders`, it auto-inserts one with parameters `{ strength: old.strength, radius: old.radius, threshold: old.threshold }` and an `order` placed after any migrated fog-tint. The `atmosphere.bloom` field is then dropped from the upgraded document — gone, not deprecated, not retained. If the old document had `atmosphere.bloom.enabled === false`, no binding is added and the field is dropped.
- Add a migration unit test: v1 doc with `atmosphere.bloom.enabled: true, strength: 0.6` upgrades to a v2 doc containing exactly one `:built-in:bloom` binding with `strength: 0.6` and no `atmosphere.bloom` field.

**Acceptance.**

- `packages/runtime-core/src/render/graph.ts` and `packages/runtime-core/src/render/environment-scene.ts` import nothing from `three`, `three/webgpu`, or `three/tsl`. (`render/pipeline.ts` still consumes typed options from `three` / `three/webgpu` as a thin factory signature; retypeing it behind opaque host-provided handles is tracked as a separate follow-up, not blocking this epic.)
- An environment with `atmosphere.bloom.enabled = true` in a pre-upgrade document comes out post-migration with an equivalent authored bloom binding in the post-process stack, and renders identically. The `atmosphere.bloom` field is gone from the upgraded document.
- An environment with an empty post-process stack renders the raw scene (no bloom) — confirming bloom is fully off the hardcoded path.
- `grep -rn "BloomSettings\|atmosphere\.bloom\|DEFAULT_BLOOM_SETTINGS" packages/ targets/` returns zero matches outside of the migration path itself — bloom has exactly one authored home.

---

### Story 8: Lighting authoring UI in Environment pane

**Goal.** Authors can rotate the sun, pick colors, and tweak lighting live.

**Tasks.**

- In `packages/workspaces/src/build/environment/`, add:
  - **Sun inspector**: azimuth slider (0–360°), elevation slider (-90 to 90°), color picker, intensity slider, cast-shadows toggle. Inline 2D compass preview showing sun direction dot on a circle.
  - **Sun > Shadows subsection** (driven by Story 3's authored `shadows` block):
    - Primary controls: Quality select (Low / Medium / High / Ultra), Distance slider, Strength slider, Softness slider.
    - Advanced section (collapsed by default): Bias slider, Normal Bias slider.
    - The Cast Shadows toggle at the top of the Sun inspector is the single authority for `shadows.enabled`. When off, the subsection is greyed out.
    - No technique picker, no cascade count, no debug viz.
  - **Rim inspector**: enable toggle. When enabled, same four controls as sun (azimuth/elevation/color/intensity, no shadows).
  - **Ambient inspector**: mode dropdown (`sky-driven` | `flat`). When `flat`, color picker + intensity slider.
  - **Fog inspector**: color picker (new), density slider, height-falloff slider (new).
  - **Preset selector**: existing dropdown stays; selecting a preset calls `applyLightingPresetTemplate` which populates the fields above. A small "reset to preset defaults" button under the preset dropdown.
- Each control dispatches through the **existing `UpdateEnvironmentDefinitionCommand`** (already defined in `packages/domain/src/commands/index.ts:208`). No new command types are introduced for the lighting UI. Every slider/picker/toggle builds a new `EnvironmentDefinition` (structurally cloned with the changed field) and dispatches a single `UpdateEnvironmentDefinitionCommand` — the same pattern currently used for the preset dropdown and the existing scalar adjustments. This keeps the command family extended, not renamed.
- If undo granularity becomes a usability issue (single slider drag = one whole-definition write = one undo entry), a future follow-up can split `UpdateEnvironmentDefinitionCommand` into field-scoped commands (`UpdateEnvironmentSunCommand`, etc.). Not in scope for this epic.
- Live preview: every edit triggers `EnvironmentSceneController.apply()` via the revision-counter path. Authoring viewport updates instantly.

**Acceptance.**

- Rotating the sun azimuth visibly rotates cast shadows in the authoring viewport.
- Switching ambient mode from `sky-driven` to `flat` visibly changes ambient fill color.
- Changing fog color tints the distance haze.
- Switching shadow Quality visibly changes shadow sharpness; Distance / Strength / Softness live-update without a stutter.
- Undo/redo round-trips all edits (including shadow-subsection edits).
- Selecting a different preset populates fields to the preset template and is itself undoable.

---

### Story 9: Post-process stack editor in Environment pane

**Goal.** Authors can stack, reorder, enable, and tune post-process bindings with live preview.

**Tasks.**

- In `packages/workspaces/src/build/environment/` (or move to `packages/workspaces/src/render/` — see open question), add a **PostProcessStackEditor** component:
  - Ordered list of current bindings. Each row shows: drag handle, binding name (resolved via `shaderDefinition.metadata.displayName`), enable toggle, expand-to-edit-parameters caret, remove button.
  - Drag-reorder updates `order` field on all bindings and dispatches a reorder command.
  - "Add post-process" button opens a menu of available `targetKind: "post-process"` shader definitions from `contentLibrary.shaderDefinitions`. Selecting one appends a binding with default parameter values.
  - Expanding a row shows parameter editors matching the shader's parameter definitions (reuse the parameter-inspector component Plan 029 built for the Render workspace, or extract a shared one).
- Commands: extend the existing post-process command family shipped by Plan 029, do not rename. Specifically, dispatch `AddPostProcessShaderCommand`, `RemovePostProcessShaderCommand`, `UpdatePostProcessShaderOrderCommand`, `UpdatePostProcessShaderParameterCommand`, and `TogglePostProcessShaderCommand` — all already defined in `packages/domain/src/commands/index.ts` and handled by `packages/domain/src/authoring-session/index.ts`. No new command types are needed for this story.
- Live preview: changes trigger environment re-apply (revision counter).

**Acceptance.**

- Adding `color-grade`, `bloom`, `tonemap`, `vignette` in that order produces visible cumulative color-grade → bloom bleed → tonemap compression → corner vignette on the authoring viewport.
- Dragging `bloom` before `color-grade` changes the composition order and the visible result.
- Disabling a binding removes its effect immediately.
- Editing a parameter (e.g., vignette `intensity`) updates the viewport live.
- Undo/redo round-trips all of the above.

---

### Story 10: Integration tests

**Goal.** Lock in the end-to-end contract so the authored lighting + post-process stack survives future refactors.

**Test ownership rule.** `packages/testing/` is the cross-package integration home — it already depends on `@sugarmagic/domain`, `@sugarmagic/runtime-core`, `@sugarmagic/render-web`, and `three`. Within that package, this epic enforces an explicit split by what each test actually touches:

| Test file | What it imports | What it asserts |
|---|---|---|
| `environment-contract.test.ts` (**new**) | `@sugarmagic/domain`, `@sugarmagic/runtime-core` only. **Not** `three`, **not** `@sugarmagic/render-web`. | Pure runtime-core resolution and domain-shape invariants: `resolveEnvironmentWithPostProcessChain` sort/filter, `computeSkyDrivenAmbient` math, `applyLightingPresetTemplate` correctness. |
| `environment-migration.test.ts` (**new**) | `@sugarmagic/domain` only. | `normalizeContentLibrarySnapshot` upgrade paths for lighting rework, fog-tint auto-insertion, bloom binding auto-insertion + `atmosphere.bloom` removal. |
| `render-web-environment.test.ts` (**renamed from `environment-runtime.test.ts`**) | `@sugarmagic/render-web` + `three` + domain. | Three.js-object-level assertions: `EnvironmentSceneController` produces a `THREE.DirectionalLight` with the expected world-space direction from a given `SunLight`, sky mesh built as expected, `scene.fog` is never assigned, and `applyPostProcessStack` invokes `ShaderRuntime.applyShader` in order. |
| `shader-runtime-contract.test.ts` (**existing, extended**) | `@sugarmagic/domain`, `@sugarmagic/render-web`. | Per-node and per-graph compile-and-finalize for the Story 5 and Story 6 additions. |

The rule: **if a test imports `three` or `@sugarmagic/render-web`, it lives in `render-web-environment.test.ts` or `shader-runtime-contract.test.ts`, not in a contract/migration file.** This keeps runtime-core contract tests executable and reviewable without a Three.js mental model.

**Tasks.**

- Rename `packages/testing/src/environment-runtime.test.ts` → `packages/testing/src/render-web-environment.test.ts`. Update its imports to pull `EnvironmentSceneController` from `@sugarmagic/render-web` (not `@sugarmagic/runtime-core`). Add:
  - A definition with an authored sun at azimuth 270° elevation 20°; assert the `THREE.DirectionalLight` produced by `EnvironmentSceneController` has the expected world-space direction vector (within tolerance).
  - A definition with a two-binding post-process chain (`color-grade` + `vignette`); assert `applyPostProcessStack` invokes `ShaderRuntime.applyShader` twice in order, and that `pipeline.outputNode` is the vignette's output node.
  - A definition with an enabled binding + a disabled binding; assert only the enabled one is applied.
  - A definition with `atmosphere.fog.enabled: true` and its auto-inserted `:built-in:fog-tint` binding; assert `scene.fog` is null and the post stack applied the fog-tint binding. (Enforces the single-authority decision.)
  - A definition with `shadows.enabled: true, quality: "medium"`; assert the sun's attached `CSMShadowNode` has the expected cascade count from `expandShadowQuality("medium")`. A second pass with `shadows.enabled: false` asserts no shadow setup is attached.
- Create `packages/testing/src/environment-contract.test.ts` (pure, no Three.js imports):
  - `resolveEnvironmentWithPostProcessChain` sorts by `order` and filters by `enabled`.
  - `computeSkyDrivenAmbient` returns a color between the sky's top and bottom colors (assert approximate HSL midpoint for a representative sky).
  - `applyLightingPresetTemplate(def, "golden_hour")` populates sun / rim / ambient to the expected template values.
  - `expandShadowQuality("low"|"medium"|"high"|"ultra")` returns the table values from Story 3. One case per quality preset.
- Create `packages/testing/src/environment-migration.test.ts` (pure, domain only):
  - v1 environment with `warmth: 0.3, keyIntensity: 1.0, preset: "golden_hour"` → v2 with explicit sun color/intensity and no `LightingAdjustments`.
  - v1 environment with `fog.enabled: true, fog.density: 0.008` and no fog-tint binding → v2 with exactly one `:built-in:fog-tint` binding whose parameters mirror the fog settings.
  - v1 environment with `atmosphere.bloom.enabled: true, strength: 0.6` → v2 with exactly one `:built-in:bloom` binding and no `atmosphere.bloom` field on the document.
  - v2 environment missing `lighting.sun.shadows` → normalized v2 fills in `DEFAULT_SUN_SHADOWS`.
- Extend `packages/testing/src/shader-runtime-contract.test.ts`:
  - Per-node compile-and-finalize tests for the 11 new nodes from Story 5.
  - Per-graph compile-and-finalize tests for the six new built-in post-process graphs from Story 6.

**Acceptance.**

- All four test files exist at the paths above and pass.
- `grep -n "from \"three\\|from \"@sugarmagic/render-web" packages/testing/src/environment-contract.test.ts packages/testing/src/environment-migration.test.ts` returns zero matches — the contract and migration tests genuinely isolate pure-layer behavior.
- Previously-existing environment tests continue to pass after the rename.
- Test suite runs in under the existing CI budget.

---

## Failure modes and guardrails

- **Broken authored post-process graph.** If a binding fails to compile, the ShaderRuntime surfaces a diagnostic; the stack editor shows an inline error on that row; the renderer falls back to skipping that binding (treats it as disabled). Other bindings still compose. Never crash the frame.
- **Sun below the horizon.** Elevation of −90 to 0 is allowed (night scenes). Three.js directional light direction still computes correctly from spherical coordinates. No special-case needed.
- **Rim light duplicating sun.** The UI defaults rim to the opposite hemisphere from the sun (azimuth + 180°, elevation reflected) when it's first enabled, so authors don't accidentally author a second sun.
- **Migration accidentally losing author intent.** The migration rule for `warmth` is documented and tested: positive warmth shifts sun color warm, negative shifts cool. If this turns out to produce visibly different results on existing projects, the epic's acceptance gate includes a manual visual diff on the test scene before the v1→v2 auto-migration runs in the user's main project.
- **Live-edit thrashing.** Same revision-based cache invalidation from Plan 029 applies — parameter-only edits do not recompile, just uniform-update. Only structural changes (add/remove/reorder bindings) bump the revision and trigger re-finalization.
- **Layer-violation regression.** `tooling/check-package-boundaries.mjs` gains a hard check that forbids `three`, `three/webgpu`, `three/tsl` under `packages/runtime-core/src/environment/**` and under the specific `render/` files this epic relocates (`render/graph.ts`, `render/environment-scene.ts`). CI fails on regression within that scope. A broader runtime-core-wide check is desirable but requires relocating player/NPC/item/landscape/pipeline first — tracked as a separate follow-up.
- **Shadow quality thrash.** Changing `shadows.quality` triggers a CSM rebuild. If an author drags the quality slider rapidly, we could thrash. Mitigation: quality is a discrete select (not a slider), so this is a user-gesture-bounded problem — at most a handful of rebuilds per authoring session. Distance/Strength/Softness remain cheap uniform updates by design.
- **Shadow-over-fog interaction.** With both shadows and fog-tint active, the shadow-darkened regions of geometry may be re-tinted by the fog post-process and look muddy. Acceptable baseline behavior; if it becomes a real problem, the fix is in the fog-tint graph (modulate fog contribution by view-space distance, not luminance), not in the shadow system. Flagged here so "muddy shadows in fog" isn't mis-diagnosed as a shadow bug.

## Open questions

1. **Does the post-process stack editor live in Build > Environment or Render?** Today, environment authoring is under Build. The Render workspace (Plan 029) is a natural home for shader-graph-adjacent UI. Recommend: keep the stack editor in Environment (because it's environment-specific state), but add a cross-link button ("Edit this shader") that jumps to the Render workspace for editing the graph itself. This preserves the "environment = mood authoring" mental model while leveraging the Render workspace for graph internals.
2. **Does `EnvironmentDefinition` directly own `postProcessShaders`, or is the stack itself a separate authored document?** Current choice: directly owned (already the case today). An alternative is to make the stack a reusable `PostProcessStackDefinition` in the content library that environments reference. Recommend: keep inline for now; promote to standalone only if authors start reusing stacks across environments.
3. **ACES vs Reinhard as default tonemap.** ACES gives the "Unreal look" most reliably; Reinhard is cheaper and more neutral. Recommend: ACES default, document the trade-off.
4. ~~**Fog-tint vs scene fog coexistence.**~~ **Resolved.** See "Fog has a single runtime authority" in the Architecture rework section. Authored `fog-tint` is the sole runtime enforcer; `scene.fog` is removed from the render path. Dual-enforcer pattern rejected.
5. **Where does the sky gradient live?** `SkySettings` stays as-is on `EnvironmentDefinition.atmosphere.sky`. `computeSkyDrivenAmbient()` reads from it. No changes.
6. **Default shadow quality.** Proposal ships `high` as the default for all presets. Published web builds targeting broad hardware may want `medium` by default with the option to raise it. Recommend: ship `high` as the Studio/authoring default; add a publish-time override (not part of this epic — a follow-up on the publish pipeline) that can downgrade to `medium` or `low` based on hardware detection. Until that lands, authors set it per-environment.

## Out of scope for v1 (deferred to follow-ups)

- PBR surface shader (`pbr-surface`) that composes authored Substance texture sets. **Plan 031.**
- Foliage surface shader with translucency + hue variation. **Plan 031 or 032.**
- Texture-set import pipeline from Substance Designer outputs. **Plan 031.**
- 3D LUT file import for color-grade. Ships with lift/gamma/gain only.
- SSAO re-enablement / GTAO stability fixes.
- Cascaded shadow maps or shadow distance/cascade authoring.
- Night-sky-specific post-process effects (stars, nebula tinting tied to sky rift).
- Volumetric light shafts / god rays.
- Per-region lighting overrides (lighting is per-environment; regions reference environments).
- Preset blending / time-of-day animation across presets. (Environments are static snapshots; temporal cycles are a separate system.)

## Success criteria for the epic

1. Opening a fresh project with `golden_hour` preset produces an explicit sun at a visible azimuth/elevation the author can grab and rotate.
2. Dropping `color-grade`, `bloom`, `tonemap`, `vignette` into the post-process stack and tuning their parameters for five minutes produces a visually warmer, moodier, more stylized-PBR scene — approaching the reference image's character without any PBR surface shader changes yet.
3. A fresh project renders soft cascaded sun shadows from Story 3 by default; switching shadow Quality visibly changes shadow resolution; Distance / Strength / Softness live-update without a stutter.
4. `packages/runtime-core/src/environment/**`, `packages/runtime-core/src/render/graph.ts`, and `packages/runtime-core/src/render/environment-scene.ts` import nothing from `three`, `three/webgpu`, or `three/tsl`. (Player, NPC, item, landscape, and `render/pipeline.ts` still import `three` today; cleaning those up is tracked as a separate follow-up and is explicitly not a success criterion for this epic.)
5. Migrating a v1 project with old `warmth: 0.3` and `atmosphere.bloom.enabled: true` produces a v2 project with matching sun color and a `:built-in:bloom` post-process binding, rendering within visual-diff tolerance of the original.
6. All environment and shader-runtime contract tests pass.

---

**Dependencies on Plan 029:** ShaderRuntime, post-process target kind, Render workspace, revision-based invalidation, built-in shader factory pattern, package-boundary tooling.

**Unblocks:** Plan 031 (PBR surface + foliage), because once this epic lands, authors can validate "did the look land" through mood/lighting/post alone, isolating the surface-shader work from environment debugging.
