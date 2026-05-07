/**
 * VFXEmitter.
 *
 * Simulates one continuous particle emitter for one runtime host. This is the
 * single particle-simulation implementation shared by editor preview and
 * published runtime targets.
 */

import type {
  ParticleEmitterDefinition,
  ParticleEmitterParams,
  VFXColor,
  VFXVector3
} from "@sugarmagic/domain";
import type { RuntimeVFXEmitterSnapshot, RuntimeVFXParticle } from "./types";

interface ParticleState {
  active: boolean;
  ageSeconds: number;
  lifetimeSeconds: number;
  position: VFXVector3;
  velocity: VFXVector3;
}

function cloneVector(value: VFXVector3): VFXVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: VFXColor, b: VFXColor, t: number): VFXColor {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
    a: lerp(a.a, b.a, t)
  };
}

function randomSigned(): number {
  return Math.random() * 2 - 1;
}

function randomLifetime(params: ParticleEmitterParams): number {
  const min = params.lifetimeMinSeconds;
  const max = Math.max(min, params.lifetimeMaxSeconds);
  return min + Math.random() * (max - min);
}

function randomVelocity(params: ParticleEmitterParams): VFXVector3 {
  const coneRadians = (params.spreadConeDegrees * Math.PI) / 180;
  const spread = Math.sin(coneRadians / 2);
  const randomness = params.velocityRandomness;
  return {
    x:
      params.initialVelocity.x +
      randomSigned() * spread * randomness,
    y:
      params.initialVelocity.y +
      randomSigned() * spread * randomness,
    z:
      params.initialVelocity.z +
      randomSigned() * spread * randomness
  };
}

export class VFXEmitter {
  readonly emitterId: string;
  readonly hostId: string;
  readonly definition: ParticleEmitterDefinition;
  renderOrder: number;

  private basePosition: VFXVector3;
  private readonly particles: ParticleState[];
  private emissionAccumulator = 0;

  constructor(options: {
    emitterId: string;
    hostId: string;
    definition: ParticleEmitterDefinition;
    position: VFXVector3;
    renderOrder?: number;
  }) {
    this.emitterId = options.emitterId;
    this.hostId = options.hostId;
    this.definition = options.definition;
    this.renderOrder = options.renderOrder ?? 0;
    this.basePosition = cloneVector(options.position);
    this.particles = Array.from(
      { length: Math.max(1, options.definition.emitter.maxParticles) },
      () => ({
        active: false,
        ageSeconds: 0,
        lifetimeSeconds: 1,
        position: cloneVector(this.basePosition),
        velocity: { x: 0, y: 0, z: 0 }
      })
    );
  }

  setBasePosition(position: VFXVector3): void {
    this.basePosition = cloneVector(position);
  }

  getActiveParticleCount(): number {
    return this.particles.reduce(
      (count, particle) => count + (particle.active ? 1 : 0),
      0
    );
  }

  getPoolSize(): number {
    return this.particles.length;
  }

  shutdown(): void {
    this.emissionAccumulator = 0;
    for (const particle of this.particles) {
      particle.active = false;
    }
  }

  update(deltaSeconds: number): void {
    const params = this.definition.emitter;
    const delta = Math.max(0, Math.min(deltaSeconds, 0.25));
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.ageSeconds += delta;
      if (particle.ageSeconds >= particle.lifetimeSeconds) {
        particle.active = false;
        continue;
      }
      particle.velocity.x += params.gravity.x * delta;
      particle.velocity.y += params.gravity.y * delta;
      particle.velocity.z += params.gravity.z * delta;
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.position.z += particle.velocity.z * delta;
    }

    this.emissionAccumulator += params.emissionRatePerSecond * delta;
    const spawnCount = Math.floor(this.emissionAccumulator);
    this.emissionAccumulator -= spawnCount;
    for (let index = 0; index < spawnCount; index += 1) {
      if (!this.spawnParticle()) {
        break;
      }
    }
  }

  snapshot(): RuntimeVFXEmitterSnapshot {
    const params = this.definition.emitter;
    const particles: RuntimeVFXParticle[] = [];
    for (const particle of this.particles) {
      if (!particle.active) continue;
      const t = Math.max(
        0,
        Math.min(1, particle.ageSeconds / particle.lifetimeSeconds)
      );
      particles.push({
        position: cloneVector(particle.position),
        ageSeconds: particle.ageSeconds,
        lifetimeSeconds: particle.lifetimeSeconds,
        size: lerp(params.sizeStart, params.sizeEnd, t),
        color: lerpColor(params.colorStart, params.colorEnd, t)
      });
    }
    return {
      kind: "particle-emitter",
      emitterId: this.emitterId,
      hostId: this.hostId,
      renderOrder: this.renderOrder,
      definition: this.definition,
      particles
    };
  }

  private spawnParticle(): boolean {
    const particle = this.particles.find((entry) => !entry.active);
    if (!particle) {
      return false;
    }
    particle.active = true;
    particle.ageSeconds = 0;
    particle.lifetimeSeconds = randomLifetime(this.definition.emitter);
    particle.position = cloneVector(this.basePosition);
    particle.velocity = randomVelocity(this.definition.emitter);
    return true;
  }
}
