# Plan 028: Blender Foliage Authoring and Sugarmagic Export Epic

**Status:** Proposed  
**Date:** 2026-04-12

## Epic

### Title

Build a Blender companion authoring tool and a strict Sugarmagic foliage export contract so stylized trees can be authored procedurally, exported cleanly, and run performantly in Sugarmagic.

### Goal

Deliver a clean end-to-end foliage pipeline by:

- authoring stylized trees procedurally in Blender through a Sugarmagic-owned companion tool
- exporting trees as Sugarmagic-compatible foliage assets instead of raw Blender-only setups
- introducing a specialized `assetKind: "foliage"` inside Sugarmagic's existing asset system
- allowing authored textures to travel inside exported GLBs while keeping Blender material graphs out of runtime truth
- exporting only GLB-safe authored data from Blender and letting Sugarmagic own runtime foliage metadata and optimization policy
- ensuring the authored tree can become an instanced, runtime-optimized forest asset inside Sugarmagic

This epic exists to make "author once, run everywhere in Sugarmagic" true for vegetation without making the runtime depend on Blender semantics.

## Why this epic exists

Sugarmagic can already import plain `.glb` and `.gltf` models, but that is not yet a production vegetation pipeline.

For trees and foliage, a raw imported mesh is not enough:

- Blender procedural setups do not run in Sugarmagic or Three.js
- Blender-only shader graphs are not trustworthy runtime truth
- preview materials in Blender are useful for authoring, but should not define final in-game material behavior
- forests need deliberate LOD, impostor, culling, and instancing behavior
- manual per-tree export workflows do not scale
- hand-authored vegetation optimization becomes repeated busywork and produces drift

Sugarmagic needs a pipeline where:

- Blender is the authoring frontend
- exported GLB foliage assets are the project-visible source material
- Sugarmagic is the single enforcer for runtime interpretation
- the same foliage asset can be placed once or ten thousand times without changing meaning

## Non-goals

- This epic does not make Blender Geometry Nodes a Sugarmagic runtime dependency.
- This epic does not attempt to run Blender procedural graphs inside the game.
- This epic does not turn Sugarmagic into a full DCC replacement.
- This epic does not require authored trees to remain editable in Sugarmagic at the same procedural level as Blender.
- This epic does not create a second parallel asset system outside the Content Library.

## Core architecture clarification

### Product shape

This should be treated as one pipeline with two deliberate layers:

- **Blender companion authoring tool**
  - authoring convenience
  - procedural controls
  - baking and export
- **Sugarmagic foliage asset pipeline**
  - canonical project asset ownership
  - import, placement, runtime loading, LOD, billboards, instancing

The Blender tool is upstream authoring support.

Sugarmagic remains the product that owns runtime-visible behavior.

### Asset system clarification

This epic should extend the existing asset system rather than invent a new parallel one.

Recommended direction:

- keep `definitionKind: "asset"`
- add `assetKind: "foliage"`

That means:

- props, buildings, and general imported meshes may remain `assetKind: "model"`
- trees, shrubs, and vegetation packages use `assetKind: "foliage"`

This preserves one asset library while still giving foliage a dedicated runtime path.

### Source of truth clarification

This epic must keep one source of truth per layer.

#### In Blender

The canonical authoring source is the Blender scene plus the companion tool parameters.

That source is useful for authoring, but it is **not** the thing Sugarmagic runs.

#### In the Sugarmagic project

The canonical project-visible source of truth is the exported foliage GLB referenced by one asset definition in the Content Library, plus any runtime-owned foliage settings Sugarmagic stores for that asset.

Runtime and publish systems must read imported asset data, not re-open Blender files.

#### Derived runtime projections

The export or import pipeline may derive:

- LOD meshes
- billboard atlases
- impostor captures
- packed textures
- runtime culling or sway metadata

Those are derived runtime projections or delivery artifacts.

They may be regenerated.

They must not create a second authored truth.

### Single enforcer clarification

The companion tool may decide how to author and export a tree.

Sugarmagic must be the single enforcer for:

- foliage asset loading
- mesh/billboard LOD switching
- runtime wind application
- instancing semantics
- culling behavior
- placement and scatter interpretation

The Blender tool must not become the hidden owner of runtime behavior.

## Required export contract

This epic should define a strict export contract for foliage assets.

At minimum, exported foliage content must be representable as:

