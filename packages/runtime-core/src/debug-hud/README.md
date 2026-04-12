/Users/nikki/projects/sugarmagic/packages/runtime-core/src/debug-hud/README.md

Purpose: Documents the Preview-only runtime debug HUD module.

This module owns the compact DOM debug HUD shown over the Preview viewport in
Studio. It is the single runtime UI surface for:

- built-in renderer and world debug cards
- plugin-contributed HUD cards
- the debug billboard visibility controller

It does not own world truth. Gameplay-session remains the source of truth for
debuggable runtime state and debug billboard entities. The HUD only reads typed
snapshots and toggles the single debug billboard controller state.
