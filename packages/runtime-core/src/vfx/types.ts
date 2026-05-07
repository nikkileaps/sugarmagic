/**
 * Runtime VFX snapshot types.
 *
 * Three-free runtime shapes consumed by render targets. Runtime-core owns
 * any per-frame simulation; targets only turn snapshots into platform draws.
 *
 * Each VFX kind has its own snapshot variant. Snapshots are tagged-union so
 * the renderer registry can dispatch by `kind` without narrowing tricks.
 */

import type {
  ParticleEmitterDefinition,
  PointLightDefinition,
  RibbonStreamerDefinition,
  ShaderBillboardDefinition,
  VFXVector3
} from "@sugarmagic/domain";

export interface RuntimeVFXHost {
  hostId: string;
  definitionId: string;
  position: VFXVector3;
  /** Higher-level binding/spawn render order; renderers honor this within the transparent pass. */
  renderOrder: number;
}

export interface RuntimeVFXParticle {
  position: VFXVector3;
  ageSeconds: number;
  lifetimeSeconds: number;
  size: number;
  color: { r: number; g: number; b: number; a: number };
}

export interface RuntimeVFXEmitterSnapshot {
  kind: "particle-emitter";
  emitterId: string;
  hostId: string;
  renderOrder: number;
  definition: ParticleEmitterDefinition;
  particles: RuntimeVFXParticle[];
}

export interface RuntimeVFXShaderBillboardSnapshot {
  kind: "shader-billboard";
  bindingKey: string;
  hostId: string;
  renderOrder: number;
  definition: ShaderBillboardDefinition;
  position: VFXVector3;
}

export interface RuntimeVFXRibbonStreamerSnapshot {
  kind: "ribbon-streamer";
  bindingKey: string;
  hostId: string;
  renderOrder: number;
  definition: RibbonStreamerDefinition;
  position: VFXVector3;
}

export interface RuntimeVFXPointLightSnapshot {
  kind: "point-light";
  bindingKey: string;
  hostId: string;
  /** Inert for lights — Three's forward lighting doesn't participate in the transparent pass — but kept for shape consistency. */
  renderOrder: number;
  definition: PointLightDefinition;
  position: VFXVector3;
}

export type RuntimeVFXSnapshot =
  | RuntimeVFXEmitterSnapshot
  | RuntimeVFXShaderBillboardSnapshot
  | RuntimeVFXRibbonStreamerSnapshot
  | RuntimeVFXPointLightSnapshot;
