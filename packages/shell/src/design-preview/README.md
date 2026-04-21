# `packages/shell/src/design-preview`

Preview-only shell state for the Player / NPC / Item workspaces.

This module owns animation-slot selection, play/pause, and camera
framing so both React chrome and viewport subscribers can observe one
canonical preview configuration. Redundant camera-framing writes are
ignored here so preview inspectors do not re-render on every idle frame.
