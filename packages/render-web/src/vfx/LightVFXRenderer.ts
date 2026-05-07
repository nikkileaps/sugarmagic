/**
 * LightVFXRenderer.
 *
 * Realizes RuntimeVFXPointLightSnapshot entries as THREE.PointLight instances
 * in the scene's existing forward-lighting pass. No transparent-pass
 * participation; renderOrder is inert for this kind.
 *
 * If pulseRate is set on the definition, intensity is modulated each frame
 * via baseIntensity * (1 + pulseAmount * sin(time * 2π * pulseRate)).
 */

import * as THREE from "three";
import type { RuntimeVFXPointLightSnapshot } from "@sugarmagic/runtime-core";

interface LightEntry {
  light: THREE.PointLight;
  baseIntensity: number;
  pulseRate: number;
  pulseAmount: number;
}

export class LightVFXRenderer {
  private readonly scene: THREE.Scene;
  private readonly lights = new Map<string, LightEntry>();
  private readonly startedAt = performance.now();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(
    snapshots: RuntimeVFXPointLightSnapshot[],
    _camera: THREE.Camera | null
  ): void {
    void _camera; // lights don't need camera; signature matches the registry contract
    const liveKeys = new Set(snapshots.map((s) => s.bindingKey));

    for (const [bindingKey, entry] of this.lights.entries()) {
      if (!liveKeys.has(bindingKey)) {
        this.scene.remove(entry.light);
        entry.light.dispose();
        this.lights.delete(bindingKey);
      }
    }

    const elapsedSeconds = (performance.now() - this.startedAt) / 1000;

    for (const snapshot of snapshots) {
      const params = snapshot.definition.light;
      const colorHex =
        (Math.round(params.color.r * 255) << 16) |
        (Math.round(params.color.g * 255) << 8) |
        Math.round(params.color.b * 255);
      let entry = this.lights.get(snapshot.bindingKey);
      if (!entry) {
        const light = new THREE.PointLight(
          colorHex,
          params.intensity,
          params.distance,
          params.decay
        );
        light.position.set(
          snapshot.position.x,
          snapshot.position.y,
          snapshot.position.z
        );
        this.scene.add(light);
        entry = {
          light,
          baseIntensity: params.intensity,
          pulseRate: params.pulseRate ?? 0,
          pulseAmount: params.pulseAmount ?? 0
        };
        this.lights.set(snapshot.bindingKey, entry);
        // eslint-disable-next-line no-console
        console.info(
          `[VFX point-light] mounted ${snapshot.definition.displayName} (${snapshot.bindingKey}) at`,
          snapshot.position
        );
      } else {
        entry.light.color.setHex(colorHex);
        entry.light.distance = params.distance;
        entry.light.decay = params.decay;
        entry.light.position.set(
          snapshot.position.x,
          snapshot.position.y,
          snapshot.position.z
        );
        entry.baseIntensity = params.intensity;
        entry.pulseRate = params.pulseRate ?? 0;
        entry.pulseAmount = params.pulseAmount ?? 0;
      }

      if (entry.pulseRate > 0 && entry.pulseAmount > 0) {
        const oscillation = Math.sin(
          elapsedSeconds * 2 * Math.PI * entry.pulseRate
        );
        entry.light.intensity =
          entry.baseIntensity * (1 + entry.pulseAmount * oscillation);
      } else {
        entry.light.intensity = entry.baseIntensity;
      }
    }
  }

  dispose(): void {
    for (const entry of this.lights.values()) {
      this.scene.remove(entry.light);
      entry.light.dispose();
    }
    this.lights.clear();
  }
}
