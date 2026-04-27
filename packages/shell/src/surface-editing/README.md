# `shell/src/surface-editing`

Shell-level editor state for the Surface Library workspace.

This module owns only transient UI state:

- which `SurfaceDefinition` is currently being edited
- which preview primitive is active (`plane` / `cube` / `sphere`)

It is not authored truth and it is not render-web state. It exists so the
Surface Library chrome and the Studio preview viewport can observe one
canonical editor-side configuration without inventing ad hoc local state in
multiple components.
