/**
 * Viewport projection helpers.
 *
 * Combines shell-level stores into one derived snapshot the viewport can
 * consume. This keeps authored truth, shell selection, asset-source bridging,
 * and transient viewport drafts flowing through one observable path.
 */

import type {
  ContentLibrarySnapshot,
  ItemDefinition,
  NPCDefinition,
  PlayerDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import {
  getActiveRegion,
  getPlayerDefinition,
  getAllItemDefinitions,
  getAllNPCDefinitions
} from "@sugarmagic/domain";
import type { AssetSourceState, AssetSourceStore } from "../asset-sources";
import type {
  DesignPreviewState,
  DesignPreviewStore
} from "../design-preview";
import type { ProjectState, ProjectStore } from "../project";
import type { ShellState, ShellStore } from "../index";
import type { ViewportState, ViewportStore } from "../viewport";

export interface ViewportProjection {
  region: RegionDocument | null;
  contentLibrary: ContentLibrarySnapshot | null;
  playerDefinition: PlayerDefinition | null;
  itemDefinitions: ItemDefinition[];
  npcDefinitions: NPCDefinition[];
  assetSources: AssetSourceState["sources"];
  environmentOverrideId: string | null;
  selection: ShellState["selection"];
  landscapeOverride: ViewportState["landscapeDraft"];
  transformOverrides: ViewportState["transformDrafts"];
  cursor: ViewportState["activeToolCursor"];
}

export interface PlayerPreviewProjection {
  playerDefinition: PlayerDefinition | null;
  contentLibrary: ContentLibrarySnapshot | null;
  assetSources: AssetSourceState["sources"];
  animationSlot: string | null;
  isAnimationPlaying: boolean;
  cameraFraming: DesignPreviewState["cameraFraming"];
  environmentOverrideId: string | null;
}

export interface NPCPreviewProjection {
  npcDefinition: NPCDefinition | null;
  contentLibrary: ContentLibrarySnapshot | null;
  assetSources: AssetSourceState["sources"];
  animationSlot: string | null;
  isAnimationPlaying: boolean;
  cameraFraming: DesignPreviewState["cameraFraming"];
  environmentOverrideId: string | null;
}

export interface ItemPreviewProjection {
  itemDefinition: ItemDefinition | null;
  contentLibrary: ContentLibrarySnapshot | null;
  assetSources: AssetSourceState["sources"];
  cameraFraming: DesignPreviewState["cameraFraming"];
  environmentOverrideId: string | null;
}

export interface StoreBundleState {
  project: ProjectState;
  shell: ShellState;
  viewport: ViewportState;
  assetSources: AssetSourceState;
  designPreview: DesignPreviewState;
}

export interface ProjectionStores {
  projectStore: ProjectStore;
  shellStore: ShellStore;
  viewportStore: ViewportStore;
  assetSourceStore: AssetSourceStore;
  designPreviewStore: DesignPreviewStore;
}

function getStoreBundleState(stores: ProjectionStores): StoreBundleState {
  return {
    project: stores.projectStore.getState(),
    shell: stores.shellStore.getState(),
    viewport: stores.viewportStore.getState(),
    assetSources: stores.assetSourceStore.getState(),
    designPreview: stores.designPreviewStore.getState()
  };
}

/**
 * One-level equality for projection slices.
 *
 * This intentionally follows the usual zustand selector contract: nested
 * objects/arrays are compared by reference, not deep contents. Store actions
 * that feed projection slices must therefore publish fresh nested references on
 * every real semantic change so viewport subscribers observe them reliably.
 */
export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }

  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightEntries = Object.entries(right as Record<string, unknown>);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (!Object.is(value, (right as Record<string, unknown>)[key])) {
      return false;
    }
  }

  return true;
}

