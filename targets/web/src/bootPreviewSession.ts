/**
 * Public preview entry point for Studio embedding the web target.
 *
 * Studio may import this root export only. It receives project-owned authored
 * UI data and renders it through the same GameUILayer used by runtimeHost.
 */

import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { GameProject } from "@sugarmagic/domain";
import {
  createDefaultRuntimeUIContext,
  createGameStateStore,
  createUIActionRegistry,
  createUIContextStore,
  createUIStateStore,
  registerDefaultUIActions,
  type GameLifecycle,
  type GameLifecycleTransitions,
  type GameStateStore,
  type RuntimeUIContext
} from "@sugarmagic/runtime-core";
import { GameUILayer } from "./GameUILayer";

export interface PreviewSessionOptions {
  project: GameProject;
  sampleRuntimeContext?: Partial<RuntimeUIContext>;
  mountInto: HTMLElement;
  /**
   * Runtime menu address to display. This is MenuDefinition.menuKey, never
   * MenuDefinition.definitionId.
   */
  initialVisibleMenuKey?: string | null;
}

export interface PreviewSession {
  update(project: GameProject): void;
  dispose(): void;
}

/**
 * Studio's preview session has no real `WebRuntimeHost` (no
 * save store, no plugin manager, no reload semantics) — it's a
 * lightweight non-interactive playthrough viewer. ui-actions
 * still needs `transitions`, so we provide stubs that mutate a
 * local `GameStateStore` directly.
 */
function createPreviewLifecycleTransitions(
  gameStateStore: GameStateStore
): GameLifecycleTransitions {
  return {
    startNewGame: () => {
      gameStateStore.setState({ lifecycle: "start-menu" });
    },
    continueGame: () => {
      gameStateStore.setState({ lifecycle: "playing" });
    },
    pauseGame: () => {
      gameStateStore.setState({ lifecycle: "paused" });
    },
    resumeGame: () => {
      gameStateStore.setState({ lifecycle: "playing" });
    },
    quitToMenu: () => {
      gameStateStore.setState({ lifecycle: "start-menu" });
    }
  };
}

/**
 * Maps `initialVisibleMenuKey` from the preview options (kept
 * as the public API for back-compat) into the lifecycle the
 * preview should boot into.
 */
function previewLifecycleFromMenuKey(
  initialKey: string | null | undefined
): GameLifecycle {
  if (initialKey === "start-menu") return "start-menu";
  if (initialKey === "pause-menu") return "paused";
  return "playing";
}

export function bootPreviewSession(
  options: PreviewSessionOptions
): PreviewSession {
  const contextStore = createUIContextStore(
    createDefaultRuntimeUIContext(options.sampleRuntimeContext)
  );
  const stateStore = createUIStateStore();
  const gameStateStore = createGameStateStore({
    lifecycle: previewLifecycleFromMenuKey(options.initialVisibleMenuKey)
  });
  const actionRegistry = createUIActionRegistry();
  registerDefaultUIActions(actionRegistry, {
    stateStore,
    transitions: createPreviewLifecycleTransitions(gameStateStore)
  });

  const root: Root = createRoot(options.mountInto);
  let project = options.project;

  function render() {
    root.render(
      createElement(GameUILayer, {
        hudDefinition: project.hudDefinition,
        menuDefinitions: project.menuDefinitions,
        theme: project.uiTheme,
        uiContextStore: contextStore,
        uiStateStore: stateStore,
        gameStateStore,
        onAction: (action) => actionRegistry.dispatch(action, null),
        onHover: () => {}
      })
    );
  }

  render();

  return {
    update(nextProject) {
      project = nextProject;
      render();
    },
    dispose() {
      root.unmount();
    }
  };
}
