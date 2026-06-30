/**
 * Runtime UI context bridge.
 *
 * The single ECS -> UI projection: walks the live ECS world
 * each frame, computes a flat `RuntimeUIContext` snapshot, and
 * stores it for authored UI bindings to read. React DOM
 * targets, Studio previews, and future targets resolve
 * bindings through this module instead of reaching into ECS or
 * duplicating path semantics.
 *
 * Plan 054 §054.4 — the UIStateStore + RuntimeUIState live in
 * `../ui-state/`; this module now only owns the binding-context
 * shape and projection. The `RuntimeUIContext.game.{visibleMenuKey,
 * isPaused}` output stays for authored binding compat —
 * `visibleMenuKey` is derived from lifecycle + overlay key,
 * `isPaused` from lifecycle.
 */

import type { UIBindingExpression } from "@sugarmagic/domain";
import { STAT_ROLE_BATTERY } from "@sugarmagic/domain";
import { Caster, PlayerControlled, Position } from "../ecs/components";
import { System, type World } from "../ecs/core";
import {
  createRuntimeStore,
  type RuntimeStore,
  type RuntimeUIState,
  type UIStateStore
} from "../ui-state";
// Type-only — avoids a circular import (game-state imports
// createRuntimeStore from ui-state, which is fine).
import type { GameStateSnapshot, GameStateStore } from "../game-state";

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

export type UIContextStore = RuntimeStore<RuntimeUIContext>;

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
  /** Project `game.isPaused` + `game.visibleMenuKey` from the
   *  canonical lifecycle. Optional for back-compat with tests
   *  that don't construct a real host; absent => defaults to
   *  the legacy "always playing" projection. */
  gameStateStore?: GameStateStore;
  getRegion?: () => { id: string; name: string } | null;
}

/**
 * Derive the bound `game.visibleMenuKey` for authored UI from
 * the canonical sources:
 *   - lifecycle === "start-menu" -> "start-menu"
 *   - lifecycle === "paused" -> "pause-menu"
 *   - playing -> whatever overlay is up (`activeOverlayMenuKey`)
 *   - booting / no gameState -> null
 */
function deriveBindingVisibleMenuKey(
  gameState: GameStateSnapshot | undefined,
  uiState: RuntimeUIState
): string | null {
  if (!gameState) return uiState.activeOverlayMenuKey;
  switch (gameState.lifecycle) {
    case "start-menu":
      return "start-menu";
    case "paused":
      return "pause-menu";
    case "playing":
      return uiState.activeOverlayMenuKey;
    case "booting":
      return null;
  }
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
        visibleMenuKey: deriveBindingVisibleMenuKey(
          this.options.gameStateStore?.getState(),
          state
        ),
        isPaused: this.options.gameStateStore
          ? this.options.gameStateStore.getState().lifecycle !== "playing"
          : false
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
