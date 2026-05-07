/**
 * VFX particle material.
 *
 * Builds the WebGPU node material used by the instanced particle renderer.
 * Runtime-core supplies particle color/opacity attributes; render-web owns
 * the concrete Three/TSL material.
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { abs, attribute, length, max, smoothstep, uv, vec2 } from "three/tsl";
import type { ParticleEmitterDefinition } from "@sugarmagic/domain";

interface ScalarNodeLike {
  mul: (other: unknown) => unknown;
}

interface Vec2NodeLike {
  x: unknown;
  y: unknown;
  sub: (other: unknown) => Vec2NodeLike;
}

export function createParticleMaterial(
  definition: ParticleEmitterDefinition
): MeshBasicNodeMaterial {
  const params = definition.emitter;
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending:
      params.blendMode === "additive"
        ? THREE.AdditiveBlending
        : THREE.NormalBlending
  });
  material.colorNode = attribute("particleColor", "vec3") as never;

  // Shape mask: feathered alpha falloff keyed off the plane's UVs. Without
  // this the particle is an opaque square (every pixel solid) and the effect
  // reads as stacked blocks rather than a soft glow. Mirrors sugarengine's
  // ParticleSpriteTextures radial-gradient sprites; done procedurally in TSL.
  const offset = (uv() as unknown as Vec2NodeLike).sub(vec2(0.5, 0.5));
  const radial = length(offset as never);
  const boxDist = max(abs(offset.x as never), abs(offset.y as never));
  const dist = params.shape === "square" ? boxDist : radial;
  const shapeAlpha = smoothstep(0.5, 0.0, dist as never);
  const opacityAttr = attribute(
    "particleOpacity",
    "float"
  ) as unknown as ScalarNodeLike;
  material.opacityNode = opacityAttr.mul(shapeAlpha) as never;
  return material;
}
