/**
 * GameCamera: state-based camera model matching Sugarengine's GameCamera.
 *
 * Sugarengine uses a Three.js rig: cameraTarget → yawPivot → pitchPivot → camera.
 * The yaw is yawPivot.rotation.y, pitch is in degrees applied as degToRad(-pitch),
 * camera sits at (0, 0, distance) in local space.
 *
 * This module reproduces the same conventions as pure state + math so the
 * preview entry point can compute camera world position without a Three.js rig.
 */

export interface GameCameraConfig {
  fov: number;
  pitchMin: number;       // degrees
  pitchMax: number;       // degrees
  pitchDefault: number;   // degrees
  distanceMin: number;
  distanceMax: number;
  distanceDefault: number;
  followStrength: number;
  rotationSpeed: number;
  autoFollow: boolean;
  autoFollowStrength: number;
}

export const DEFAULT_CAMERA_CONFIG: GameCameraConfig = {
  fov: 30,
  pitchMin: 35,
  pitchMax: 55,
  pitchDefault: 45,
  distanceMin: 15,
  distanceMax: 40,
  distanceDefault: 25,
  followStrength: 8,
  rotationSpeed: 0.003,
  autoFollow: true,
  autoFollowStrength: 2
};

export interface GameCameraState {
  targetX: number;
  targetY: number;
  targetZ: number;
  // yaw = yawPivot.rotation.y in Sugarengine's rig
  yaw: number;
  // pitch in degrees (like Sugarengine)
  pitch: number;
  distance: number;
  prevTargetX: number;
  prevTargetZ: number;
}

export function createCameraState(config: GameCameraConfig): GameCameraState {
  return {
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    // Sugarengine default: Math.PI * 1.25 (225°)
    yaw: Math.PI * 1.25,
    pitch: config.pitchDefault,
    distance: config.distanceDefault,
    prevTargetX: 0,
    prevTargetZ: 0
  };
}

/**
 * Update camera follow — matches Sugarengine's GameCamera.update() logic.
 */
export function updateCameraFollow(
  state: GameCameraState,
  config: GameCameraConfig,
  targetX: number,
  targetZ: number,
  delta: number,
  isDragging: boolean
): GameCameraState {
  const next = { ...state };
  const smoothFactor = 1 - Math.exp(-config.followStrength * delta);

  // Auto-follow: swing camera behind movement direction
  if (config.autoFollow && !isDragging) {
    const dx = targetX - state.prevTargetX;
    const dz = targetZ - state.prevTargetZ;
    const moveSpeed = Math.sqrt(dx * dx + dz * dz);

    if (moveSpeed > 0.01) {
      // behindAngle = atan2(dx, dz) + PI — exactly as Sugarengine does it
      const behindAngle = Math.atan2(dx, dz) + Math.PI;
      const autoFollowFactor = 1 - Math.exp(-config.autoFollowStrength * delta);

      // Shortest-path angle difference
      let angleDiff = behindAngle - next.yaw;
      angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;

      next.yaw += angleDiff * autoFollowFactor;
    }
  }

  // Store for next frame
  next.prevTargetX = targetX;
  next.prevTargetZ = targetZ;

  // Smooth position follow
  next.targetX = state.targetX + (targetX - state.targetX) * smoothFactor;
  next.targetZ = state.targetZ + (targetZ - state.targetZ) * smoothFactor;

  return next;
}

/**
 * Apply mouse drag rotation — matches Sugarengine's onMouseMove handler.
 */
export function applyCameraDrag(
  state: GameCameraState,
  config: GameCameraConfig,
  deltaX: number,
  deltaY: number
): GameCameraState {
  return {
    ...state,
    yaw: state.yaw + (-deltaX * config.rotationSpeed),
    pitch: Math.max(
      config.pitchMin,
      Math.min(
        config.pitchMax,
        state.pitch + deltaY * config.rotationSpeed * 50
      )
    )
  };
}

/**
 * Apply scroll wheel zoom — matches Sugarengine's onWheel handler.
 */
export function applyCameraZoom(
  state: GameCameraState,
  config: GameCameraConfig,
  scrollDelta: number
): GameCameraState {
  const zoomSpeed = 1.5;
  const delta = scrollDelta > 0 ? zoomSpeed : -zoomSpeed;
  return {
    ...state,
    distance: Math.max(
      config.distanceMin,
      Math.min(config.distanceMax, state.distance + delta)
    )
  };
}

/**
 * Compute camera world position from state.
 *
 * Reproduces the Three.js rig: yawPivot.rotation.y = yaw,
 * pitchPivot.rotation.x = degToRad(-pitch), camera at (0,0,distance).
 *
 * In world space this gives:
 *   camX = target.x + distance * sin(yaw) * cos(pitchRad)
 *   camY = target.y + distance * sin(pitchRad)
 *   camZ = target.z + distance * cos(yaw) * cos(pitchRad)
 */
export function computeCameraPosition(state: GameCameraState): {
  x: number;
  y: number;
  z: number;
  lookAtX: number;
  lookAtY: number;
  lookAtZ: number;
} {
  const pitchRad = (state.pitch * Math.PI) / 180;

  const camX =
    state.targetX + state.distance * Math.sin(state.yaw) * Math.cos(pitchRad);
  const camY = state.targetY + state.distance * Math.sin(pitchRad);
  const camZ =
    state.targetZ + state.distance * Math.cos(state.yaw) * Math.cos(pitchRad);

  return {
    x: camX,
    y: camY,
    z: camZ,
    lookAtX: state.targetX,
    lookAtY: state.targetY,
    lookAtZ: state.targetZ
  };
}
