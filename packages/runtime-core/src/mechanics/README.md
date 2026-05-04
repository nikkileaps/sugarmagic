# `packages/runtime-core/src/mechanics`

Runtime execution machinery for project-authored mechanics.

`packages/domain` owns the persisted `MechanicsDefinition` shape and JSON
Schema. This module imports that authored shape and provides:

- expression tokenizing, parsing, and evaluation;
- stat carriers for mutable per-actor stat values;
- castable execution for the canonical ops: `consume`, `set`, `branch`, `emit`;
- structural and semantic validation helpers.

The mechanics runtime intentionally knows nothing about spells, dialogue,
audio, targets, React, or Studio. Cross-system behavior leaves through the
executor's opaque `emit(kind, payload)` callback, and the caller decides what
that event means.
