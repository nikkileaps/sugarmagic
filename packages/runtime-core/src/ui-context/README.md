# `packages/runtime-core/src/ui-context`

Owns the runtime projection from ECS/game state into the flat
`RuntimeUIContext` consumed by target UI renderers.

This is the single binding-resolution path for authored UI. Targets subscribe
to the store and call `resolveBinding`; they do not read ECS state directly.
