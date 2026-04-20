# Shader Materialization

This internal `render-web` submodule keeps `ShaderRuntime` readable while
preserving one materialization implementation.

- `math.ts` owns pure math/color/vector op materialization.
- `effect.ts` owns stateful effect op materialization like bloom and wind.
- `types.ts` holds the small shared contracts those helpers need.

`ShaderRuntime` remains the single enforcer for authored shader IR finalization.
These files are internal helpers for the same runtime path used by both Studio
and the published web host.
