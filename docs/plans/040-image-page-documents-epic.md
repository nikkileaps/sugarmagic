# Plan 040: Image-Page Documents Epic

**Status:** Implemented
**Date:** 2026-05-01

## Epic

### Title

Image-backed readable documents — author a multi-page in-game
"PDF" by importing PNG/JPG page images into a Document, then
bind any Item to it. The runtime reader paginates through the
images with arrow keys, zoom, and pan. No PDF parsing, no new
runtime dependency; the user bakes their PDF to images outside
Sugarmagic and treats the document as a sequence of page assets.

### Goal

- **One new `DocumentTemplate` value:** `"image-pages"`. Joins
  the existing `book | newspaper | letter | postcard | flyer |
  sign | plaque` enum.
- **One new field on `DocumentDefinition`:** `imagePages: string[]`
  — relative paths to managed page-image files. Empty for all
  other templates. Stays empty on legacy documents.
- **Document-owned managed files,** not library entries. Page
  images live at `assets/documents/<documentId>/page-N.png` and
  do **not** appear in the texture browser or any other library
  surface. Same managed-file pattern as masks
  (`writeMaskFile`) and item thumbnails (`writeItemThumbnailFile`).
- **Authoring UI on the Document inspector** — when template is
  `"image-pages"`, a Pages panel appears: ordered list of page
  thumbnails with add / remove / reorder. "Add Page…" opens a raw
  file picker, writes the PNG to the document's folder, appends
  the path to `imagePages`.
- **Runtime reader branch in `documentReaderUi`** — when the
  bound document has `template === "image-pages"`, render
  `<img>` per page with prev/next + arrow-key pagination, page
  indicator, mouse-wheel zoom (1×–4×), drag-to-pan when zoomed,
  ESC to close.
- **Item binding unchanged.** Items already reference documents
  via `interactionView.documentDefinitionId`. Whether the bound
  document renders text or images is the document's concern.

### Why this epic exists

Sugarengine had readable items backed by image-page sequences —
authors exported a PDF to PNG pages, dropped them in
`assets/items/<item>/`, and the inventory reader paginated
through them with arrow keys + zoom/pan. The system was
deliberately simple: no pdf.js, no PDF parsing at runtime, just
images. This epic ports that capability — the user-facing feature,
not the legacy code — to Sugarmagic's current document /
managed-file architecture.

Today Sugarmagic's `DocumentDefinition` is text-only: `body`,
`pages: string[]` (text), `sections`, `headings`. Templates
control HTML formatting. The newspaper template renders an
authored body as HTML — useful for short copy, useless for
content the author wants to lay out themselves (a real
newspaper page, a comic panel, a hand-drawn map, a scan of a
diary). Image-page documents close that gap with the simplest
possible mechanism.

### Goal-line test

After 040 lands:

- A game designer in Studio creates a Document, sets Template
  to `Image Pages`, clicks Add Page, picks a PNG, picks another
  PNG. The pages appear as thumbnails in the inspector with
  drag handles to reorder.
- They create an Item, set Interaction View → Readable, bind
  the Document.
- They place the item in a region.
- In the running game: pick up the item → press `I` → click
  the item → reader opens to page 1 → arrow keys flip pages →
  scroll wheel zooms in → drag pans → ESC closes.
- Page-image files exist on disk under
  `assets/documents/<documentId>/`, are NOT visible in the
  texture browser, and travel with the project file (paths
  serialized in `imagePages`).
- Existing text-based documents (book, newspaper, etc.) keep
  rendering exactly as before — the change is additive.

## Scope

### In scope

- **Domain:** add `"image-pages"` to `DocumentTemplate` union;
  add `imagePages: string[]` to `DocumentDefinition`; default
  `[]` in factory and normalizer.
- **IO:** new `packages/io/src/document-pages/index.ts` exporting
  `writeDocumentPageFile(handle, documentDefinitionId, blob):
  Promise<string>` — writes to
  `assets/documents/<sanitizedDocId>/page-<n>.png`, returns the
  relative path. Sanitization mirrors `writeItemThumbnailFile`.
- **Asset sources:** extend `collectRelativeAssetPaths` in
  `packages/shell/src/asset-sources/index.ts` to also enumerate
  every `gameProject.documentDefinitions[].imagePages` entry, so
  the runtime gets blob URLs alongside other assets.
