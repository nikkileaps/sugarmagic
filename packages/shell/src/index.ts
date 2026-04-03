import { createStore } from "zustand/vanilla";
import {
  getProductModeDescriptor,
  productModes,
  type ProductModeDescriptor,
  type ProductModeId
} from "@sugarmagic/productmodes";
import type { AppFrameModel } from "./app-frame";
import type { CommandSurfaceRegistration } from "./commands";
import type { InspectorHostModel } from "./inspector-host";
import type { NavigationModel } from "./navigation";
import type { StatusSurfaceModel } from "./status";
import type { ViewportHostModel } from "./viewport-host";
import type { WorkspaceHostModel } from "./workspace-host";

export * from "./app-frame";
export * from "./commands";
export * from "./inspector-host";
export * from "./navigation";
export * from "./preview";
export * from "./project";
export * from "./status";
export * from "./viewport-host";
export * from "./workspace-host";

export type BuildWorkspaceKind = "layout" | "landscape" | "environment" | "assets";
export type DesignWorkspaceKind = "player";

export interface ShellSelectionState {
  workspaceId: string | null;
  entityIds: string[];
}

export interface ShellToolSessionState {
  workspaceId: string | null;
  toolId: string | null;
  isActive: boolean;
}

export interface ShellPanelState {
  structure: boolean;
  inspector: boolean;
  status: boolean;
}

export interface ShellState {
  activeProductMode: ProductModeId;
  activeBuildWorkspaceKind: BuildWorkspaceKind;
  activeDesignWorkspaceKind: DesignWorkspaceKind;
  activeRegionId: string | null;
  activeEnvironmentId: string | null;
  activeWorkspaceId: string | null;
  navigation: NavigationModel;
  panels: ShellPanelState;
  selection: ShellSelectionState;
  toolSession: ShellToolSessionState;
}

export interface ShellActions {
  setActiveProductMode: (productModeId: ProductModeId) => void;
  setActiveBuildWorkspaceKind: (kind: BuildWorkspaceKind) => void;
  setActiveDesignWorkspaceKind: (kind: DesignWorkspaceKind) => void;
  setActiveRegionId: (regionId: string | null) => void;
  setActiveEnvironmentId: (environmentId: string | null) => void;
  setActiveWorkspace: (workspaceId: string | null) => void;
  setSelection: (entityIds: string[]) => void;
  setToolSession: (toolId: string | null, isActive: boolean) => void;
  togglePanel: (panel: keyof ShellPanelState) => void;
}

export type ShellStore = ReturnType<typeof createShellStore>;

export function deriveBuildWorkspaceId(
  kind: BuildWorkspaceKind,
  contextId: string | null
): string | null {
  if (!contextId) return null;
  return `build:${kind}:${contextId}`;
}

export function deriveDesignWorkspaceId(
  kind: DesignWorkspaceKind
): string {
  return `design:${kind}`;
}

function getBuildContextId(
  state: Pick<ShellState, "activeBuildWorkspaceKind" | "activeRegionId" | "activeEnvironmentId">,
  kind: BuildWorkspaceKind = state.activeBuildWorkspaceKind
): string | null {
  if (kind === "environment") {
    return state.activeEnvironmentId;
  }
  return state.activeRegionId;
}

function deriveWorkspaceIdForMode(
  state: Pick<
    ShellState,
    | "activeProductMode"
    | "activeBuildWorkspaceKind"
    | "activeDesignWorkspaceKind"
    | "activeRegionId"
    | "activeEnvironmentId"
  >,
  productModeId: ProductModeId = state.activeProductMode
): string | null {
  if (productModeId === "design") {
    return deriveDesignWorkspaceId(state.activeDesignWorkspaceKind);
  }

  if (productModeId === "build") {
    return deriveBuildWorkspaceId(
      state.activeBuildWorkspaceKind,
      getBuildContextId(state, state.activeBuildWorkspaceKind)
    );
  }

  return null;
}

export interface ShellModel {
  appFrame: AppFrameModel;
  productModes: ProductModeDescriptor[];
  workspaceHost: WorkspaceHostModel;
  viewportHost: ViewportHostModel;
  inspectorHost: InspectorHostModel;
  commandSurface: CommandSurfaceRegistration;
  statusSurface: StatusSurfaceModel;
}

