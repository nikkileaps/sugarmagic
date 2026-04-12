<!--
/Users/nikki/projects/sugarmagic/packages/runtime-core/src/billboard/README.md

Purpose: Documents the shared runtime billboard module and its ownership boundary.

Status: active
-->

# Billboard Runtime

This module owns the platform-agnostic billboard truth for the shared runtime:
descriptor types, the `BillboardComponent`, the `CameraSnapshot` boundary, and
the `BillboardSystem` that computes LOD and visibility.

It does not create meshes, textures, DOM nodes, or renderer objects. Web target
presentation lives in `targets/web/src/billboard/`.

Single source of truth:

- `BillboardComponent` is the only runtime-owned billboard state.
- `BillboardComponent.enabled` is the single manual on/off gate for billboard presentation.
- `BillboardSystem` is the only runtime-owned LOD/visibility decision maker.
- Presentation targets may only read that state; they must not recompute LOD.
