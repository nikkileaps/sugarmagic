# Plan 037: Library-First Content Model Epic

**Status:** Implemented (37.9 cross-project zip export/import deferred)
**Date:** 2026-04-27 — closed out 2026-04-27
**ADR:** `docs/adr/015-library-first-content-model.md`

> **Framing.** Today the project's content library exposes Materials,
> Textures, Surfaces, Shader Graphs, and several other definition
> kinds, but the editor surfaces them inconsistently:
>
> - Materials live in their own workspace (Render → Materials).
> - Textures are surfaced through file imports + asset slots.
> - Surfaces have a workspace and an inline picker pattern.
> - Shader Graphs are workspace-only (Render → Shader Graphs).
>
> And the *concept of a Material* is conflated with *the concept of
> a Shader*: `MaterialDefinition.shaderDefinitionId` means "a material
> is a parameterized instance of a shader." That's why "Grass Surface
> 4 Material" and "Gentle Breeze Material" exist — they're shader
> graph instances dressed up as materials. The user-facing word
> "material" doing double duty as both PBR description and shader
> binding makes the library hard to reason about.
>
> This epic does two things:
>
> 1. **Decouples Material from Shader.** A Material becomes a closed
>    PBR description (baseColor, metallic, roughness, normalMap, AO,
>    emissive). A Shader is a custom shader graph (with its own
>    parameters baked in). Surface (the layer stack) composes both.
>    The current "Grass Surface X" / wind-preset "materials" become
>    Shaders.
> 2. **Unifies content management under a "Library" pattern.** A
>    consistent popover dialog for browse / select / import / delete
>    / export, used for Materials, Textures, Surfaces, and Shaders.
>    Built-in libraries ship with the engine; per-project libraries
>    save in the project file; libraries export/import as zips for
>    cross-project sharing. Removes the Material workspace entirely
>    (its functionality is folded into the popover for the
>    management half, into per-binding inspectors for the parameter-
>    edit half).
>
> Editing a shader graph (the canvas authoring surface) stays in the
> Render workspace — that's a real workspace activity, not a library-
> management activity. The Shader library popover surfaces shader
> graphs for browse/select/manage with an "Edit in Shader Graph"
> button that opens the workspace.
>
> No old-project migration. The project's existing Materials field
> just gets read under the new shape — definitions that don't fit
> the narrowed shape will be reinterpreted at load time as Shaders
> (or dropped, if the project chooses to start fresh). Built-in
> libraries are recreated under the new model from scratch.

## Epic

### Title

Library-First Content Model — separate **Material** (PBR) from
**Shader** (graph), unify all four content kinds (Material,
Texture, Surface, Shader) under a consistent **Library** popover
in `Game > Libraries`, drop the Material workspace.

### Goal

After this epic ships:
- A Material is unambiguously a PBR description with no shader
  reference; authors edit PBR parameters directly.
- A Shader is unambiguously a shader graph (with its own
  parameters); authors edit the graph in the Render workspace and
  pick from the Shader library popover when they want to apply
  one.
- A Surface composes Materials, Shaders, and flat colors as
  appearance-layer content; existing Surface stack mechanics from
  Epic 036 are unchanged.
- The user-facing menu has `Game > Libraries > Materials`,
  `Game > Libraries > Textures`, `Game > Libraries > Shaders` —
  each a popover dialog for browse / select / import / delete /
  export. **Surfaces are NOT a library kind**; they're the
  composition layer that references Materials and Shaders, and
  continue to be authored in the existing Surface workflow (the
  Surfaces workspace tab + inline pickers). Library popover is
  for content kinds that get *referenced by* surfaces, not
  surfaces themselves.
- Built-in content (PBR material starters, all of the existing
  shader graphs including foliage-wind preset variants, all of
  the existing Surface starter content) ships in the
  built-in libraries and is non-deletable but copy-to-edit-able.
- Per-project libraries are saved in the project file. Each
  library kind (Materials, Textures, Surfaces, Shaders) can be
  exported as a zip and imported into another project,
  preserving content and dependency references inside the
  library.
- The Material workspace is deleted. Anywhere material editing
  was workspace-only, the popover + inspector cover the same
  authoring affordances.

### Why this epic exists

The current model has three problems that compound as the project
grows:

1. **"Material" is overloaded.** It's both "the thing with PBR
   knobs" and "an instance of a custom shader" depending on which
   builtIn key you happen to look at. Authors picking a "Material"
   from a list have to know which kind they're dealing with to
   know what they can do with it. Consistent surfaces become
   guesswork.

2. **The Material workspace is a parallel authoring path.** Per
   AGENTS "single enforcer" rule, each authoring concept should
   have one home. Today material parameters can be edited in the
   workspace OR inline in a Surface inspector OR through the
   Asset surface slot inspector — three paths for the same edit.
   Folding management into the library popover and parameter
   editing into the inspector wherever bound collapses this into
   one model: pick from popover, edit where used.

3. **Library reuse across projects has no surface today.** A user
   who builds a great set of grass shaders in Project A and wants
   to use them in Project B has no path. Library export/import
   is the natural answer, but it requires a "library" concept
   that's shared across the four content kinds, which we don't
   currently have.

This epic fixes all three.

### Why now

Foundation work is done: Epic 036 stabilized the Surface layer
stack, scatter pipeline, and shader runtime. Material/Shader
decoupling is a localized refactor that doesn't fight any of that.
The library popover is straightforward UI work that parallels
existing workspaces. Combining both now sets a clean baseline
before any further authored-content work (e.g., the upcoming
station scene authoring, plugin-content surfaces).

### Core model

```ts
// Material — closed PBR description. No shader reference.
interface MaterialDefinition {
  definitionId: string;
  definitionKind: "material";
  displayName: string;
  metadata?: DefinitionMetadata;
  pbr: {
    baseColor: number;        // hex
    baseColorMap?: TextureRef | null;
    metallic: number;          // 0..1
    metallicMap?: TextureRef | null;
    roughness: number;         // 0..1
    roughnessMap?: TextureRef | null;
    normalMap?: TextureRef | null;
    occlusionMap?: TextureRef | null;
    emissiveColor: number;
    emissive: number;          // 0..1 multiplier
    emissiveMap?: TextureRef | null;
  };
}

// Shader — graph + its own baked-in parameter values. No "instance
// of" relationship to a parent shader. Each Shader is its own
// authored thing.
interface ShaderDefinition {
  definitionId: string;
  definitionKind: "shader";       // unchanged from today
  displayName: string;
  metadata?: DefinitionMetadata;
  graph: ShaderGraphDocument;     // existing shape; this IS the shader
  // No `parameterValues` field — parameters live INSIDE the graph
  // as authored constants. To make a "preset" of a base shader,
  // duplicate the graph and bake the values in (Stage 1 will
  // produce 4 hand-authored wind preset shader graphs this way).
}

// Surface — unchanged stack mechanics; appearance-layer content
// gains an explicit material/shader split.
type AppearanceContent =
  | { kind: "color"; color: number }
  | { kind: "material"; materialDefinitionId: string }   // PBR ref
  | { kind: "shader"; shaderDefinitionId: string };      // graph ref
```

### Library concept

```ts
// A "library" is a named collection of definitions of one kind
// owned by a particular SOURCE.
type LibrarySource =
  | { kind: "built-in" }
  | { kind: "project" };

interface ContentLibraryView<T> {
  source: LibrarySource;
  definitions: T[];
}

// Each project surfaces FOUR libraries per kind: the engine's
// built-in library + the project's own library. Per-content-kind:
//   getBuiltInMaterials() / getProjectMaterials()
//   getBuiltInTextures() / getProjectTextures()
//   etc.
// The popover UI shows both, grouped, with built-ins marked
// non-deletable.
```

`Built-in` libraries live in code (the existing
`createBuiltInMaterialDefinitions`, `createBuiltInSurfaceDefinitions`,
etc.). `Project` libraries are persisted in the project file —
already true today, just not surfaced under a "library" concept.

### Library popover UX shape