- **Document inspector** (`packages/workspaces/src/design/DocumentWorkspaceView.tsx`):
  - Add `"Image Pages"` to the template dropdown.
  - When template is `"image-pages"`: hide the existing text
    fields (body, sections, text-pages, etc.) and show a Pages
    panel with: ordered list of page entries (thumbnail +
    page number + remove button), drag-handle reorder via the
    existing `SortableList` component, "Add Page…" button that
    opens a file picker and dispatches an
    `UpdateDocumentDefinition` command with the new path
    appended.
- **App.tsx wiring:** new handler `handleAppendDocumentPage(documentId,
  blob): Promise<string | null>` — calls
  `writeDocumentPageFile`, then `assetSourceStore.refreshPaths`
  to mint a fresh blob URL for the new file. Threaded through
  workspaces props the same way `onGenerateItemThumbnail` is.
- **Runtime reader** (`packages/runtime-core/src/document/`):
  add an image-pages branch to `renderDocumentDefinitionHtml`
  (or factor into its own renderer for clarity). Pagination
  state, arrow-key handlers, zoom (CSS `transform: scale`),
  pan (mouse-down + mousemove deltas applied to translate when
  scale > 1), ESC close. Resolves `imagePages` paths through
  the existing `getAssetUrl`-style mechanism the inventory UI
  already uses.
- **Tests:**
  - Domain round-trip for the new template + field.
  - Normalizer drops nothing on legacy documents (defaults to
    `[]`).
  - IO test that `writeDocumentPageFile` writes to the expected
    path and returns the relative-path string.
  - Inventory integration test: create item bound to image-pages
    document, click in inventory, verify reader opens with
    correct pages.

### Out of scope

- **True PDF embed via pdf.js or similar.** Heavier dep, more
  failure modes, breaks portability to non-browser targets.
  Image-pages covers the use case at lower cost. Add later only
  if "bake PDF to images outside Sugarmagic" becomes painful in
  practice.
- **Search/text-selection within pages.** Image pages are images;
  no text extraction. If needed later, that's the trigger to
  reconsider real PDF.
- **Removing orphan files on disk when a page is deleted from
  `imagePages`.** v1 leaves orphaned PNGs in the document folder.
  Reversible (no broken state), low impact (small file sizes).
  If it accumulates, a future "tidy project" tool can sweep
  orphans across all managed-file folders at once.
- **Per-page metadata** (captions, anchor links, alt text). Image
  pages are visual; text fields belong on text templates.
- **Sharing the same page file across multiple documents.** Each
  document owns its folder. If you want the same image in two
  documents, import it twice. Rare enough to not warrant
  complicating the model.
- **NPC/Player thumbnail-style override field** on the
  ItemDefinition for "use this image as the inventory icon
  instead of the auto-generated thumbnail" — orthogonal feature,
  separate consideration.

## Shape sketch

```
Domain
  DocumentTemplate = "book" | "newspaper" | … | "image-pages"   (NEW value)
  DocumentDefinition {
    …existing…
    imagePages: string[]   (NEW; default [])
  }

Project file
  assets/
    documents/
      <documentId>/
        page-1.png
        page-2.png
        page-3.png

IO
  writeDocumentPageFile(handle, docId, blob) -> "assets/documents/<docId>/page-N.png"

Studio asset-source store
  collectRelativeAssetPaths(...)
    + paths from gameProject.documentDefinitions[].imagePages

Document inspector
  template: [book|newspaper|…|image-pages] dropdown
  if image-pages:
    Pages
      [thumb] page 1  [×]
      [thumb] page 2  [×]
      [thumb] page 3  [×]
      [Add Page…]

Runtime reader (when bound document.template === "image-pages")
  ┌──────────────────────────────┐
  │  ◀  Page 3 / 12  ▶   1.5×   │
  │                              │
  │      [page image]            │
  │                              │
  └──────────────────────────────┘
  arrow keys: prev/next page
  wheel: zoom 1×–4×
  drag (when zoomed): pan
  ESC: close
```

## Stories

### 40.1 — Domain types + IO helper

- Extend `DocumentTemplate` union with `"image-pages"`.
- Add `imagePages: string[]` to `DocumentDefinition`.
- Update factory + normalizer (default `[]`, drop nothing on
  legacy).
- Add `writeDocumentPageFile` in `packages/io/src/document-pages/`.
- Round-trip + normalizer tests.

