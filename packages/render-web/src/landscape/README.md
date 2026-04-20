# Render-Web Landscape

This module is the web-render realization of authored landscapes.

Ownership split:
- `@sugarmagic/runtime-core/landscape` owns pure landscape meaning:
  descriptors, paint payloads, and the splatmap data model.
- `@sugarmagic/render-web/landscape` owns Three/WebGPU realization:
  meshes, materials, texture upload, and scene attachment.

Why it exists:
- Studio and Preview must render the same authored landscape through the same
  implementation.
- Runtime-core must stay free of Three/WebGPU imports.

Current responsibilities:
- instantiate and dispose the shared landscape scene controller
- upload splatmap byte buffers to GPU textures
- realize color-mode and material-mode landscape channels
- keep landscape surface rendering shared between edit and play
