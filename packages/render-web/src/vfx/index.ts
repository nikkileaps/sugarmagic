/**
 * Render-web VFX exports.
 *
 * Contains Three/WebGPU realization of runtime-core VFX snapshots. This
 * package does not own simulation; runtime-core does.
 *
 * VFXRendererRegistry is the public seam — Studio and runtime targets
 * construct one of these per scene and feed it RuntimeVFXSnapshot[] each
 * frame. The per-kind renderers (particle / billboard / streamer / light)
 * are exported for testing but call sites should prefer the registry.
 */

export * from "./InstancedParticleRenderer";
export * from "./LightVFXRenderer";
export * from "./RibbonStreamerRenderer";
export * from "./ShaderBillboardRenderer";
export * from "./VFXRendererRegistry";
export * from "./particleMaterial";