export function createShellStore(
  initialProductMode: ProductModeId = "build"
) {
  const initialWorkspaceId =
    initialProductMode === "design"
      ? deriveDesignWorkspaceId("player")
      : null;

  return createStore<ShellState & ShellActions>()((set, get) => ({
    activeProductMode: initialProductMode,
    activeBuildWorkspaceKind: "layout" as BuildWorkspaceKind,
    activeDesignWorkspaceKind: "player" as DesignWorkspaceKind,
    activeRegionId: null,
    activeEnvironmentId: null,
    activeWorkspaceId: initialWorkspaceId,
    navigation: {
      activeProductMode: initialProductMode,
      activeWorkspaceId: initialWorkspaceId
    },
    panels: {
      structure: true,
      inspector: true,
      status: true
    },
    selection: {
      workspaceId: null,
      entityIds: []
    },
    toolSession: {
      workspaceId: null,
      toolId: null,
      isActive: false
    },
    setActiveProductMode: (productModeId) =>
      set((state) => {
        const workspaceId = deriveWorkspaceIdForMode(state, productModeId);
        return {
          activeProductMode: productModeId,
          activeWorkspaceId: workspaceId,
          navigation: {
            ...state.navigation,
            activeProductMode: productModeId,
            activeWorkspaceId: workspaceId
          },
          selection: { workspaceId, entityIds: [] },
          toolSession: { workspaceId, toolId: null, isActive: false }
        };
      }),
    setActiveBuildWorkspaceKind: (kind) => {
      const state = get();
      const contextId = getBuildContextId(state, kind);
      const workspaceId = deriveBuildWorkspaceId(kind, contextId);
      set((current) => ({
        activeBuildWorkspaceKind: kind,
        activeWorkspaceId:
          current.activeProductMode === "build"
            ? workspaceId
            : current.activeWorkspaceId,
        navigation: {
          ...current.navigation,
          activeWorkspaceId:
            current.activeProductMode === "build"
              ? workspaceId
              : current.navigation.activeWorkspaceId
        },
        selection:
          current.activeProductMode === "build"
            ? { workspaceId, entityIds: [] }
            : current.selection,
        toolSession:
          current.activeProductMode === "build"
            ? { workspaceId, toolId: null, isActive: false }
            : current.toolSession
      }));
    },
    setActiveDesignWorkspaceKind: (kind) => {
      const workspaceId = deriveDesignWorkspaceId(kind);
      set((state) => ({
        activeDesignWorkspaceKind: kind,
        activeWorkspaceId:
          state.activeProductMode === "design"
            ? workspaceId
            : state.activeWorkspaceId,
        navigation: {
          ...state.navigation,
          activeWorkspaceId:
            state.activeProductMode === "design"
              ? workspaceId
              : state.navigation.activeWorkspaceId
        },
        selection:
          state.activeProductMode === "design"
            ? { workspaceId, entityIds: [] }
            : state.selection,
        toolSession:
          state.activeProductMode === "design"
            ? { workspaceId, toolId: null, isActive: false }
            : state.toolSession
      }));
    },
    setActiveRegionId: (regionId) => {
      const state = get();
      const workspaceId =
        state.activeProductMode !== "build"
          ? state.activeWorkspaceId
          : state.activeBuildWorkspaceKind === "environment"
            ? state.activeWorkspaceId
            : deriveBuildWorkspaceId(state.activeBuildWorkspaceKind, regionId);
      set((current) => ({
        activeRegionId: regionId,
        activeWorkspaceId: workspaceId,
        navigation: {
          ...current.navigation,
          activeWorkspaceId: workspaceId
        },
        selection:
          state.activeProductMode !== "build" ||
          state.activeBuildWorkspaceKind === "environment"
            ? current.selection
            : { workspaceId, entityIds: [] },
        toolSession:
          state.activeProductMode !== "build" ||
          state.activeBuildWorkspaceKind === "environment"
            ? current.toolSession
            : { workspaceId, toolId: null, isActive: false }
      }));
    },
    setActiveEnvironmentId: (environmentId) => {
      const state = get();
      const workspaceId =
        state.activeProductMode === "build" &&
        state.activeBuildWorkspaceKind === "environment"
          ? deriveBuildWorkspaceId("environment", environmentId)
          : state.activeWorkspaceId;
      set((current) => ({
        activeEnvironmentId: environmentId,
        activeWorkspaceId: workspaceId,
        navigation: {
          ...current.navigation,
          activeWorkspaceId: workspaceId
        },
        selection:
          state.activeBuildWorkspaceKind === "environment"
            ? { workspaceId, entityIds: [] }
            : current.selection,
        toolSession:
          state.activeBuildWorkspaceKind === "environment"
            ? { workspaceId, toolId: null, isActive: false }
            : current.toolSession
      }));
    },
    setActiveWorkspace: (workspaceId) =>
      set((state) => ({
        activeWorkspaceId: workspaceId,
        navigation: {
          ...state.navigation,
          activeWorkspaceId: workspaceId
        },
        selection: {
          ...state.selection,
          workspaceId
        },
        toolSession: {
          ...state.toolSession,
          workspaceId
        }
      })),
    setSelection: (entityIds) =>
      set((state) => ({
        selection: {
          ...state.selection,
          entityIds
        }
      })),
    setToolSession: (toolId, isActive) =>
      set((state) => ({
        toolSession: {
          ...state.toolSession,
          toolId,
          isActive
        }
      })),
    togglePanel: (panel) =>
      set((state) => ({
        panels: {
          ...state.panels,
          [panel]: !state.panels[panel]
        }
      }))
  }));
}

export function createShellModel(input: {
  title: string;
  workspaceId: string;
  workspaceKind: string;
  subjectId: string;
  productModeId: ProductModeId;
}): ShellModel {
  const productMode = getProductModeDescriptor(input.productModeId);

  return {
    appFrame: {
      title: input.title,
      shellId: "sugarmagic-studio-shell"
    },
    productModes,
    workspaceHost: {
      workspaceId: input.workspaceId,
      workspaceKind: input.workspaceKind,
      subjectId: input.subjectId
    },
    viewportHost: {
      cameraScope: "workspace",
      overlayIds: [`${productMode.id}-workspace-overlay`]
    },
    inspectorHost: {
      panelIds: ["structure", "inspector", "status"]
    },
    commandSurface: {
      surfaceId: productMode.commandSurfaceId,
      commandIds: [
        `${productMode.id}.openWorkspace`,
        `${productMode.id}.activatePrimaryTool`
      ]
    },
    statusSurface: {
      message: `${productMode.label} workspace ready`,
      severity: "info"
    }
  };
}
