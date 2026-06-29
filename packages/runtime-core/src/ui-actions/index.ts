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
  /**
   * Story 47.10.5 — "New Game" sequence: clear any persisted save
   * for the current user, then respawn the player at the project's
   * `defaultGameSavePayload` (or the implicit defaults). The host
   * supplies a callback that does both pieces — clearing the active
   * GameSaveStore + restarting the world / teleporting the player.
   * Without this option, `start-new-game` falls back to the original
   * behavior (just hide the menu + unpause).
   */
  onStartNewGame?: () => void | Promise<void>;
  /**
   * Story 47.10.5 — "Continue" sequence: with autosave, the boot
   * already loaded the saved game and spawned the player at their
   * saved position. So Continue just dismisses the menu + unpauses.
   * Reserved for projects that want to hook in extra logic (e.g.
   * resume an autosave timer, kick off a cutscene resume tick).
   */
  onContinueGame?: () => void | Promise<void>;
}

export function registerDefaultUIActions(
  registry: UIActionRegistry,
  options: DefaultUIActionOptions
): void {
  const startMenuKey = options.startMenuKey ?? "start-menu";
  const pauseMenuKey = options.pauseMenuKey ?? "pause-menu";

  registry.register("start-new-game", () => {
    // When a host-supplied `onStartNewGame` is registered, IT
    // owns the entire flow — destroy the save (via
    // resetForNewGame), set the fresh-start flag, reload. We
    // DELIBERATELY do NOT dismiss the menu here: dismissing
    // before the reload would reveal stale gameplay state (and
    // give a queued autosave tick a window to fire) between
    // "menu closes" and "page actually reloads." Leaving the
    // menu visible until window.location.reload() navigates
    // away closes that window.
    //
    // The fire-and-forget remains — dispatch() is synchronous
    // and can't await — but the destructive part (the in-flight
    // write race) is now structurally blocked by the
    // SerializedSaveStore's freeze-after-reset, not by ordering
    // here. See `runtime-core/src/save/serialized-store.ts`.
    //
    // Only when NO host callback is registered do we fall back
    // to the original "just hide the menu + unpause" behavior —
    // tests and bare hosts without a reset implementation need
    // some response to the click.
    if (options.onStartNewGame) {
      void Promise.resolve(options.onStartNewGame());
      return;
    }
    options.stateStore.setState({ visibleMenuKey: null, isPaused: false });
  });

  registry.register("continue-game", () => {
    // Story 47.10.5 — boot-time autosave load already placed the
    // player; Continue just unpauses. Optional host callback can
    // run extra logic (telemetry, cutscene resume, etc.).
    if (options.onContinueGame) {
      void Promise.resolve(options.onContinueGame());
    }
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
