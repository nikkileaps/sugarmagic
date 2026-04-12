<!--
/Users/nikki/projects/sugarmagic/targets/web/src/billboard/README.md

Purpose: Documents the web-target billboard presentation module.

Status: active
-->

# Web Billboard Presentation

This module owns the web-only presentation of billboards:

- `BillboardAssetRegistry` resolves descriptor IDs into textures.
- `BillboardRenderer` draws sprite and impostor billboards.
- `TextBillboardRenderer` projects text billboards into pooled DOM overlays.

It does not decide LOD. The shared runtime billboard system computes `lodState`,
and `runtimeHost` is the single enforcer that decides whether the full mesh or
the billboard presentation is active for a given entity.
