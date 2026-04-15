/**
 * Web rendering host exports.
 *
 * Owns shared Three/WebGPU host helpers that both Studio and published web
 * targets consume. This package is the single web-rendering bridge; apps and
 * targets should not depend on each other for runtime rendering behavior.
 */

export * from "./ShaderRuntime";
export * from "./applyShaderToRenderable";
export * from "./environment";
export * from "./host";
export * from "./render";
