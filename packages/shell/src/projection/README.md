# `packages/shell/src/projection`

Derived viewport projection helpers.

This module combines the shell stores into the single projection shapes
consumed by the Studio viewports. It is the subscription seam between
canonical shell state and viewport rendering.

Projection listeners use a one-level `shallowEqual` helper. Nested arrays and
objects inside a slice are therefore compared by reference, not by deep value.
Store actions feeding projection state must publish fresh nested references on
every real semantic change rather than mutating in place.
