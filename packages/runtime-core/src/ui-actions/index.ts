/**
 * Runtime UI action registry.
 *
 * Authored UI emits string-keyed UIActionExpression values. Runtime targets
 * wire those strings to shared gameplay/runtime state changes here instead of
 * letting authored documents contain JavaScript or target-specific callbacks.
 */

import type { UIActionExpression } from "@sugarmagic/domain";
import type { World } from "../ecs/core";
import type { GameLifecycleTransitions } from "../game-state";
import type { UIStateStore } from "../ui-state";

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
  /** Still passed for non-lifecycle handlers (load-region close,
   *  future overlay handlers). Lifecycle handlers go through
   *  `transitions`. */
  stateStore: UIStateStore;
  /**
   * Plan 054 §054.4 — lifecycle transition methods that the
   * host owns. ui-action handlers delegate to these instead of
   * mutating `stateStore` directly so the host stays the single
   * owner of "what does each lifecycle transition do."
   */
  transitions: GameLifecycleTransitions;
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
  registry.register("start-new-game", () => {
    // The host owns the destructive flow (resetForNewGame ->
    // freshStart flag -> reload). We DELIBERATELY do not
    // dismiss the menu here: dismissing before the reload
    // would reveal stale gameplay between "menu hides" and
    // "page navigates" — exactly the window the
    // SerializedSaveStore freeze guards on the data side.
    void Promise.resolve(options.transitions.startNewGame());
  });

  registry.register("continue-game", () => {
    options.transitions.continueGame();
  });

  registry.register("pause-game", () => {
    options.transitions.pauseGame();
  });

  registry.register("resume-game", () => {
    options.transitions.resumeGame();
  });

  registry.register("quit-to-menu", () => {
    options.transitions.quitToMenu();
  });

  registry.register("load-region", (args) => {
    const regionId = typeof args.regionId === "string" ? args.regionId : null;
    if (regionId) options.onLoadRegion?.(regionId);
    // Load-region implicitly resumes from any menu. After 054.4
    // overlay/menu unification this can route through a named
    // transition; for now go through continueGame which has the
    // correct effect (clear pause + visibleMenuKey).
    options.transitions.continueGame();
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

  // Plan 059 §059.4 — opens the built-in Episodes screen (Scene
  // cards with completed / current / locked states). Authors put
  // this on a start-menu button; the screen itself is built-in,
  // not an authored menu definition.
  registry.register("open-episodes", () => {
    options.stateStore.setState({ episodesOpen: true });
  });
}
