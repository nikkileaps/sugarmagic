import { System, type World } from "../ecs";
import { CasterManager } from "./CasterManager";

export class CasterSystem extends System {
  constructor(private readonly casterManager: CasterManager) {
    super();
  }

  update(_world: World, delta: number): void {
    this.casterManager.recharge(delta);
  }
}
