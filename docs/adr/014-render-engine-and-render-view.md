# ADR 014: Render Engine and Render View

## Status

Accepted

## Context

Studio grew multiple WebGPU view lifecycles:

- the main authoring viewport
- design preview viewports
- the Surface Library preview panel

Those paths shared some render-web semantics but still duplicated renderer,
resolver, and runtime ownership. Mounting or unmounting one view could poison
another because there was no single owner for the shared GPU/runtime state.

Sugarmagic's architecture rules require:

- one source of truth
- one single enforcer for runtime-visible render behavior
- editor tooling layered on runtime systems, not parallel to them

## Decision

Split the old `WebRenderHost` into:

- `WebRenderEngine`
  - process-singleton per Studio process or per published-runtime host
  - owns shared `GPUDevice`
  - owns shared `ShaderRuntime`
  - owns shared `AuthoredAssetResolver`
  - owns resolved authored environment state
  - stays store-agnostic
  - receives canonical state through explicit setter calls

- `RenderView`
  - per visible render surface
  - owns scene, camera, renderer, render pipeline, DOM mount, and render loop
  - binds to one shared engine
  - re-applies engine-owned environment state locally

Studio and runtime targets own render-engine projector files that subscribe
to their upstream state shapes and push canonical state into the engine,
following the CQRS / event-sourcing projector pattern. `@sugarmagic/render-web`
does not import `@sugarmagic/shell`.

## Consequences

Positive:

- Surface preview can exist as its own central preview panel without spinning up
  a second ad hoc renderer/runtime/resolver stack.
- design previews inherit the same authored environment as the build viewport
- render-web stays portable across Studio and web targets
- the renderer construction site is explicit and lintable

Tradeoff:

- there are multiple live `WebGPURenderer` instances at runtime, one per
  `RenderView`, but they all share one engine-owned device/runtime/resolver
  stack

## Enforcement

- `packages/render-web` must not import `@sugarmagic/shell`
- `new WebGPURenderer(...)` is only allowed in
  `packages/render-web/src/view/RenderView.ts`
- `new ShaderRuntime(...)` is only allowed in
  `packages/render-web/src/engine/WebRenderEngine.ts`
- `createAuthoredAssetResolver(...)` is only allowed in
  `packages/render-web/src/engine/WebRenderEngine.ts`

Missing resolver wiring must fail loudly. `ShaderRuntime` and the landscape
controller do not create silent internal fallback resolvers, because that
would mask exactly the stale/missing-resolver bugs this engine split exists to
eliminate.