```
┌─ Materials Library ──────────────────────────────────┐
│  [Built-in]  [Project]   [+ Import]    [↑ Export]    │
│                                                       │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Wood (PBR)    ★ │  │                          │  │
│  │ Metal (PBR)   ★ │  │   [preview render]       │  │
│  │ Stone (PBR)   ★ │  │                          │  │
│  │ Grass Mud  (P)  │  │   Wood (PBR)             │  │
│  │ ...             │  │   Built-in               │  │
│  │                 │  │                          │  │
│  │                 │  │   baseColor:  ▓ #6b4d2b  │  │
│  │                 │  │   roughness:  0.85       │  │
│  │                 │  │   metallic:   0.0        │  │
│  │                 │  │   ...                    │  │
│  │                 │  │                          │  │
│  │                 │  │   [Duplicate to edit]    │  │
│  └─────────────────┘  └──────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

- Left: list grouped by source (Built-in ★, Project P), filterable.
- Right: preview render + parameter view.
- Built-in items are non-deletable; their "edit" affordance is
  "Duplicate to Project Library" → the duplicate is editable.
- Project items have full edit (parameter knobs, rename,
  duplicate, delete).
- Top toolbar: tab between Built-in / Project, import-from-zip
  button, export-current-tab button.
- For Shaders specifically: the parameter view becomes "graph
  parameters baked into this shader" + an "Edit in Shader Graph
  workspace" button that opens the existing Render workspace
  with this shader loaded.

The popover is dismissable, modal-ish (blocks main viewport
interaction while open), and opens from `Game > Libraries > {kind}`
menu items.

### Out of scope

- Old-project migration. Existing project files saved under the
  current model load on a best-effort basis: anything that fits
  the new Material shape becomes a Material; anything that's
  shader-based becomes a Shader; broken references are flagged in
  the project loader's warning channel for the user to address
  manually.
- Cross-library reference imports (a Surface in Project A's
  library that references a Material in the same library — the
  exported zip carries both, so import works; but importing JUST
  the Surface into Project B won't auto-resolve to a Material in
  Project B's library, even if name matches).
- Folder organization within a library. Flat list per source for
  v1; if grouping becomes necessary, add tags or folders later.
- Multiple project libraries per kind. One Materials library per
  project, etc.
- "Library item used by N things" usage-tracker / cascade-delete
  warnings beyond the simple in-use guard (delete is hard-blocked
  if the definition is referenced).

## Stages

### Stage 1 — Domain decoupling

Foundation only. Narrow Material to PBR-only, recognize Shader as
its own concept, extend appearance-layer content with the
material/shader split. No UI changes; no built-in content
migration yet. Everything still renders through whatever bindings
the current built-ins establish (which after Stage 1 is "broken"
in the sense that there are no Material/Shader references yet —
Stage 2 fixes that).

Scope: stories 37.1.

### Stage 2 — Built-in content migration

Recreate the existing built-in content under the new model:
- Wind preset Materials become 4 Shader graphs (Still Air,
  Gentle Breeze, Meadow Breeze, Gusty), each authored as an
  independent graph with values baked in.
- Grass Surface 2/3/4/6 Materials become Shaders.
- Foliage Surface 1/2/3 Materials become Shaders.
- Other shader-wrapping built-in materials become Shaders.
- A new built-in Material library is populated with PBR starter
  presets (Wood, Metal, Stone, Plaster, Bark — TBD set; minimum
  is "enough to be useful for non-foliage authoring").
- Built-in Surfaces (currently bind to the old Material concept)
  rewire to reference Shaders explicitly via the new
  AppearanceContent split.

Scope: stories 37.2 – 37.5.

### Stage 3 — Library popover (Materials, Textures)

The user-facing library popover for the two primary referenced-
content kinds. `Game > Libraries > Materials | Textures`.
Browse, select, import (file), delete, parameter editing for
Materials. No Shader popover yet (Stage 4). **Surfaces are
explicitly NOT a library kind** — they're the composition layer
that references Materials and Shaders. Surface authoring stays
in the existing Surfaces workspace tab + inline pickers.

Scope: stories 37.6 – 37.7.

### Stage 4 — Library export/import + Shader library

- Library export-as-zip with referenced dependencies bundled
  (textures inside the zip, cross-references inside the library
  preserved).
- Library import-from-zip into a project library.
- Game > Libraries > Shaders popover: same shape as the others,
  with "Edit in Shader Graph" opening the Render workspace.

Scope: stories 37.9 – 37.10.

### Stage 5 — Workspace removal + closeout

Delete the Material workspace. Audit any place that opened the
material workspace and replace with library-popover navigation
or inline-inspector edit. ADR closeout + epic completion.

Scope: stories 37.11 – 37.12.

## Stories

### 37.1 — Domain types: Material narrows to PBR; Shader becomes its own kind

**Outcome:** `MaterialDefinition` no longer has
`shaderDefinitionId` / `parameterValues` / `textureBindings`.
Instead it has a `pbr: { baseColor, metallic, roughness,
normalMap, occlusionMap, emissive, emissiveColor, emissiveMap }`
field. `ShaderGraphDocument` (already a domain type) gains a
sibling kind/wrapper or is renamed to `ShaderDefinition` so the
language matches the four-library mental model: Material,
Texture, Surface, Shader.

`AppearanceContent` (the variant inside an appearance layer) gets
two new variants: `{ kind: "material"; materialDefinitionId }`
and `{ kind: "shader"; shaderDefinitionId }`. The old
`{ kind: "color"; color }` stays.

**Files touched:**
- `packages/domain/src/content-library/index.ts` — narrow
  `MaterialDefinition`. Add a type alias / rename for
  `ShaderGraphDocument` → `ShaderDefinition` if going that route
  (cleanest for naming consistency); keep the old name available
  as an alias to avoid touching every reference at once.
- `packages/domain/src/surface/index.ts` (or wherever
  `AppearanceContent` lives) — extend the variant.
- `packages/io/...` — update IO encode/decode for the new shapes.
- Existing tests: many will need updating because `parameterValues`
  / `textureBindings` come off `MaterialDefinition`. Sweep with
  ts-driven errors.

**Out of scope for this story:**
- Migrating built-in content to the new shape (Stage 2).
- Any UI changes (Stage 3+).
- Old-project file load handling (handled in 37.5 below).

### 37.2 — Wind preset Shaders (4 hand-authored graph documents)

**Outcome:** Four built-in Shader definitions replace the four
"wind preset Material" definitions:
- `still-air` (`windStrength = 0`)
- `gentle-breeze` (`windStrength = 0.18, windFrequency = 1.1, windDirection = [1,0]`)
- `meadow-breeze` (`windStrength = 0.35, windFrequency = 1.6, windDirection = [1,0.2]`)
- `gusty` (`windStrength = 0.65, windFrequency = 2.6, windDirection = [1,-0.15]`)

Each is an independent `ShaderGraphDocument` (no template
generation — duplicates are fine and dead-simple to read). The
authored values are baked into the graph as constant parameter
nodes (or whatever the cleanest "locked-in default" expression
is in the current shader graph IR).

**Files touched:**
- `packages/domain/src/content-library/builtins/material-definitions.ts`
  — remove the four wind preset Material entries.
- `packages/domain/src/content-library/builtins/shader-definitions.ts`
  (new or extend existing) — add the four wind shader entries.
- `packages/domain/src/shader-graph/index.ts` — if needed, add a
  factory function `createWindPresetShaderGraph(presetKind)` to
  reduce boilerplate. Or just author 4 plain definitions.

**Verification:** A scatter layer with `wind: { kind: "reference",
shaderDefinitionId: "<wind-preset-id>" }` renders the same wind
behavior as the current `wind: { kind: "reference",
materialDefinitionId: "<wind-preset-material-id>" }` did.

### 37.3 — Grass + Foliage Surface Shaders

**Outcome:** All "Grass Surface 2/3/4/6" + "Foliage Surface 1/2/3"
+ "Meadow Grass" / "Sunlit Lawn" / "Autumn Field Grass" / "Painterly
Grass" Material definitions are removed from
`material-definitions.ts`. Their underlying Shader graphs already
exist as `ShaderGraphDocument`s in
`packages/domain/src/shader-graph/index.ts`; those become
first-class built-in Shader definitions.

The bookkeeping difference: these used to be `Material{
shaderDefinitionId: "...grass-surface-4", parameterValues: {} }`.
Now they're just the underlying ShaderDefinition surfaced
directly to the author. Authors who want to tune a parameter
value duplicate the shader (Stage 3 popover supports
"Duplicate to Project Library").

**Files touched:**
- `packages/domain/src/content-library/builtins/material-definitions.ts`
  — remove the grass + foliage surface Material entries.
- `packages/domain/src/content-library/builtins/shader-definitions.ts`
  — surface the existing grass-surface-X / foliage-surface-X
  shader graphs as first-class built-in Shader definitions.

### 37.4 — Built-in PBR Material starter set

**Outcome:** A modest starter set of true PBR Material definitions
ships in the built-in Material library: Wood, Metal, Stone,
Plaster, Bark, Plain Painted (just enough to be useful for non-
foliage authoring). Each has authored baseColor / roughness /
metallic, no maps required (maps are optional). Authors who want
maps add them via the parameter inspector in Stage 3.

**Files touched:**
- `packages/domain/src/content-library/builtins/material-definitions.ts`
  — replace the (now-empty after 37.3) grass-related entries
  with the new PBR starter set.

**Verification:** Each starter material renders correctly when
bound as `AppearanceContent { kind: "material", materialDefinitionId }`
on a flat surface (e.g., a primitive cube preview).

### 37.5 — Built-in Surface rewires + project loader best-effort migration

**Outcome:** Built-in Surface definitions (e.g.,
`wildflower-meadow`) that bind to wind preset Materials or grass
Surface Materials are rewired to bind to the new wind Shaders
and grass Shaders via `AppearanceContent { kind: "shader",
shaderDefinitionId }`. The Surfaces themselves don't change
shape; only the references inside them.

The project loader (IO read path) accepts old project files
shaped under the previous model. Best-effort:
- Old `MaterialDefinition.shaderDefinitionId` ≠ undefined →
  reinterpret as a Shader reference (pointing to the same
  shader graph that material wrapped).
- Old `MaterialDefinition` with no shader → reinterpret as a
  PBR Material with default values + a warning in the load log.
- Surface bindings with `kind: "material"` pointing to a now-
  Shader → rewire on read to `kind: "shader"`.

No automatic data migration writes; just a load-time interpret
step. If users want their old projects to fully match the new
shape persistently, they re-save.

**Files touched:**
- `packages/domain/src/content-library/builtins/surface-definitions.ts`
  — update built-in Surface bindings to the new content kinds.
- `packages/io/...` — load-path interpretation for old shapes
  with a warning channel.
- `packages/testing/...` — fixtures that use old-shape projects
  are updated to the new shape; one regression test loads a
  saved-old-project fixture and asserts the warning channel
  reports the reinterpretation.

### 37.6 — Library popover infrastructure + Materials popover

**Outcome:** New shared library-popover component
(`packages/ui/src/components/LibraryPopover.tsx` or similar) that
implements the layout in the UX shape section above: tab between
Built-in / Project sources, list-on-left + preview-on-right,
import / delete / export buttons, "Duplicate to edit"
affordance for built-ins.

The first instantiation: `Game > Libraries > Materials`. Click
the menu item → modal popover opens, lists built-in + project
materials, click one → preview renders + parameter knobs
(baseColor, metallic, roughness, etc.) editable for project
materials, read-only for built-ins. Import a new material from
file (PBR JSON or similar simple shape). Delete (with in-use
guard).

**Files touched:**
- `packages/ui/src/components/LibraryPopover.tsx` (new) —
  generic shared component.
- `packages/workspaces/src/build/menu/...` (or wherever the
  top menu is wired) — add `Game > Libraries > Materials` menu
  item that opens the popover.
- `apps/studio/...` — wire the popover into the studio shell.
- `packages/testing/...` — interaction tests for the popover
  (vitest + @testing-library).

### 37.7 — Textures popover

**Outcome:** Same library popover shape, applied to Textures.
Browse built-in (if any) + project textures; import a new texture
from file; preview shows the texture image; delete with in-use
guard. No editable parameters (textures are files).

### 37.9 — Library export/import as zip

**Outcome:** Each library (per content kind, per source) gains
two operations:
- **Export:** produce a `.sugarlib.zip` (or whatever extension
  the project picks) containing all definitions in the library
  + all referenced binary assets (textures) + a manifest. The
  zip is self-contained — opening it elsewhere preserves all
  internal references.
- **Import:** select a `.sugarlib.zip` file → parse → add
  definitions to the project library, copy binary assets into
  the project's asset folder, fix references. Conflicts (same
  ID) resolve by user choice (skip / overwrite / rename).

**Files touched:**
- `packages/io/...` — zip serialize/deserialize for library
  contents (probably wrap a small zip lib like `fflate`).
- `packages/workspaces/src/build/...` — Import / Export
  buttons in each library popover wired to the IO functions.
- `packages/testing/...` — round-trip tests (export then
  import, verify equivalence).

### 37.10 — Shaders popover

**Outcome:** `Game > Libraries > Shaders` popover. Browse
built-in + project shaders. Preview is a render of the shader
applied to a primitive (uses Surface preview viewport
machinery). The "edit" affordance is "Edit in Shader Graph" →
opens the existing Render workspace's shader graph editor with
this shader loaded. Duplicate-to-edit for built-ins. Import
shader from `.sugarshader.json` (single file) or via library
zip (Story 37.9).

### 37.11 — Remove the Materials workspace

**Outcome:** The Materials workspace is deleted from the editor
shell. Any code path that previously navigated to it (e.g.,
"Edit Material" buttons, asset surface slot inspectors that
linked to it) is rewired to either:
- Open the Materials popover (for selecting a different
  material).
- Edit parameters inline in whatever inspector the user is
  already in (Surface inspector, asset slot inspector, etc.).

Audit:
- Every callsite that imports or navigates to the Material
  workspace.
- All routing entries for the Materials workspace.
- Any UI affordance that says "Edit Material" or "Open in
  Material Editor."

Per AGENTS "delete over coexist" — no shim left behind.

**Files touched:**
- `packages/workspaces/src/build/materials/` — delete entirely.
- Wherever the materials workspace route is registered.
- Any references in `apps/studio/`.
- Tests for the materials workspace.

### 37.12 — ADR + epic completion

**Outcome:** New ADR documenting the Material/Shader/Surface
distinction + the Library-popover pattern as the canonical
authored-content management surface. Or extend an existing ADR if
there's a natural home. Mark Plan 037 status `Implemented`.

**Files touched:**
- `docs/adr/0XX-library-first-content-model.md` (new).
- `docs/plans/037-library-first-content-model-epic.md` —
  status flip.

## Success criteria

- `grep -rn "shaderDefinitionId" packages/domain/src/content-library/builtins/material-definitions.ts`
  returns nothing — no Material definition references a shader.
- `grep -rn "parameterValues\b" packages/domain/src/content-library/builtins/material-definitions.ts`
  returns nothing — Materials have no shader parameter binding.
- `Game > Libraries > Materials | Textures | Surfaces | Shaders`
  all open functional popovers with built-in + project content.
- A Surface created entirely from the new built-in content
  (e.g., wildflower-meadow rebuilt under the new model) renders
  identically to the pre-epic version.
- Exporting the project's Materials library to a zip and
  importing it into a fresh project produces the same materials,
  with all texture references intact.
- The Materials workspace directory under `packages/workspaces`
  is gone (`grep -r "MaterialsWorkspace" packages` returns
  nothing).
- ADR documents the new model as canonical; Plan 037 marked
  `Implemented`.

## Risks

- **Surface integration friction.** Today the appearance-layer
  content carries a binding; the new shape carries an explicit
  material vs shader split. Existing rendering code (mesh-apply,
  landscape-apply, scatter-realize) needs sweeping for the
  binding-resolution paths. Mitigation: do the domain change
  (37.1) thoroughly with type errors driving every callsite
  update before moving to built-in migration (37.2+). Don't try
  to do everything at once.
- **"Duplicate to edit" UX dead-ends if Shader graph workspace
  isn't ready.** Stage 4's "Edit in Shader Graph" affordance
  depends on the Render workspace being able to load any
  shader by definitionId. Verify this works before shipping the
  Shader popover.
- **Library zip portability.** Exporting + importing texture
  binaries inside a zip is straightforward; binary asset paths
  need to remain stable across import (the import has to copy
  bytes to the project's asset folder + rewrite references). If
  this gets tangled, defer the zip story (37.9) and ship the
  popover-only first; the value of the library pattern is
  preserved without zip portability.
- **Parameter editing in inspector vs popover.** For Materials,
  parameters are simple (numbers, colors, texture refs) and edit
  inline anywhere. For Shaders, "parameters" are graph-internal
  authored values — you'd edit them by editing the graph in the
  workspace, not inline. The popover surfaces them as read-only;
  if the user wants different values, they duplicate the shader
  and edit the graph. Make sure this is clear in the popover
  UI to avoid confusion ("why can't I just change windStrength
  here?").
