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
export * from "./authoredAssetResolver";
export * from "./engine/WebRenderEngine";
export * from "./environment";
export * from "./landscape";
export * from "./render";
export * from "./renderableFallbacks";
export * from "./renderableTransforms";
export * from "./scatter";
export * from "./view/RenderView";