**Files touched:**
- `packages/domain/src/document-definition/index.ts`
- `packages/io/src/document-pages/index.ts` (new)
- `packages/io/src/index.ts` (re-export)
- `packages/testing/src/document-definition.test.ts` (add cases)

### 40.2 — Asset-source enumeration

- Extend `collectRelativeAssetPaths` to include every
  `gameProject.documentDefinitions[].imagePages` entry.
- Verify legacy projects (no image-pages docs) still produce
  identical asset-source maps.

**Files touched:**
- `packages/shell/src/asset-sources/index.ts`
- `packages/testing/src/asset-source-store.test.ts` (add case)

### 40.3 — Document inspector UI

- Add `"Image Pages"` to the template dropdown.
- Hide text-authoring fields when template is `"image-pages"`.
- Render the Pages panel: ordered list with thumbnails (resolved
  via `assetSources`), reorder via `SortableList`, remove button.
- "Add Page…" button: file picker → `handleAppendDocumentPage`
  → `UpdateDocumentDefinition` command with `imagePages`
  appended.
- Wire `onAppendDocumentPage` callback through
  `useDesignProductModeView` props the same way
  `onGenerateItemThumbnail` is.

**Files touched:**
- `packages/workspaces/src/design/DocumentWorkspaceView.tsx`
- `packages/workspaces/src/design/index.tsx` (props plumbing)
- `apps/studio/src/App.tsx` (handler + wiring)

### 40.4 — Runtime reader branch

- Add image-pages renderer to
  `packages/runtime-core/src/document/index.ts` (or sibling
  module). Resolves `imagePages` paths through the same
  `getAssetUrl` callback already used by the inventory UI for
  thumbnails.
- Pagination state owned by the renderer, not the document.
- Arrow keys + wheel zoom + drag pan event handlers on the
  reader's root container; teardown on close.
- Inventory integration test: bind item to image-pages document,
  open it via inventory, assert correct page renders.

**Files touched:**
- `packages/runtime-core/src/document/index.ts`
- `packages/runtime-core/src/document/index.css` (or styles
  block) — page container, zoom transform, pan behavior
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (pass `getAssetUrl` to documentReaderUi if not already
  threaded — verify before this story starts)
- `packages/testing/src/inventory-document-flow.test.ts` (new
  or extended)

## Success criteria

- All `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
- The Goal-line test flow works end-to-end in a real Studio
  session: create document → import 3 PNG pages → bind to item
  → place in region → start game → pick up → open inventory →
  click → reader paginates correctly.
- `assets/documents/<docId>/page-N.png` files exist on disk
  with the expected names.
- Texture browser (Asset Sources panel) does NOT show
  document page images.
- Existing text-based documents (book, newspaper, etc.) render
  identically to before.
- A document switched from `image-pages` back to a text template
  keeps its `imagePages` data on disk and in the JSON (the
  field is preserved; it's just not rendered until you switch
  back).

## Risks

1. **Per-document file orphans accumulate over time.** Removing
   a page from `imagePages` doesn't delete the PNG. Reversible
   and harmless, but the `assets/documents/` tree grows
   monotonically. Mitigation: defer until the first complaint;
   a sweep tool addresses this category broadly (also covers
   orphan thumbnails, masks, etc.).
2. **Large multi-page documents bloat the asset-source map.**
   A 30-page comic at 2 MB/page = 60 MB of blob URLs minted on
   project load. Today's image-import path doesn't lazy-load.
   Mitigation: monitor; if it bites, add lazy resolution for
   document pages specifically (load on first render, not on
   project open).
3. **Page reorder during a live session.** If the reader is open
   when the user reorders pages in the inspector, the reader's
   page-index could point to a different page mid-read. Likely
   rare (preview vs runtime are different windows usually) but
   worth a guard: if `imagePages` array length or contents
   change while the reader is open, reset to page 1.
4. **Image-pages template chosen but no pages added.** Reader
   should render an "empty document" placeholder, not crash.
   Cover with an explicit branch + test.

## Builds on

- **037 (Library-First Content Model)** — managed-file pattern
  for masks established the precedent we're extending.
- **038 (Animation Library / entity-owned content)** — the same
  separation between "library kinds" and "entity-owned managed
  files" applies here: page images are document-owned, not
  library-browsed.
- **Item Thumbnails work (this conversation)** — the asset-source
  enumeration extension for non-library managed files is the
  exact pattern we just shipped for `thumbnailAssetPath`. This
  epic re-uses it for `imagePages`.
