# Render-Web VFX

`packages/render-web/src/vfx` realizes runtime-core VFX snapshots as
Three/WebGPU objects. It owns instanced meshes, particle materials, and GPU
resource cleanup, but it does not own simulation or authored VFX meaning.

The runtime source of truth is `packages/runtime-core/src/vfx`; this module is
the web-rendering adapter for that state.
