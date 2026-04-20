# Build Materials Workspace

Owns the Build-mode Material Library authoring surface.

Why this module exists:
- `@sugarmagic/domain` owns the canonical `MaterialDefinition` and `TextureDefinition` data.
- `@sugarmagic/runtime-core` resolves authored material meaning into effective shader inputs.
- `@sugarmagic/render-web` binds those resolved inputs to Three/WebGPU.
- This module is the editor layer on top of that stack: it lets authors create reusable materials, choose parent shaders, and edit parameter / texture snapshots without introducing a second rendering truth.

Key responsibilities:
- list and search project materials
- create materials against a chosen parent shader
- import PBR texture sets into the shared content library
- edit material parameter values and texture bindings
- surface material deletion constraints when a material is still referenced

Non-responsibilities:
- no rendering semantics
- no shader compilation logic
- no file import plumbing beyond calling the canonical Studio/App handlers
