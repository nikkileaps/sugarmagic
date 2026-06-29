/**
 * Runtime UI context bridge.
 *
 * This is the single runtime-owned projection from ECS/game state into the
 * flat data object that target UI renderers consume. React DOM targets,
 * Studio previews, and future targets resolve bindings through this module
 * instead of reaching into ECS or duplicating path semantics.
 */

import type { UIBindingExpression } from "@sugarmagic/domain";
import { STAT_ROLE_BATTERY } from "@sugarmagic/domain";
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
  /**
   * Story 47.10.5 — whether the active user has a save in the
   * active save store. Drives `visibility: "hasSave" | "noSave"`
   * on menu nodes so the start menu can show a Continue button
   * only when there's something to continue. Host flips it true
   * on autosave write, false on start-new-game's clear.
   */
  savePresent: boolean;
  /**
   * Story 50.1 — true while SugarProfile's LoginModal (or any
   * future focus-stealing modal overlaying the canvas) is
   * mounted. The input-modes resolver consumes this to switch
   * `RuntimeMode` to "login-modal", which disables every other
   * keyboard action so typing into the modal's email input
   * doesn't simultaneously toggle the inventory.
   *
   * Modal owner flips it true on mount, false on unmount. Lives
   * on `RuntimeUIState` (the single source of truth for "what's
   * on top of the game right now?") rather than a sibling store
   * so the mode resolver stays a pure function over one input.
   */
  loginModalOpen: boolean;
}

export interface RuntimeStore<TState> {
  getState(): TState;
  /**
   * Story 47.10.5 — accepts a partial patch (merged onto the
   * current state) OR a full updater function. Partial-patch
   * semantics make adding new fields to the state type back-
   * compatible — callers that only set `{visibleMenuKey}` still
   * compile after a new field lands.
   */
  setState(
    next: Partial<TState> | ((current: TState) => TState)
  ): void;
  subscribe(listener: () => void): () => void;
}

function createRuntimeStore<TState extends object>(
  initialState: TState
): RuntimeStore<TState> {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getState() {
      return state;
    },
    setState(next) {
      state =
        typeof next === "function"
          ? (next as (current: TState) => TState)(state)
          : { ...state, ...next };
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
  initialState: Partial<RuntimeUIState> = {}
): UIStateStore {
  return createRuntimeStore({
    visibleMenuKey: initialState.visibleMenuKey ?? null,
    isPaused: initialState.isPaused ?? false,
    savePresent: initialState.savePresent ?? false,
    loginModalOpen: initialState.loginModalOpen ?? false
  });
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

function runtimeUIContextsEqual(
  a: RuntimeUIContext,
  b: RuntimeUIContext
): boolean {
  return (
    a.player.battery === b.player.battery &&
    a.player.maxBattery === b.player.maxBattery &&
    a.player.health === b.player.health &&
    a.player.position[0] === b.player.position[0] &&
    a.player.position[1] === b.player.position[1] &&
    a.player.position[2] === b.player.position[2] &&
    a.region.id === b.region.id &&
    a.region.name === b.region.name &&
    a.game.visibleMenuKey === b.game.visibleMenuKey &&
    a.game.isPaused === b.game.isPaused
  );
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
    const caster = playerEntity
      ? world.getComponent(playerEntity, Caster)
      : null;
    const casterStats = caster?.stats.snapshot() ?? {};
    const batteryStatId =
      Object.keys(casterStats).find(
        (statId) =>
          caster?.stats.getDefinition(statId)?.role === STAT_ROLE_BATTERY
      ) ?? null;
    const batteryDefinition = batteryStatId
      ? caster?.stats.getDefinition(batteryStatId)
      : null;

    const next: RuntimeUIContext = {
      player: {
        battery: batteryStatId ? (caster?.stats.get(batteryStatId) ?? 0) : 0,
        maxBattery: batteryDefinition?.max ?? 1,
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
    };

    // Skip the store update when nothing changed: avoids waking every
    // bound leaf's useSyncExternalStore listener 60×/sec for a no-op.
    if (runtimeUIContextsEqual(this.options.contextStore.getState(), next)) {
      return;
    }
    this.options.contextStore.setState(next);
  }
}
