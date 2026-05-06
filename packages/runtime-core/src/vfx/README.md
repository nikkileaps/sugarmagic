# Runtime VFX

`packages/runtime-core/src/vfx` is the single runtime owner for particle VFX
simulation. It consumes domain-authored `VFXDefinition`s, item bindings, and
region spawns, then exposes Three-free emitter snapshots for render targets.

Render packages must not reimplement particle lifecycle rules. They should
consume `VFXManager.getSnapshots()` and realize those particles with their own
platform renderer.
