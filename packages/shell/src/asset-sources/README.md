# `packages/shell/src/asset-sources`

Shell-level owner of Studio asset-source URL resolution.

This module turns authored `relativeAssetPath` references from the
content library into fetchable blob URLs for the editor/runtime web
loaders. It is derived state, not authored truth.

Starting the store for a new project invalidates all previously served
blob URLs before the next sync so overlapping relative paths cannot
accidentally keep serving bytes from the old project handle.
