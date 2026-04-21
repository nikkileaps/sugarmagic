# ADR 011: Viewport As Subscriber

## Status

Accepted

## Context

The Studio authoring viewport had accumulated multiple imperative entry points
 (`updateFromRegion`, `previewLandscape`, `paintLandscapeAt`,
`previewTransform`) that all mutated one long-lived render host with partial
 context. That made correctness depend on call ordering instead of canonical
 state, which repeatedly produced parity bugs and stale viewport renders.

Epic 033 replaces that model with shell-owned store state and projection
 selectors. The viewport now observes canonical authored truth and transient
 draft overlays through one subscription path instead of accepting ad hoc
 update calls from React workspaces.

## Decision

Studio-owned viewports are subscribers, not mutation targets.

- Canonical authored truth lives in `projectStore` / `shellStore`.
- Transient authoring overlays live in dedicated shell stores such as
  `viewportStore` and `designPreviewStore`.
- The viewport mounts, subscribes to a projection of those stores, and applies
  the resulting projection exactly once per store change.
- Workspace chrome dispatches store actions or domain commands; it does not
  imperatively push render-state payloads into a viewport.

Public viewport interfaces must not expose imperative state-mutation methods
 such as `updateFrom*`, `preview*`, `paint*`, or `render*Mask`.

## Consequences

Good:

- One update path for authored viewport state.
- Landscape and transform drafts become explicit shell state instead of
  invisible side channels.
- The authoring viewport can be reasoned about as a pure consumer of store
  state.

Tradeoffs:

- More shell-level store surface area.
- Some viewport-owned interaction controllers now live behind internal overlay
  seams instead of direct workspace refs.

## Verification

- `packages/workspaces/src/viewport.ts` no longer exposes the old imperative
  authoring mutation methods.
- `tooling/check-viewport-imperative.mjs` fails CI if those methods reappear.
- `packages/testing/src/viewport-projection.test.ts` verifies the combined
  projection path over shell stores.
