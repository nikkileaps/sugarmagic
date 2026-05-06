/**
 * Runtime VFX snapshot types.
 *
 * These are Three-free runtime shapes consumed by render targets. Runtime-core
 * owns particle simulation; targets only turn snapshots into platform draws.
 */

import type { VFXDefinition, VFXVector3 } from "@sugarmagic/domain";

export interface RuntimeVFXHost {
  hostId: string;
  definitionId: string;
  position: VFXVector3;
}

export interface RuntimeVFXParticle {
  position: VFXVector3;
  ageSeconds: number;
  lifetimeSeconds: number;
  size: number;
  color: { r: number; g: number; b: number; a: number };
}

export interface RuntimeVFXEmitterSnapshot {
  emitterId: string;
  hostId: string;
  definition: VFXDefinition;
  particles: RuntimeVFXParticle[];
}
