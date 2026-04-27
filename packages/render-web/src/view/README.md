# Render-Web View

This module owns per-visible render surfaces on top of the shared
 `WebRenderEngine`.

Each `RenderView` owns:
- one scene
- one camera
- one DOM mount target
- one `WebGPURenderer`
- one render pipeline
- one environment scene controller
- one landscape scene controller
- one render loop / frame-listener set

It depends on the shared engine for:
- the GPU device
- the shared `ShaderRuntime`
- the shared `AuthoredAssetResolver`
- the resolved authored environment snapshot

This split keeps `render-web` reusable while preventing every Studio panel from
spinning up its own duplicate renderer/runtime/resolver stack.
