# `packages/shell/src/viewport`

Transient authoring viewport state.

This module owns uncommitted build-viewport drafts and UI hints such as
landscape paint drafts, transform drafts, brush settings, cursor
state, active spatial tool state, and the current authoring-camera
quaternion used by viewport chrome. Committed authored truth remains in
`projectStore`.

Store actions in this module are expected to return fresh nested references
whenever draft contents change. Projection subscribers use one-level shallow
equality, so in-place mutation would bypass the viewport subscription seam.
