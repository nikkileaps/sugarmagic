# Blender Material Slot Naming for Sugarmagic

Sugarmagic treats the imported glTF material-slot list as the source of truth
for which mesh slots exist on an asset.

## Rule

Name material slots intentionally in Blender before exporting the GLB.

Studio uses the imported glTF material **name** as the stable match key for
asset-slot bindings. The numeric slot index is display-only.

## Why

- Reordering materials in Blender can change slot indices.
- Names are the only reimport-stable identifier authors control.
- Sugarmagic does **not** let Studio create or delete mesh slots. Blender is
  the authority for slot existence.

## Good examples

- `Wall_Brick`
- `Roof_Tile`
- `Trim_Bronze`
- `Glass_Window`

## Avoid

- Blender defaults like `Material`, `Material.001`, `Material.002`
- renaming slots mid-project unless you are willing to rebind them in Studio

## Reimport behavior

When you reimport a GLB:

- slots with the same name keep their bound Sugarmagic material
- new slot names appear unbound
- removed slot names disappear
- renamed slot names are treated as remove + add, so the old binding is lost

## Practical workflow

1. Name the Blender materials first.
2. Export the GLB.
3. Import into Sugarmagic.
4. Bind each imported slot to a Material from the Material Library.
5. If you must rename a slot later, reimport and rebind it in Studio.
