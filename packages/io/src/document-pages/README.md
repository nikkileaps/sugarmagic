# `packages/io/src/document-pages`

Owns managed-file writes for image-backed document pages.

Document page images are project files stored under
`assets/documents/<documentId>/`, referenced by `DocumentDefinition.imagePages`,
and resolved through the asset-source map. They are not content-library texture
entries and should not appear in library browsers.
