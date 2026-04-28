# ADR 015: Library-First Content Model

## Status

Accepted (with Story 37.9 cross-project zip export/import deferred —
see Plan 037 closeout).

## Date

2026-04-27

## Context

Epic 037 separates authored physical materials from executable shader graphs.
Before this decision, `MaterialDefinition` was a shader-wrapper: it carried a
parent shader id plus parameter and texture snapshots. That made "Material"
mean two behaviors at once and kept reintroducing ambiguity in surface,
scatter, deform, and effect authoring.

The same epic also unified content-management UX across the four authored
content kinds (Material, Texture, Shader, plus Surface as composition layer)
under a consistent Library popover pattern, replacing the Materials workspace.

## Decision

### Material vs Shader separation

`MaterialDefinition` is now the single source of truth for reusable PBR
material data: base color, scalar PBR values (metallic, roughness,
emissive intensity), optional texture maps, and tiling. It does not carry
shader graph ids or shader parameter snapshots.

`ShaderGraphDocument` is the single source of truth for executable shader
logic. Shader selection is explicit anywhere authored content needs
executable behavior: shader appearance layers, scatter appearance shaders,
deform bindings, effect bindings, post-process stacks, and render shader
editing.

`AppearanceContent` (the variant inside an appearance layer) splits
explicitly into `{ kind: "color" }` | `{ kind: "material",
materialDefinitionId }` | `{ kind: "shader", shaderDefinitionId, ... }` —
the material/shader distinction is preserved at the consumer surface, not
collapsed back into a single "binding."

### Library popover as the management surface

`Game > Libraries > Materials | Textures | Shaders` opens a modal popover
with a list-on-left + preview-on-right layout. Built-in items (shipped in
sugarengine itself) and project items (saved in the project file) appear in
the same popover, with built-ins marked non-deletable. The popover is the
single management surface for these kinds; the Build Materials workspace is
removed.

**Surfaces are NOT a library kind.** Surfaces are the composition layer
that references Materials and Shaders; they're authored in the existing
Surfaces workspace tab + inline pickers, not browsed in a library popover.
The library popover is for content kinds that get *referenced by*
surfaces.

### Material preview shader

A single engine-internal `MeshStandardMaterial` instance is used for ALL
material previews in the popover. Defined in
`apps/studio/src/library/materialPreviewShader.ts`. It is NOT user-facing,
NOT in the Shaders library, NOT a graph, NOT bindable from authored
content. Its sole purpose is reading a `MaterialDefinition`'s PBR fields
(scalars + optional texture maps via the asset resolver) and rendering them
on a primitive in the preview viewport. Authors never see it in any list.

### Shader editing path

Shaders appear in the Shaders library popover for browse / select / "Edit
in Shader Graph." Clicking "Edit" closes the popover and routes the shell
to `Render > Shaders` with the selected shader pre-loaded via the existing
`WorkspaceNavigationTarget { kind: "shader-graph", shaderDefinitionId }`
pattern. Authoring shader graphs is a workspace activity (it needs canvas
space); the library popover is browse-only for shaders.

### Shaders are libraries-edited-in-app

Shaders are the asymmetric library kind. Materials, Textures, and Assets
are conceptually authored in external tools (Substance Designer, Photoshop,
Blender) and imported as project content; sugarmagic just references them.
Shaders have no external editor of equivalent expressiveness, so they are
authored *inside* sugarmagic via `Render > Shaders`. They still behave as
a library in every other respect — project-scoped, fork-to-edit (right-
click → Duplicate on a built-in produces an editable user copy via the
`CreateShaderGraph` command with `insertAfterShaderDefinitionId` so the
fork lands next to its source), built-ins are read-only — but the
authoring surface is in-app rather than another application. A separate
"sugarshader" companion app was considered and explicitly deferred; for
now the in-workspace graph editor is the path. Texture inputs to a shader
bake into the shader's `texture2d` parameter `defaultValue` (set via the
shader inspector). The runtime resolver honors that default as the
texture binding when no use-site binding is provided, so authors customize
a shader's textures by forking the shader and editing the parameter
defaults — not by per-use binding overrides.

## Consequences

- Runtime-core remains the single enforcer that resolves PBR materials into
  effective mesh-surface shader bindings for render packages.
- Scatter grass/foliage looks use explicit shader references instead of
  material wrappers.
- Wind presets (Still Air / Gentle Breeze / Meadow Breeze / Gusty) are
  shader definitions, not material definitions. Each is its own
  hand-authored ShaderGraphDocument with parameters baked in.
- PBR imports produce PBR material records (with texture-map references)
  and texture definitions, not shader-wrapper materials. The library
  popover renders imports correctly via the preview shader.
- Existing project documents with legacy material wrapper fields are
  normalized into PBR material definitions on load (best-effort
  reinterpretation; not a permanent migration).
- The Materials workspace is gone. `BuildWorkspaceKind` no longer
  enumerates "materials." Anywhere an editor previously navigated to the
  Materials workspace now opens the popover or edits parameters
  inline.

## Implementation arc (retrospective, 2026-04-27)

The first cut of Plan 037's UI got two things wrong that were corrected
in-flight:

1. **Library buttons placed in the workspace toolbar instead of the Game
   menu.** Plan 037 specified `Game > Libraries > {kind}`. First cut
   added inline buttons in BuildSubNav. Corrected by adding a Libraries
   submenu to the Game dropdown in `apps/studio/src/App.tsx` and adding
   `activeLibrary: LibraryKind | null` + `setActiveLibrary` to the
   shellStore so any UI surface (current and future) can trigger the
   popover.
2. **Surfaces was included in the library kinds list.** First cut had
   `Materials | Textures | Surfaces | Shaders`. Corrected by removing
   Surfaces from the `LibraryKind` type and from the popover entirely;
   spec was updated to make the "Surfaces are the composition layer, not
   a library kind" position load-bearing.

Additionally, the spec author (Claude) had originally suggested adding
Surfaces to the library list during planning. The user explicitly
rejected this once the implications became clear; the rejection is
encoded in the ADR architecture above to prevent the same suggestion
from recurring in future epics.

## Out of scope (deferred)

- **Story 37.9 (cross-project library export/import as zip)**. Real
  feature requiring zip lib + texture binary bundling + conflict
  resolution UI + asset path rewriting on import. Deferred — single-
  project workflows don't need it; revisit when cross-project library
  sharing becomes a real need.
- **Editing PBR parameters of project materials inline in the popover**.
  V1 popover surfaces material name + delete button; full inline
  parameter editing (color picker, sliders for roughness/metallic,
  texture-map pickers) is not implemented. Authors who want to tweak a
  PBR material currently do so by importing a new variant.
- **Duplicate-to-edit affordance for built-in materials**.
  V1 Materials popover has no "Duplicate to Project Library" button on
  built-ins. Authors who want to derive from a built-in re-create from
  scratch. (Shaders DO have right-click → Duplicate via the Render >
  Shaders list.)
