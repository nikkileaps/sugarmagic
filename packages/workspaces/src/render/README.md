# Render Workspaces

Render-mode workspaces host runtime-facing visual authoring inside the shared
Sugarmagic shell.

The first canonical Render workspace is the shader graph editor:

- authored truth stays in `ShaderGraphDocument` definitions in the content library
- workspace UI dispatches canonical domain commands
- no editor-only shader document exists outside the shared authoring session
