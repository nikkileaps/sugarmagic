/**
 * VFX render-web tests.
 *
 * Guards the renderer contract without requiring a live WebGPU device.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createDefaultVFXDefinition } from "@sugarmagic/domain";
import { InstancedParticleRenderer } from "@sugarmagic/render-web";

describe("InstancedParticleRenderer", () => {
  it("allocates one instanced mesh per VFX definition and reuses it across frames", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const definition = createDefaultVFXDefinition({
      definitionId: "vfx:test",
      maxParticles: 4
    });
    const renderer = new InstancedParticleRenderer(scene);
    const snapshot: import("@sugarmagic/runtime-core").RuntimeVFXEmitterSnapshot = {
      kind: "particle-emitter",
      emitterId: "emitter",
      hostId: "host",
      renderOrder: 0,
      definition,
      particles: [
        {
          position: { x: 0, y: 0, z: 0 },
          ageSeconds: 0,
          lifetimeSeconds: 1,
          size: 0.2,
          color: { r: 1, g: 0.5, b: 0, a: 1 }
        }
      ]
    };

    renderer.sync([snapshot], camera);
    const firstMesh = scene.children[0];
    renderer.sync([{ ...snapshot, particles: [...snapshot.particles] }], camera);

    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(firstMesh);
    expect((scene.children[0] as THREE.InstancedMesh).count).toBe(1);
    const geometry = (scene.children[0] as THREE.InstancedMesh).geometry;
    const particleColor = geometry.getAttribute("particleColor");
    const particleOpacity = geometry.getAttribute("particleOpacity");
    expect(particleColor).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(particleOpacity).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(particleColor.getX(0)).toBeCloseTo(1);
    expect(particleColor.getY(0)).toBeCloseTo(0.5);
    expect(particleColor.getZ(0)).toBeCloseTo(0);
    expect(particleOpacity.getX(0)).toBeCloseTo(1);

    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
