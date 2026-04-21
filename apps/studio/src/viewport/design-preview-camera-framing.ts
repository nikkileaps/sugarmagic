/**
 * Design preview camera framing sync helpers.
 *
 * Player / NPC / Item preview viewports publish camera framing into the
 * design-preview store so React chrome can reflect the live orbit state.
 * This helper filters out insignificant camera churn before any new arrays or
 * objects are allocated, preventing per-frame store writes during idle frames.
 */

import * as THREE from "three";
import type { DesignPreviewStore } from "@sugarmagic/shell";

const CAMERA_ANGLE_EPSILON = 0.0001;
const CAMERA_DISTANCE_EPSILON = 0.0005;
const CAMERA_TARGET_EPSILON = 0.0005;

const scratchQuaternion = new THREE.Quaternion();

type FramingCamera = THREE.Camera & {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

function targetChanged(
  previousTarget: readonly [number, number, number],
  nextTargetY: number
): boolean {
  return (
    Math.abs(previousTarget[0]) > CAMERA_TARGET_EPSILON ||
    Math.abs(previousTarget[1] - nextTargetY) > CAMERA_TARGET_EPSILON ||
    Math.abs(previousTarget[2]) > CAMERA_TARGET_EPSILON
  );
}

export function syncDesignPreviewCameraFraming(
  designPreviewStore: DesignPreviewStore,
  camera: FramingCamera,
  targetY: number
) {
  const dx = camera.position.x;
  const dy = camera.position.y - targetY;
  const dz = camera.position.z;
  const orbitDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const previous = designPreviewStore.getState().cameraFraming;

  if (previous) {
    scratchQuaternion.fromArray(previous.quaternion);
    if (
      scratchQuaternion.angleTo(camera.quaternion) < CAMERA_ANGLE_EPSILON &&
      Math.abs(previous.orbitDistance - orbitDistance) < CAMERA_DISTANCE_EPSILON &&
      !targetChanged(previous.target, targetY)
    ) {
      return;
    }
  }

  designPreviewStore.getState().setCameraFraming({
    quaternion: [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w
    ],
    orbitDistance,
    target: [0, targetY, 0]
  });
}
