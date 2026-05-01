# `targets/web/src/ui`

Web target implementation of authored screen-space UI primitives.

These components compile domain UI nodes, layout, and theme tokens into React
DOM output. They are target-owned rendering code; Studio reuses them only by
embedding the web target through `bootPreviewSession`.
