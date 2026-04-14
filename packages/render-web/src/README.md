# Web Render Host

This package owns shared Three/WebGPU rendering helpers used by both:

- Studio's authoring viewport
- published web runtime hosts

It is the permanent home for web-specific shader finalization/application code
that must not live in `target-web` if the editor also needs it.

`ShaderRuntime` is also the single enforcer for finalized material lifecycle:
shared shader materials are reference-counted and retired through a short grace
period so scene transitions and shader invalidation do not synchronously tear
down GPU resources still in flight.
