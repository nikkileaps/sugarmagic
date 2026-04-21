/**
 * Shared viewport interface contracts.
 *
 * These interfaces describe the narrow DOM-lifecycle capabilities workspace
 * chrome may rely on from Studio-owned viewports. Scene-graph ownership and
 * camera access stay inside the Studio viewport implementations; authored truth
 * flows through shell stores rather than imperative viewport calls.
 */

export interface WorkspaceViewport {
  setProjectionMode: (mode: "perspective" | "orthographic-top") => void;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  resize: (width: number, height: number) => void;
  render: () => void;
  subscribeFrame: (listener: () => void) => () => void;
}

export type PlayerWorkspaceViewport = WorkspaceViewport;
export type NPCWorkspaceViewport = WorkspaceViewport;
export type ItemWorkspaceViewport = WorkspaceViewport;
