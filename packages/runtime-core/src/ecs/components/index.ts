/**
 * Core ECS components for the runtime gameplay kernel.
 * Ported from Sugarengine's component model.
 */

import type { Component } from "../core";

export class Position implements Component {
  static readonly type = "Position";
  readonly type = Position.type;
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}
}

export class Velocity implements Component {
  static readonly type = "Velocity";
  readonly type = Velocity.type;
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}
}

export class PlayerControlled implements Component {
  static readonly type = "PlayerControlled";
  readonly type = PlayerControlled.type;
  constructor(public speed: number = 5) {}
}

export class Renderable implements Component {
  static readonly type = "Renderable";
  readonly type = Renderable.type;
  constructor(
    public meshId: string = "",
    public visible: boolean = true
  ) {}
}

export class CameraTarget implements Component {
  static readonly type = "CameraTarget";
  readonly type = CameraTarget.type;
}
