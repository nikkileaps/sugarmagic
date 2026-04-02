/**
 * WorkspaceView contract.
 *
 * Each workspace kind provides content for the shell's panels
 * and manages its own interaction lifecycle. The shell stays
 * uniform — workspace views plug into it, not redefine it.
 */

import type { ReactNode } from "react";
import type { WorkspaceViewport } from "./viewport";

export interface WorkspaceViewContext {
  viewport: WorkspaceViewport | null;
  viewportElement: HTMLElement | null;
}

export interface WorkspaceViewContribution {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  viewportOverlay: ReactNode;
}
