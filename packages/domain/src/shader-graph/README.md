# Shader Graph Domain

This module owns the canonical authored shader graph document format.

- `ShaderGraphDocument` is the persisted source of truth.
- Node definitions and validation rules live here, not in the editor or target hosts.
- Runtime targets compile and finalize from these documents; they do not invent
  parallel shader models.
