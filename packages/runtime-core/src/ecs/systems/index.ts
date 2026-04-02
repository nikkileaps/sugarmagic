/**
 * Core ECS systems for the runtime gameplay kernel.
 * Ported from Sugarengine's system ordering model.
 */

import { System, World } from "../core";
import {
  Position,
  Velocity,
  PlayerControlled
} from "../components";

export interface InputState {
  moveX: number;
  moveY: number;
}

/**
 * MovementSystem: reads input, applies camera-relative velocity to
 * player-controlled entities, then applies velocity to position.
 */
export class MovementSystem extends System {
  private getInput: () => InputState = () => ({ moveX: 0, moveY: 0 });
  // Default yaw matches Sugarengine's fallback: Math.PI / 4
  private getCameraYaw: () => number = () => Math.PI / 4;

  setInputProvider(fn: () => InputState): void {
    this.getInput = fn;
  }

  setCameraYawProvider(fn: () => number): void {
    this.getCameraYaw = fn;
  }

  update(world: World, delta: number): void {
    const input = this.getInput();
    // Exact formula from Sugarengine MovementSystem.ts.
    // cameraYaw is the yaw rig rotation (yawPivot.rotation.y).
    // moveY is -1 for W (forward), +1 for S (backward).
    const cameraYaw = this.getCameraYaw();

    for (const entity of world.query(PlayerControlled, Velocity)) {
      const pc = world.getComponent(entity, PlayerControlled)!;
      const vel = world.getComponent(entity, Velocity)!;

      vel.x =
        (input.moveX * Math.cos(cameraYaw) +
          input.moveY * Math.sin(cameraYaw)) *
        pc.speed;
      vel.z =
        (-input.moveX * Math.sin(cameraYaw) +
          input.moveY * Math.cos(cameraYaw)) *
        pc.speed;
    }

    // Apply velocity to position for all entities with both
    for (const entity of world.query(Position, Velocity)) {
      const pos = world.getComponent(entity, Position)!;
      const vel = world.getComponent(entity, Velocity)!;

      pos.x += vel.x * delta;
      pos.z += vel.z * delta;
    }
  }
}

/**
 * Placeholder for render sync — preview viewport will read Position
 * directly and update Three.js meshes in its own loop.
 */
export class RenderSyncSystem extends System {
  update(): void {
    // No-op: preview viewport reads Position/Renderable directly
  }
}