export function selectViewportProjection(
  project: ProjectState,
  shell: ShellState,
  viewport: ViewportState,
  assetSources: AssetSourceState
): ViewportProjection {
  const session = project.session;
  return {
    region: session ? getActiveRegion(session) : null,
    contentLibrary: session?.contentLibrary ?? null,
    playerDefinition: session ? getPlayerDefinition(session) : null,
    itemDefinitions: session ? getAllItemDefinitions(session) : [],
    npcDefinitions: session ? getAllNPCDefinitions(session) : [],
    assetSources: assetSources.sources,
    environmentOverrideId: shell.activeEnvironmentId,
    selection: shell.selection,
    landscapeOverride: viewport.landscapeDraft,
    transformOverrides: viewport.transformDrafts,
    cursor: viewport.activeToolCursor
  };
}

export function selectPlayerPreviewProjection(
  project: ProjectState,
  shell: ShellState,
  designPreview: DesignPreviewState,
  assetSources: AssetSourceState
): PlayerPreviewProjection {
  const session = project.session;
  const playerDefinition =
    session && designPreview.activeDefinitionId
      ? session.gameProject.playerDefinition.definitionId === designPreview.activeDefinitionId
        ? session.gameProject.playerDefinition
        : null
      : session?.gameProject.playerDefinition ?? null;

  return {
    playerDefinition,
    contentLibrary: session?.contentLibrary ?? null,
    assetSources: assetSources.sources,
    animationSlot: designPreview.activeAnimationSlot,
    isAnimationPlaying: designPreview.isAnimationPlaying,
    cameraFraming: designPreview.cameraFraming,
    environmentOverrideId: shell.activeEnvironmentId
  };
}

export function selectNPCPreviewProjection(
  project: ProjectState,
  shell: ShellState,
  designPreview: DesignPreviewState,
  assetSources: AssetSourceState
): NPCPreviewProjection {
  const session = project.session;
  const npcDefinition =
    session && designPreview.activeDefinitionId
      ? session.gameProject.npcDefinitions.find(
          (definition) => definition.definitionId === designPreview.activeDefinitionId
        ) ?? null
      : null;

  return {
    npcDefinition,
    contentLibrary: session?.contentLibrary ?? null,
    assetSources: assetSources.sources,
    animationSlot: designPreview.activeAnimationSlot,
    isAnimationPlaying: designPreview.isAnimationPlaying,
    cameraFraming: designPreview.cameraFraming,
    environmentOverrideId: shell.activeEnvironmentId
  };
}

export function selectItemPreviewProjection(
  project: ProjectState,
  shell: ShellState,
  designPreview: DesignPreviewState,
  assetSources: AssetSourceState
): ItemPreviewProjection {
  const session = project.session;
  const itemDefinition =
    session && designPreview.activeDefinitionId
      ? session.gameProject.itemDefinitions.find(
          (definition) => definition.definitionId === designPreview.activeDefinitionId
        ) ?? null
      : null;

  return {
    itemDefinition,
    contentLibrary: session?.contentLibrary ?? null,
    assetSources: assetSources.sources,
    cameraFraming: designPreview.cameraFraming,
    environmentOverrideId: shell.activeEnvironmentId
  };
}

export function subscribeToProjection<T>(
  stores: ProjectionStores,
  selector: (state: StoreBundleState) => T,
  listener: (next: T) => void,
  opts?: { equalityFn?: (left: T, right: T) => boolean }
): () => void {
  const equalityFn = opts?.equalityFn ?? Object.is;
  let current = selector(getStoreBundleState(stores));
  listener(current);

  const onAnyStoreChange = () => {
    const next = selector(getStoreBundleState(stores));
    if (equalityFn(current, next)) {
      return;
    }
    current = next;
    listener(next);
  };

  const unsubscribers = [
    stores.projectStore.subscribe(onAnyStoreChange),
    stores.shellStore.subscribe(onAnyStoreChange),
    stores.viewportStore.subscribe(onAnyStoreChange),
    stores.assetSourceStore.subscribe(onAnyStoreChange),
    stores.designPreviewStore.subscribe(onAnyStoreChange)
  ];

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
