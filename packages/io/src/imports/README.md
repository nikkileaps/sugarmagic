# Import Boundary

This module owns Studio-side source-file import into the project game root.

Permanent responsibilities:
- prompt for source files
- prompt for texture-set folders when the import contract is folder-shaped
- validate import-time contracts (for example FoilageMaker GLB requirements)
- copy imported bytes into the authored `assets/` tree
- construct the first canonical content-library definitions for imported assets and textures

Non-responsibilities:
- it does not own domain normalization after load
- it does not own runtime material resolution
- it does not own render-web GPU binding

Relationship to Epic 032:
- GLB material-slot discovery lives here because the source file is the authority
  for which slots exist.
- FoliageMaker embedded GLB textures are extracted here into explicit
  `TextureDefinition` + `MaterialDefinition` records so fresh foliage imports do
  not depend on carrier-material runtime fallbacks.
- Texture import lives here because this is the canonical file-copy boundary.
- PBR texture-set discovery also lives here because filename inference is an
  import-time concern, not a runtime/material-resolution concern.
- The resulting `AssetDefinition`, `TextureDefinition`, and `MaterialDefinition`
  become content-library truth immediately after import.
