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
  createUIActionRegistry,
  createUIContextStore,
  createUIStateStore,
  registerDefaultUIActions,
  type GameLifecycleTransitions,
  type RuntimeUIContext,
  type UIStateStore
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
 * still needs `transitions`, so we provide stubs that mutate
 * the local UIStateStore directly, mirroring what the real
 * host's transition methods would do post-bridge.
 */
function createPreviewLifecycleTransitions(
  stateStore: UIStateStore
): GameLifecycleTransitions {
  return {
    // Preview can't actually reset a save or reload; treat as
    // "back to start menu" so the preview viewer doesn't crash.
    startNewGame: () => {
      stateStore.setState({
        visibleMenuKey: "start-menu",
        isPaused: true
      });
    },
    continueGame: () => {
      stateStore.setState({ visibleMenuKey: null, isPaused: false });
    },
    pauseGame: () => {
      stateStore.setState({
        visibleMenuKey: "pause-menu",
        isPaused: true
      });
    },
    resumeGame: () => {
      stateStore.setState({ visibleMenuKey: null, isPaused: false });
    },
    quitToMenu: () => {
      stateStore.setState({
        visibleMenuKey: "start-menu",
        isPaused: true
      });
    }
  };
}

export function bootPreviewSession(
  options: PreviewSessionOptions
): PreviewSession {
  const contextStore = createUIContextStore(
    createDefaultRuntimeUIContext(options.sampleRuntimeContext)
  );
  const stateStore = createUIStateStore({
    visibleMenuKey: options.initialVisibleMenuKey ?? null,
    isPaused: options.initialVisibleMenuKey !== null
  });
  const actionRegistry = createUIActionRegistry();
  registerDefaultUIActions(actionRegistry, {
    stateStore,
    transitions: createPreviewLifecycleTransitions(stateStore)
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
