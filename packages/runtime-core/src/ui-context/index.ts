/**
 * Runtime UI context bridge.
 *
 * This is the single runtime-owned projection from ECS/game state into the
 * flat data object that target UI renderers consume. React DOM targets,
 * Studio previews, and future targets resolve bindings through this module
 * instead of reaching into ECS or duplicating path semantics.
 */

import type { UIBindingExpression } from "@sugarmagic/domain";
import { Caster, PlayerControlled, Position } from "../ecs/components";
import { System, type World } from "../ecs/core";

export interface RuntimeUIContext {
  player: {
    battery: number;
    maxBattery: number;
    health: number;
    position: [number, number, number];
  };
  region: {
    name: string;
    id: string;
  };
  game: {
    visibleMenuKey: string | null;
    isPaused: boolean;
  };
}

export interface RuntimeUIState {
  visibleMenuKey: string | null;
  isPaused: boolean;
}

export interface RuntimeStore<TState> {
  getState(): TState;
  setState(next: TState | ((current: TState) => TState)): void;
  subscribe(listener: () => void): () => void;
}

function createRuntimeStore<TState>(initialState: TState): RuntimeStore<TState> {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState() {
      return state;
    },
    setState(next) {
      state = typeof next === "function"
        ? (next as (current: TState) => TState)(state)
        : next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export type UIContextStore = RuntimeStore<RuntimeUIContext>;
export type UIStateStore = RuntimeStore<RuntimeUIState>;

export function createDefaultRuntimeUIContext(
  patch: Partial<RuntimeUIContext> = {}
): RuntimeUIContext {
  return {
    player: {
      battery: patch.player?.battery ?? 1,
      maxBattery: patch.player?.maxBattery ?? 1,
      health: patch.player?.health ?? 1,
      position: patch.player?.position ?? [0, 0, 0]
    },
    region: {
      name: patch.region?.name ?? "Region",
      id: patch.region?.id ?? "region"
    },
    game: {
      visibleMenuKey: patch.game?.visibleMenuKey ?? null,
      isPaused: patch.game?.isPaused ?? false
    }
  };
}

export function createUIContextStore(
  initialState: RuntimeUIContext = createDefaultRuntimeUIContext()
): UIContextStore {
  return createRuntimeStore(initialState);
}

export function createUIStateStore(
  initialState: RuntimeUIState = { visibleMenuKey: null, isPaused: false }
): UIStateStore {
  return createRuntimeStore(initialState);
}

export function resolveRuntimePath(
  path: string,
  context: RuntimeUIContext
): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = context;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function formatBindingValue(
  value: unknown,
  format: "percent" | "integer" | "decimal-1" | null | undefined
): unknown {
  if (typeof value !== "number") return value;
  if (format === "percent") return `${Math.round(value * 100)}%`;
  if (format === "integer") return Math.round(value);
  if (format === "decimal-1") return value.toFixed(1);
  return value;
}

export function resolveBinding(
  expression: UIBindingExpression | undefined,
  context: RuntimeUIContext
): unknown {
  if (!expression) return undefined;
  if (expression.kind === "literal") return expression.value;
  return formatBindingValue(
    resolveRuntimePath(expression.path, context),
    expression.format
  );
}

export interface UIContextSystemOptions {
  contextStore: UIContextStore;
  stateStore: UIStateStore;
  getRegion?: () => { id: string; name: string } | null;
}

export class UIContextSystem extends System {
  constructor(private readonly options: UIContextSystemOptions) {
    super();
  }

  update(world: World): void {
    const state = this.options.stateStore.getState();
    const region = this.options.getRegion?.() ?? null;
    const playerEntity = world.query(PlayerControlled, Position)[0] ?? null;
    const position = playerEntity
      ? world.getComponent(playerEntity, Position)
      : null;
    const caster = playerEntity ? world.getComponent(playerEntity, Caster) : null;

    this.options.contextStore.setState({
      player: {
        battery: caster?.battery ?? 0,
        maxBattery: caster?.maxBattery ?? 1,
        health: 1,
        position: position ? [position.x, position.y, position.z] : [0, 0, 0]
      },
      region: {
        id: region?.id ?? "region",
        name: region?.name ?? "Region"
      },
      game: {
        visibleMenuKey: state.visibleMenuKey,
        isPaused: state.isPaused
      }
    });
  }
}