- realized mesh geometry
- stable texture assets, including textures embedded in GLBs when that is the simplest authored handoff
- material slot separation and export-safe shader inputs such as UVs, vertex colors, and custom normals
- export-safe attributes or extras that naturally fit inside a normal GLB
- deterministic authored data for runtime loading

The export contract must not depend on:

- Blender shader nodes being interpreted by Sugarmagic
- Blender preview materials being treated as final runtime materials
- live Geometry Nodes graphs at runtime
- Blender collection names being runtime meaning
- Blender-authored sidecar metadata that Sugarmagic must treat as runtime truth
- manual post-export cleanup for every tree

In short English pseudo code:

```text
author tree in Blender
validate authoring graph
realize and bake export payload
emit export-safe GLB
import GLB into Sugarmagic
place foliage asset in region
runtime decides mesh vs billboard vs cull
```

## Proposed foliage handoff shape

The Blender-side handoff should stay as close as possible to a normal asset export.

Recommended direction:

- Blender exports one canonical foliage GLB for authored truth
- the GLB may include export-safe extras, UVs, vertex colors, custom normals, texture references, and embedded textures
- Blender does not generate additional Blender-authored LOD GLBs
- Blender materials remain authoring previews or texture carriers, not final runtime shader truth
- billboard generation, impostor generation, wind interpretation, culling thresholds, and other runtime-only settings should be owned by Sugarmagic after import

## Default Blender companion scope

The first Blender companion tool should be intentionally narrow.

It should support:

- trunk generation
- primary branch generation
- secondary branch generation
- leaf card or leaf clump placement
- seed-driven variation
- a small set of stylization controls
- export validation
- one-click "Export to Sugarmagic"

It should not try to solve every plant category in v1.

Start with:

- one tree archetype family
- multiple parameterized variations
- clean export

## Verification discipline for this epic

For this epic, the answers must remain clear:

- **What is the source of truth?**
  - The exported foliage GLB plus its Content Library asset definition inside Sugarmagic.
- **What is the single enforcer?**
  - Sugarmagic's foliage import and runtime path.
- **What old path is replaced?**
  - Ad hoc raw-model tree import as the assumed production vegetation workflow.
- **What can now be deleted?**
  - Manual per-tree cleanup steps, one-off export checklists, and duplicated runtime interpretation logic once the foliage pipeline is ready.
- **How do we verify this works?**
  - Export smoke tests, import tests, visual parity tests, and large-instance performance scenes.

## Stories

### Story 28.1 — Foliage asset contract in Sugarmagic

**Tasks:**

1. Extend the asset domain so Sugarmagic can represent `assetKind: "foliage"` without creating a second asset-definition system.
2. Define the canonical foliage handoff contract:
   - GLB-first asset shape
   - allowed mesh payloads
   - material slot and texture input expectations
   - which billboard and culling representations are derived by Sugarmagic
   - which foliage settings are runtime-owned by Sugarmagic after import
3. Define which fields are canonical authored import data versus derived runtime projections.
4. Add import validation rules so malformed foliage exports fail clearly.
5. Document the ownership boundary in the relevant domain and IO docs.

**Acceptance:**

- Sugarmagic can distinguish foliage assets from generic model assets.
- One canonical foliage GLB handoff shape is documented and testable.
- Invalid foliage GLB handoffs fail with actionable errors.
- The asset library remains one system with one source of truth.

---

### Story 28.2 — Blender companion tool skeleton

**Tasks:**

1. Create a Sugarmagic-owned Blender add-on package under a deliberate tooling home.
2. Register a panel for tree authoring controls and export actions.
3. Define the persistent authoring object or rig structure used by the tool.
4. Add explicit versioning so exported assets declare which companion-tool version produced them.
5. Add validation reporting in Blender before export.

**Acceptance:**

- The tool installs in supported Blender versions.
- A user can create a new procedural tree authoring object from the tool.
- Export validation can block invalid outputs before files are written.

---

### Story 28.3 — Procedural tree authoring controls

**Tasks:**

1. Implement a first-pass procedural tree generator with exposed controls for:
   - random seed
   - trunk height, width, taper, and displacement
   - branch density, length, spread, and seed
   - secondary branch behavior
   - leaf cluster density, size, spread, and seed
2. Keep the control set intentionally small and stable.
3. Support a handful of presets or preset-like starting configurations.
4. Ensure the generated result can always be converted into realized geometry for export.

