import { System, type World } from "../ecs";
import { QuestManager } from "./QuestManager";

export class QuestSystem extends System {
  constructor(private readonly questManager: QuestManager) {
    super();
  }

  update(world: World, delta: number): void {
    void world;
    void delta;
    this.questManager.update();
  }
}
