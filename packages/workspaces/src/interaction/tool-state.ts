/**
 * Tool state: tracks the active transform tool.
 *
 * Keyboard shortcuts follow Blender convention:
 *   G — Grab (move)
 *   R — Rotate
 *   S — Scale
 */

export type TransformTool = "select" | "move" | "rotate" | "scale";

export interface ToolState {
  activeTool: TransformTool;
}

export type ToolStateListener = (state: ToolState) => void;

export interface ToolStateStore {
  getState: () => ToolState;
  setActiveTool: (tool: TransformTool) => void;
  subscribe: (listener: ToolStateListener) => () => void;
}

export function createToolStateStore(
  initialTool: TransformTool = "move"
): ToolStateStore {
  let state: ToolState = { activeTool: initialTool };
  const listeners = new Set<ToolStateListener>();

  function notify() {
    for (const listener of listeners) listener(state);
  }

  return {
    getState: () => state,

    setActiveTool(tool) {
      if (state.activeTool === tool) return;
      state = { ...state, activeTool: tool };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export const TOOL_SHORTCUTS: Record<string, TransformTool> = {
  g: "move",
  r: "rotate",
  s: "scale"
};
