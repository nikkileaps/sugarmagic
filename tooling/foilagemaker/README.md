<!--
/Users/nikki/projects/sugarmagic/tooling/foilagemaker/README.md

Purpose: Documents the FoilageMaker Blender add-on, its install flow, and the
authoring/export-safe design constraints for the first implementation slice.

Status: active
-->

# FoilageMaker

Current add-on version: `0.12.1`

FoilageMaker is a Sugarmagic-owned Blender add-on for authoring stylized,
export-safe foliage assets.

This first slice is intentionally focused on the Blender side only:

- create a procedural tree object
- expose artist-facing controls in Blender
- rebuild realized mesh geometry when parameters change
- generate canopy clusters and scattered leaf sprays rather than a single leaf card pass
- keep the generated tree compatible with straightforward mesh export

The add-on does **not** make Blender procedural graphs part of Sugarmagic's
runtime. The runtime should consume exported foliage GLBs, not live Blender
semantics.

## Leaf alpha mode: currently overridden in Sugarmagic

Heads-up for anyone touching the export leaf material here: the glTF
`alphaMode` that this add-on produces is **not** the source of truth for
how foliage renders in Sugarmagic today. The Sugarmagic web shader runtime
(`packages/render-web/src/ShaderRuntime.ts`, `applyIRToMaterial`) forces
any shader graph with an opacity output into MASK-mode cutout rendering
(`transparent: false`, `alphaTest: 0.5`, `depthWrite: true`) regardless of
the GLB's authored alphaMode. That's what fixed the "see through the front
leaves to the trunk / inner branches" artifact we were fighting for a
while.

So: keep the CLIP / `alpha_threshold = 0.5` setup in `generator.py` — it
keeps Blender's viewport preview honest and keeps the GLB self-describing
for any future non-Sugarmagic consumer — but don't burn time tuning it
for Sugarmagic rendering. The authoritative knobs for cutout threshold
live in ShaderRuntime, not here.

TODO: revisit once Sugarmagic grows a per-shader alpha-mode control
(BLEND for glass / soft edges, MASK for foliage, OPAQUE for solid). At
that point the GLB's authored alphaMode becomes authoritative again and
FoilageMaker's export material choice starts mattering. Until then, tune
alpha behavior in Sugarmagic's ShaderRuntime, not here.

## Install

1. In Blender, open `Edit > Preferences > Add-ons`.
2. Click `Install...`.
3. Select the `foilagemaker` folder after zipping it, or place the folder into
   Blender's `scripts/addons` directory.
4. Enable the `FoilageMaker` add-on.

## Usage

1. Open the 3D View.
2. Open the sidebar with `N`.
3. Find the `FoilageMaker` tab.
4. Click `Create Tree`.
5. Adjust the tree settings on the selected tree object.
6. Use the built-in presets to switch between clustered stylized, round
   deciduous, and tall pine-ish canopy layouts.
7. Adjust `Scale`, `Width`, and `Height` together when shaping leaf card
   proportions.
8. Use `Export to Sugarmagic` to write a single `.glb`.
9. Use `Validate Tree` or the panel validation summary to catch export blockers
   before writing files.

The generated object is a realized mesh object with:

- a trunk material
- a foliage material
- an optional canopy-guide preview material
- custom metadata marking it as a FoilageMaker tree
- UVs, vertex colors, and custom normals intended to survive export

For local prototype work, the add-on can also build a temporary leaf atlas from
workspace-local reference textures when they exist. The packaged add-on still
falls back to generated textures when those local prototype sources are absent.

## Design notes

- The tree is generated as mesh geometry, not as a runtime dependency on
  Blender Geometry Nodes.
- The parameter set is inspired by stylized procedural tree workflows, but the
  implementation is original to Sugarmagic.
- Export-safe shading inputs are packed into the mesh:
  - `UVMap`
  - `FoilageMakerLeafColor.rgb` for canopy tint variation
  - `FoilageMakerLeafColor.a` for sun/exterior bias
  - custom normals for softer canopy shading
- Runtime-facing metadata stays inside GLB-safe object extras and attributes,
  not a Blender-owned sidecar file.
- Export uses simplified carrier materials so the authored GLB can embed textures
  without making Blender preview materials part of runtime truth.
- Export validation blocks obvious contract failures such as missing UVs,
  missing custom normals, preview canopy guides left enabled, or hard budget
  overruns.
- Wind settings are stored as authoring metadata for future export/runtime use,
  but wind deformation is not yet implemented in this slice.
