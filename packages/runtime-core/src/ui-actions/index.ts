/**
 * Runtime UI action registry.
 *
 * Authored UI emits string-keyed UIActionExpression values. Runtime targets
 * wire those strings to shared gameplay/runtime state changes here instead of
 * letting authored documents contain JavaScript or target-specific callbacks.
 */

import type { UIActionExpression } from "@sugarmagic/domain";
import type { World } from "../ecs/core";
import type { UIStateStore } from "../ui-context";

export type UIActionHandler = (
  args: Record<string, unknown>,
  world: World | null
) => void;

export interface UIActionRegistry {
  register(actionKey: string, handler: UIActionHandler): void;
  dispatch(action: UIActionExpression, world?: World | null): void;
}

export function createUIActionRegistry(): UIActionRegistry {
  const handlers = new Map<string, UIActionHandler>();
  return {
    register(actionKey, handler) {
      handlers.set(actionKey, handler);
    },
    dispatch(action, world = null) {
      const handler = handlers.get(action.action);
      if (!handler) {
        console.warn("[runtime-ui] unhandled action", { action: action.action });
        return;
      }
      handler(action.args ?? {}, world);
    }
  };
}

export interface DefaultUIActionOptions {
  stateStore: UIStateStore;
  startMenuKey?: string;
  pauseMenuKey?: string;
  onLoadRegion?: (regionId: string) => void;
  onSaveGame?: () => void;
  onLoadGame?: () => void;
  onToggleInventory?: () => void;
  onToggleCaster?: () => void;
}

export function registerDefaultUIActions(
  registry: UIActionRegistry,
  options: DefaultUIActionOptions
): void {
  const startMenuKey = options.startMenuKey ?? "start-menu";
  const pauseMenuKey = options.pauseMenuKey ?? "pause-menu";

  registry.register("start-new-game", () => {
    options.stateStore.setState({ visibleMenuKey: null, isPaused: false });
  });

  registry.register("pause-game", () => {
    options.stateStore.setState({
      visibleMenuKey: pauseMenuKey,
      isPaused: true
    });
  });

  registry.register("resume-game", () => {
    options.stateStore.setState({ visibleMenuKey: null, isPaused: false });
  });

  registry.register("load-region", (args) => {
    const regionId = typeof args.regionId === "string" ? args.regionId : null;
    if (regionId) options.onLoadRegion?.(regionId);
    options.stateStore.setState({ visibleMenuKey: null, isPaused: false });
  });

  registry.register("quit-to-menu", () => {
    options.stateStore.setState({
      visibleMenuKey: startMenuKey,
      isPaused: true
    });
  });

  registry.register("save-game", () => {
    options.onSaveGame?.();
  });

  registry.register("load-game", () => {
    options.onLoadGame?.();
  });

  registry.register("open-inventory", () => {
    options.onToggleInventory?.();
  });

  registry.register("open-caster", () => {
    options.onToggleCaster?.();
  });
}
