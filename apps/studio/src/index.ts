/**
 * Studio public test surface.
 *
 * Production composition stays in App.tsx. This root export intentionally
 * exposes small pure/imperative seams that package-level tests can exercise
 * without deep-importing through app internals.
 */

export { connectStudioRenderEngineProjector } from "./viewport/RenderEngineProjector";
export { createSurfacePreviewGeometry } from "./viewport/surface-preview-samplers";
export { shouldShowSharedViewport } from "./viewport/viewportVisibility";
