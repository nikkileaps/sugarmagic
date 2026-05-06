/**
 * InstancedParticleRenderer.
 *
 * Realizes runtime-core VFX emitter snapshots as one InstancedMesh per active
 * VFX definition. The renderer owns Three resources only; simulation remains
 * in runtime-core.
 */

import * as THREE from "three";
import type { RuntimeVFXEmitterSnapshot } from "@sugarmagic/runtime-core";
import { createParticleMaterial } from "./particleMaterial";

interface DefinitionBatch {
  mesh: THREE.InstancedMesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.Material;
  capacity: number;
  particleColor: THREE.InstancedBufferAttribute;
  particleOpacity: THREE.InstancedBufferAttribute;
}

function createBatch(snapshot: RuntimeVFXEmitterSnapshot, capacity: number): DefinitionBatch {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const particleColor = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity * 3),
    3
  );
  const particleOpacity = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity),
    1
  );
  geometry.setAttribute("particleColor", particleColor);
  geometry.setAttribute("particleOpacity", particleOpacity);
  const material = createParticleMaterial(snapshot.definition);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = `vfx:${snapshot.definition.definitionId}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleColor.setUsage(THREE.DynamicDrawUsage);
  particleOpacity.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  return { mesh, geometry, material, capacity, particleColor, particleOpacity };
}

export class InstancedParticleRenderer {
  private readonly scene: THREE.Scene;
  private readonly batches = new Map<string, DefinitionBatch>();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(
    snapshots: RuntimeVFXEmitterSnapshot[],
    camera: THREE.Camera | null
  ): void {
    const grouped = new Map<string, RuntimeVFXEmitterSnapshot[]>();
    for (const snapshot of snapshots) {
      const entries = grouped.get(snapshot.definition.definitionId) ?? [];
      entries.push(snapshot);
      grouped.set(snapshot.definition.definitionId, entries);
    }

    for (const [definitionId, batch] of this.batches.entries()) {
      if (!grouped.has(definitionId)) {
        this.scene.remove(batch.mesh);
        this.disposeBatch(batch);
        this.batches.delete(definitionId);
      }
    }

    const billboardRotation = camera?.quaternion ?? new THREE.Quaternion();
    for (const [definitionId, entries] of grouped.entries()) {
      const requestedCapacity = Math.max(
        1,
        entries.reduce(
          (total, entry) => total + entry.definition.maxParticles,
          0
        )
      );
      let batch = this.batches.get(definitionId);
      if (!batch || batch.capacity < requestedCapacity) {
        if (batch) {
          this.scene.remove(batch.mesh);
          this.disposeBatch(batch);
        }
        batch = createBatch(entries[0]!, requestedCapacity);
        this.batches.set(definitionId, batch);
        this.scene.add(batch.mesh);
      }

      let instanceIndex = 0;
      for (const entry of entries) {
        for (const particle of entry.particles) {
          if (instanceIndex >= batch.capacity) break;
          this.scale.set(particle.size, particle.size, particle.size);
          this.matrix.compose(
            new THREE.Vector3(
              particle.position.x,
              particle.position.y,
              particle.position.z
            ),
            billboardRotation,
            this.scale
          );
          batch.mesh.setMatrixAt(instanceIndex, this.matrix);
          batch.particleColor.setXYZ(
            instanceIndex,
            particle.color.r,
            particle.color.g,
            particle.color.b
          );
          batch.particleOpacity.setX(instanceIndex, particle.color.a);
          instanceIndex += 1;
        }
      }
      batch.mesh.count = instanceIndex;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.particleColor.needsUpdate = true;
      batch.particleOpacity.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      this.disposeBatch(batch);
    }
    this.batches.clear();
  }

  private disposeBatch(batch: DefinitionBatch): void {
    batch.geometry.dispose();
    batch.material.dispose();
  }
}
