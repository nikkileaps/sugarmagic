# `packages/runtime-core/src/ui-actions`

Owns the runtime action registry for authored UI events.

Authored UI emits string-keyed action expressions such as `start-new-game`.
Runtime hosts register handlers here, keeping documents free of JavaScript and
target-specific callbacks.
