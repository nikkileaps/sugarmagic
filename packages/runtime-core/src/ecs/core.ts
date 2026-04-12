/**
 * ECS core types: Entity, Component, ComponentClass, System, World.
 */

export type Entity = number;

export interface Component {
  readonly type: string;
}

export interface ComponentClass<T extends Component = Component> {
  readonly type: string;
  new (...args: never[]): T;
}

export abstract class System {
  abstract update(world: World, delta: number): void;
}

export class World {
  private nextEntityId = 1;
  private entities = new Set<Entity>();
  private stores = new Map<string, Map<Entity, Component>>();
  private systems: System[] = [];

  createEntity(): Entity {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(entity: Entity): void {
    this.entities.delete(entity);
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
  }

  addComponent<T extends Component>(entity: Entity, component: T): void {
    let store = this.stores.get(component.type);
    if (!store) {
      store = new Map();
      this.stores.set(component.type, store);
    }
    store.set(entity, component);
  }

  removeComponent<T extends Component>(
    entity: Entity,
    cls: ComponentClass<T>
  ): boolean {
    const store = this.stores.get(cls.type);
    return store?.delete(entity) ?? false;
  }

  getComponent<T extends Component>(
    entity: Entity,
    cls: ComponentClass<T>
  ): T | undefined {
    const store = this.stores.get(cls.type);
    return store?.get(entity) as T | undefined;
  }

  hasComponent(entity: Entity, cls: ComponentClass): boolean {
    const store = this.stores.get(cls.type);
    return store?.has(entity) ?? false;
  }

  query(...classes: ComponentClass[]): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities) {
      if (classes.every((cls) => this.hasComponent(entity, cls))) {
        result.push(entity);
      }
    }
    return result;
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }

  update(delta: number): void {
    for (const system of this.systems) {
      system.update(this, delta);
    }
  }

  getEntities(): ReadonlySet<Entity> {
    return this.entities;
  }
}
