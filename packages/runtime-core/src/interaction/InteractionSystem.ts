import {
  type Component,
  System,
  World,
  Position,
  PlayerControlled
} from "../ecs";

export type InteractableType = "npc" | "item";

export interface NearbyInteractable {
  type: InteractableType;
  instanceId: string;
  targetId: string;
  promptText: string;
  available: boolean;
}

export class Interactable implements Component {
  static readonly type = "Interactable";
  readonly type = Interactable.type;

  constructor(
    public interactableType: InteractableType,
    public instanceId: string,
    public targetId: string,
    public promptText: string,
    public interactionRadius: number = 2,
    public available: boolean = true
  ) {}
}

export type NearbyInteractableChangeHandler = (
  nearby: NearbyInteractable | null
) => void;

export type RuntimeInteractHandler = (nearby: NearbyInteractable) => void;

export class InteractionSystem extends System {
  private isInteractPressed: () => boolean = () => false;
  private nearestInteractable: NearbyInteractable | null = null;
  private onNearbyChange: NearbyInteractableChangeHandler | null = null;
  private onInteract: RuntimeInteractHandler | null = null;

  setInteractPressedProvider(provider: () => boolean): void {
    this.isInteractPressed = provider;
  }

  setNearbyChangeHandler(handler: NearbyInteractableChangeHandler): void {
    this.onNearbyChange = handler;
  }

  setInteractHandler(handler: RuntimeInteractHandler): void {
    this.onInteract = handler;
  }

  getNearestInteractable(): NearbyInteractable | null {
    return this.nearestInteractable;
  }

  update(world: World): void {
    const playerEntities = world.query(PlayerControlled, Position);
    if (playerEntities.length === 0) {
      this.updateNearestInteractable(null);
      return;
    }

    const playerPosition = world.getComponent(playerEntities[0]!, Position);
    if (!playerPosition) {
      this.updateNearestInteractable(null);
      return;
    }

    let nearest:
      | (NearbyInteractable & {
          distance: number;
        })
      | null = null;

    for (const entity of world.query(Interactable, Position)) {
      const interactable = world.getComponent(entity, Interactable);
      const position = world.getComponent(entity, Position);
      if (!interactable || !position) continue;

      const dx = playerPosition.x - position.x;
      const dz = playerPosition.z - position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > interactable.interactionRadius) continue;

      if (!nearest || distance < nearest.distance) {
        nearest = {
          type: interactable.interactableType,
          instanceId: interactable.instanceId,
          targetId: interactable.targetId,
          promptText: interactable.promptText,
          available: interactable.available,
          distance
        };
      }
    }

    this.updateNearestInteractable(
      nearest
        ? {
            type: nearest.type,
            instanceId: nearest.instanceId,
            targetId: nearest.targetId,
            promptText: nearest.promptText,
            available: nearest.available
          }
        : null
    );

    if (this.nearestInteractable?.available && this.isInteractPressed()) {
      this.onInteract?.(this.nearestInteractable);
    }
  }

  private updateNearestInteractable(next: NearbyInteractable | null) {
    const changed =
      this.nearestInteractable?.instanceId !== next?.instanceId ||
      this.nearestInteractable?.type !== next?.type ||
      this.nearestInteractable?.available !== next?.available ||
      this.nearestInteractable?.promptText !== next?.promptText;

    if (!changed) return;
    this.nearestInteractable = next;
    this.onNearbyChange?.(next);
  }
}
