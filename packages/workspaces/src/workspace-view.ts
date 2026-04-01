/**
 * WorkspaceView contract.
 *
 * Each workspace kind provides content for the shell's panels
 * and manages its own interaction lifecycle. The shell stays
 * uniform — workspace views plug into it, not redefine it.
 */

import type { ReactNode } from "react";
import type { RuntimeViewport } from "@sugarmagic/runtime-web";

export interface WorkspaceViewContext {
  viewport: RuntimeViewport | null;
  viewportElement: HTMLElement | null;
}

export interface WorkspaceViewContribution {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  viewportOverlay: ReactNode;
}
