Surface editors for Build mode.

This folder owns the domain-aware authoring UI for `SurfaceBinding` and
`SurfaceDefinition`. It composes generic widgets from `@sugarmagic/ui` but
keeps all Sugarmagic-specific layer, mask, material, and scatter knowledge in
the workspaces package instead of leaking domain types into the shared UI
package. Layer-row mask editing is driven from a thumbnail popover in the
stack, while the shared `MaskEditor` remains the single editor for authored
mask settings.
