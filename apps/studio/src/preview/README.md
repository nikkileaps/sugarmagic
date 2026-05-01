# `apps/studio/src/preview`

Studio preview adapters that embed runtime targets.

`UIPreviewSession` is the Plan 039 UI-authoring preview bridge. It imports the
web target root entry point, boots a target-owned preview session, supplies
sample runtime UI context, and owns disposal.
