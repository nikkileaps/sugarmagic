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
    startMenuKey: options.project.menuDefinitions.find(
      (menu) => menu.menuKey === "start-menu"
    )?.menuKey,
    pauseMenuKey: options.project.menuDefinitions.find(
      (menu) => menu.menuKey === "pause-menu"
    )?.menuKey
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
