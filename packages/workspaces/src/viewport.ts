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
  /** Plan 068.8 -- drop every renderable built from this asset
   *  definition so the next projection pass reloads them (used after
   *  the asset's source GLB is rewritten, e.g. paint-UV baking).
   *  Optional: only the authoring viewport implements it. */
  reloadAssetRenderables?: (assetDefinitionId: string) => void;
}

export type PlayerWorkspaceViewport = WorkspaceViewport;
export type NPCWorkspaceViewport = WorkspaceViewport;
export type ItemWorkspaceViewport = WorkspaceViewport;
