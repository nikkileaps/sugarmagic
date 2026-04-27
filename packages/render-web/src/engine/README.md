# Render-Web Engine

This module owns the shared render-engine state for web views.

Ownership:
- one `GPUDevice` shared across all attached web render views
- one shared `ShaderRuntime`
- one shared `AuthoredAssetResolver`
- the currently-resolved authored environment snapshot

What it does not own:
- shell-store subscriptions
- Studio or runtime-target app state
- per-view scenes, cameras, DOM elements, or render loops

Why it exists:
- keep render-web store-agnostic
- share expensive GPU/runtime caches across multiple simultaneous views
- let Studio and published runtime feed canonical state in through explicit
  setter calls without creating multiple ad hoc host lifecycles
