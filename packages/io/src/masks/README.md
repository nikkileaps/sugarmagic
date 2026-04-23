# `packages/io/src/masks`

Canonical browser-side file IO helpers for painted mask textures.

This module owns creating, reading, and writing the PNG files referenced by
`MaskTextureDefinition`. It keeps mask pixels on disk as authored project
files instead of embedding them in the serialized project document.