**Acceptance:**

- Authors can generate visibly distinct trees from one tool.
- The procedural result is deterministic for a given parameter set.
- The output can be realized and exported without hand-editing the node graph.

---

### Story 28.4 — Sugarmagic export operator

**Tasks:**

1. Add a one-click export operator in Blender.
2. The operator must:
   - validate the authoring object
   - realize instances
   - apply or bake procedural geometry into runtime-safe mesh output
   - export only authored textures and material carriers that naturally fit into a GLB
   - emit one canonical authored GLB without relying on a Blender-owned sidecar manifest
3. Support writing:
   - at least one high-detail mesh
   - embedded or external leaf and bark textures where they are part of the authored truth
4. Make export deterministic so running the same export twice with the same inputs produces stable outputs.
5. Report export warnings when the authored tree exceeds agreed budgets.

**Acceptance:**

- A user can export a tree without manual cleanup in Blender after generation.
- The exported GLB can be inspected outside Blender and remains meaningful.
- The export contract contains no Blender-only runtime dependencies or Blender-defined final material semantics.

---

### Story 28.5 — Sugarmagic foliage import and preview integration

**Tasks:**

1. Teach the import path to ingest exported foliage GLBs and create a canonical foliage asset definition.
2. Make foliage assets visible in the Content Library and available for placement.
3. Ensure authoring preview and runtime preview load foliage assets through the same runtime-owned path.
4. Add fallback and error presentation for missing meshes, textures, or required GLB-authored inputs.
5. Keep foliage placement semantically aligned with the existing scene-placement architecture.

**Acceptance:**

- Exported foliage GLBs import cleanly into Sugarmagic.
- A placed foliage asset appears in Build and Preview through the same runtime path.
- Missing payload pieces fail loudly instead of degrading silently.

---

### Story 28.6 — Runtime foliage optimization path

**Tasks:**

1. Define how foliage assets map to:
   - full mesh
   - billboard or impostor
   - culled state
2. Integrate foliage assets with the billboard system so distant trees do not require full meshes.
3. Add wind metadata interpretation on the runtime side.
4. Ensure placement of many foliage instances uses instancing-friendly semantics where possible.
5. Keep one auditable runtime enforcer for foliage visibility and LOD switching.

**Acceptance:**

- One foliage asset can be placed many times without duplicate runtime behavior code.
- Runtime LOD and billboard switching preserves authored meaning.
- Wind behavior is runtime-owned and does not require Blender logic at runtime.

---

### Story 28.7 — Forest-scale verification

**Tasks:**

1. Add sample exported foliage GLBs for testing.
2. Add import and runtime tests covering:
   - GLB-authored foliage input validation
   - missing texture or mesh failures
   - runtime LOD behavior
   - billboard handoff behavior
3. Build at least one stress scene focused on forest-scale placement.
4. Measure performance at meaningful counts such as:
   - 100 instances
   - 1,000 instances
   - 10,000 instances
5. Record the budgets and pass-fail expectations in the docs.

**Acceptance:**

- The pipeline has repeatable verification, not just visual hope.
- Forest scenes expose whether the bottleneck is import, rendering, or LOD strategy.
- Performance expectations are written down and reviewable.

## QA gates

- [x] Blender companion tool installs and creates a procedural tree authoring object successfully.
- [x] Export produces deterministic, runtime-safe GLB assets.
- [x] Foliage GLBs import into Sugarmagic through the canonical asset system.
- [x] Authoring preview and runtime preview use the same runtime-visible foliage path.
- [x] No exported foliage asset depends on Blender shader nodes, Geometry Nodes, Blender-owned sidecar metadata, or Blender-defined final material semantics at runtime.
- [ ] LOD and billboard behavior are controlled by one Sugarmagic runtime enforcer.
- [ ] Wind or sway behavior is data-driven and runtime-owned.
- [ ] Forest-scale performance tests are run at 100, 1,000, and 10,000 instances.
- [x] All existing tests pass with no regressions.

## Relationship to other plans

- **Plan 006 (Asset Library and Scene Placement)** — this epic extends the canonical asset system instead of inventing a separate vegetation registry.
- **Plan 009 (Landscape Ground Plane and Splatmap)** — this epic provides the foliage asset side of eventual landscape vegetation workflows.
- **Plan 026 (Billboard System)** — foliage LOD and distant tree presentation should build on the billboard foundation rather than bypass it.
