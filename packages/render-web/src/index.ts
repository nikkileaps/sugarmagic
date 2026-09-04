/**
 * Web rendering host exports.
 *
 * Owns shared Three/WebGPU host helpers that both Studio and published web
 * targets consume. This package is the single web-rendering bridge; apps and
 * targets should not depend on each other for runtime rendering behavior.
 */

export * from "./ShaderRuntime";
export * from "./applyShaderToRenderable";
export * from "./asset-scatter";
export * from "./asset-surface-bake";
export * from "./instanced-group";
export * from "./renderable-reconciler";
export { sampleMeshTrianglesForDensity } from "./mesh-triangle-sampler";
// The effect materializer, exported so its parameter reading can be tested
// against real TSL nodes. It once silently ignored every authored bloom value
// because it looked for the number in the wrong place on the node, and nothing
// could catch that without building a genuine literal.
export { materializeEffectOp } from "./materialize/effect";
export type {
  EffectMaterializeContext,
  MaterializeOpRequest
} from "./materialize/types";
export {
  registerLivePaintedMask,
  sampleLivePaintedMask,
  clearLivePaintedMasks
} from "./painted-mask-live";
export * from "./authoredAssetResolver";
export * from "./billboard";
export * from "./captureFrame";
export * from "./engine/WebRenderEngine";
export * from "./environment";
export * from "./landscape";
export * from "./placed-lights";
export * from "./render";
export * from "./renderableFallbacks";
export * from "./renderableTransforms";
export * from "./colliderBounds";
export * from "./scatter";
export * from "./view/RenderView";
