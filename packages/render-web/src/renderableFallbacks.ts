/**
 * renderableFallbacks
 *
 * Shared fallback-renderable and disposal helpers for Three/WebGPU hosts.
 * Studio and published web targets both need the same fallback mesh and
 * teardown semantics, so this module keeps those behaviors in one place
 * instead of letting host files drift.
 */

import * as THREE from "three";
import type { SceneObject } from "@sugarmagic/runtime-core";
import { releaseShadersFromObjectTree } from "./applyShaderToRenderable";

const DEFAULT_FALLBACK_COLOR = 0x89b4fa;

export function createFallbackMesh(options?: { color?: number }): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: options?.color ?? DEFAULT_FALLBACK_COLOR
    })
  );
}

export function createCapsuleFallback(
  object: SceneObject,
  options?: { fallbackColor?: number }
): THREE.Mesh {
  const capsule = object.capsule;
  if (!capsule) {
    return createFallbackMesh({ color: options?.fallbackColor });
  }

  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      capsule.radius,
      Math.max(0.05, capsule.height - capsule.radius * 2),
      8,
      16
    ),
    new THREE.MeshStandardMaterial({
      color: capsule.color,
      roughness: 0.38,
      metalness: 0.04
    })
  );
  mesh.position.y = capsule.height / 2;
  return mesh;
}

export function disposeRenderableObject(root: THREE.Object3D) {
  const runtimeManagedMaterials = releaseShadersFromObjectTree(root);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (!runtimeManagedMaterials.has(material)) {
          material.dispose();
        }
      }
    } else if (!runtimeManagedMaterials.has(child.material)) {
      child.material.dispose();
    }
  });
}
