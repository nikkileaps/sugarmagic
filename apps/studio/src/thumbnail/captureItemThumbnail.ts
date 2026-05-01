/**
 * Item thumbnail capture orchestration.
 *
 * Builds a scene + camera in the studio render engine's WebGPU context, loads
 * the item's bound GLB, applies the same Sugarmagic shader bindings the live
 * runtime uses, frames the camera, and captures a single PNG frame. Same
 * render path as the inspector preview — perfect parity, no parallel
 * renderer.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  ContentLibrarySnapshot,
  ItemDefinition
} from "@sugarmagic/domain";
import { createRegionItemPresence } from "@sugarmagic/domain";
import {
  captureFrame,
  createRenderableShaderApplicationState,
  ensureShaderSetAppliedToRenderable,
  releaseShadersFromObjectTree,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import { createItemSceneObject } from "@sugarmagic/runtime-core";

const THUMBNAIL_SIZE = 256;
const gltfLoader = new GLTFLoader();

function rebaseToGround(root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(box.min.y)) return;
  root.position.y -= box.min.y;
}

function frameCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  paddingFactor = 1.35
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x)) return;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (radius * paddingFactor) / Math.sin(fov * 0.5);

  // 3/4 angle so flat-front items still read.
  const direction = new THREE.Vector3(0.6, 0.4, 1).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(distance));
  camera.lookAt(center);
  camera.near = Math.max(0.01, distance - radius * 2);
  camera.far = distance + radius * 4;
  camera.updateProjectionMatrix();
}

export interface CaptureItemThumbnailOptions {
  engine: WebRenderEngine;
  item: ItemDefinition;
  contentLibrary: ContentLibrarySnapshot;
  assetSources: Record<string, string>;
  modelGlbUrl: string;
}

export async function captureItemThumbnail(
  options: CaptureItemThumbnailOptions
): Promise<Blob> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x444466, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 2);
  scene.add(ambient, key);

  const gltf = await gltfLoader.loadAsync(options.modelGlbUrl);
  const modelRoot = new THREE.Group();
  const clonedScene = gltf.scene.clone(true);
  rebaseToGround(clonedScene);
  modelRoot.add(clonedScene);
  scene.add(modelRoot);

  // Mirror the inspector preview path: build a synthetic presence so the
  // item's resolved surface bindings get applied on top of the bare GLB.
  const presence = createRegionItemPresence({ itemDefinitionId: options.item.definitionId });
  const sceneObject = createItemSceneObject(presence, options.item, options.contentLibrary);
  ensureShaderSetAppliedToRenderable(
    modelRoot,
    sceneObject,
    options.engine.shaderRuntime,
    createRenderableShaderApplicationState(),
    options.assetSources
  );

  frameCameraToObject(camera, modelRoot);

  try {
    return await captureFrame({
      engine: options.engine,
      scene,
      camera,
      size: THUMBNAIL_SIZE
    });
  } finally {
    // Return any TSL materials we leased back to the engine's shader runtime.
    // Geometries are shared with the GLTFLoader-cached source via clone(), so
    // we deliberately don't dispose them — the temp scene gets GC'd as a unit.
    releaseShadersFromObjectTree(modelRoot);
  }
}
