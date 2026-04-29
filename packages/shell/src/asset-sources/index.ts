/**
 * Asset-source store.
 *
 * Owns the derived "relative authored asset path -> fetchable blob URL" map
 * for Studio. This is not authored truth and it is not render-web runtime
 * state; it is the shell-level bridge between project file handles and the
 * shared viewport/render loaders. File-backed definitions include models,
 * animation GLBs, textures, and painted mask textures.
 */

import { createStore } from "zustand/vanilla";
import { readBlobFile } from "@sugarmagic/io";
import type { ProjectStore } from "../project";

function revokeAssetSources(assetSources: Record<string, string>): void {
  for (const url of Object.values(assetSources)) {
    URL.revokeObjectURL(url);
  }
}

function collectRelativeAssetPaths(
  projectStore: ProjectStore
): string[] {
  const session = projectStore.getState().session;
  if (!session) {
    return [];
  }

  const sources = [
    ...(session.contentLibrary.assetDefinitions ?? []).map((definition) => definition.source),
    ...(session.contentLibrary.characterModelDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(session.contentLibrary.characterAnimationDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(session.contentLibrary.textureDefinitions ?? []).map(
      (definition) => definition.source
    ),
    ...(session.contentLibrary.maskTextureDefinitions ?? []).map(
      (definition) => definition.source
    )
  ];

  return sources
    .map((source) => source.relativeAssetPath)
    .sort();
}

async function createAssetSourceMap(
  handle: FileSystemDirectoryHandle,
  relativeAssetPaths: string[]
): Promise<Record<string, string>> {
  const nextSources: Record<string, string> = {};

  for (const relativeAssetPath of relativeAssetPaths) {
    const pathSegments = relativeAssetPath.split("/").filter(Boolean);
    const blob = await readBlobFile(handle, ...pathSegments);
    if (!blob) {
      continue;
    }
    nextSources[relativeAssetPath] = URL.createObjectURL(blob);
  }

  return nextSources;
}

export interface AssetSourceState {
  sources: Record<string, string>;
  syncCount: number;
}

export interface AssetSourceActions {
  start: (
    handle: FileSystemDirectoryHandle,
    projectStore: ProjectStore
  ) => void;
  refreshPaths: (relativeAssetPaths: string[]) => Promise<void>;
  stop: () => void;
}

export type AssetSourceStore = ReturnType<typeof createAssetSourceStore>;

export function createAssetSourceStore() {
  let unsubscribeProject: (() => void) | null = null;
  let currentHandle: FileSystemDirectoryHandle | null = null;
  let currentPathsKey = "";
  let generation = 0;

  const store = createStore<AssetSourceState & AssetSourceActions>()((set, get) => {
    async function syncFromProject(projectStore: ProjectStore, handle: FileSystemDirectoryHandle) {
      const nextPaths = collectRelativeAssetPaths(projectStore);
      const nextPathsKey = nextPaths.join("|");
      if (nextPathsKey === currentPathsKey) {
        return;
      }

      currentPathsKey = nextPathsKey;
      const syncGeneration = ++generation;
      const previousSources = get().sources;

      if (nextPaths.length === 0) {
        set((state) => ({
          sources: {},
          syncCount: state.syncCount + 1
        }));
        revokeAssetSources(previousSources);
        return;
      }

      const nextSources = await createAssetSourceMap(handle, nextPaths);
      if (syncGeneration !== generation || currentHandle !== handle) {
        revokeAssetSources(nextSources);
        return;
      }

      set((state) => ({
        sources: nextSources,
        syncCount: state.syncCount + 1
      }));
      revokeAssetSources(previousSources);
    }

    function clearAllSources() {
      generation += 1;
      currentPathsKey = "";
      const previousSources = get().sources;
      if (Object.keys(previousSources).length === 0) {
        return;
      }
      set((state) => ({
        sources: {},
        syncCount: state.syncCount + 1
      }));
      revokeAssetSources(previousSources);
    }

    async function refreshPaths(relativeAssetPaths: string[]) {
      const handle = currentHandle;
      if (!handle) {
        return;
      }

      const nextPaths = Array.from(
        new Set(relativeAssetPaths.map((path) => path.trim()).filter(Boolean))
      ).sort();
      if (nextPaths.length === 0) {
        return;
      }

      const previousSources = get().sources;
      const refreshedSources = await createAssetSourceMap(handle, nextPaths);
      if (handle !== currentHandle) {
        revokeAssetSources(refreshedSources);
        return;
      }

      const mergedSources = { ...previousSources };
      for (const relativeAssetPath of nextPaths) {
        const previousUrl = mergedSources[relativeAssetPath];
        const refreshedUrl = refreshedSources[relativeAssetPath];
        if (previousUrl && previousUrl !== refreshedUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        if (refreshedUrl) {
          mergedSources[relativeAssetPath] = refreshedUrl;
        } else {
          delete mergedSources[relativeAssetPath];
        }
      }

      set((state) => ({
        sources: mergedSources,
        syncCount: state.syncCount + 1
      }));
    }

    return {
      sources: {},
      syncCount: 0,
      start(handle, projectStore) {
        if (unsubscribeProject) {
          unsubscribeProject();
          unsubscribeProject = null;
        }

        const isProjectSwitch = currentHandle !== handle;
        currentHandle = handle;
        if (isProjectSwitch || currentPathsKey.length > 0) {
          clearAllSources();
        }
        void syncFromProject(projectStore, handle);

        unsubscribeProject = projectStore.subscribe(() => {
          if (!currentHandle) {
            return;
          }
          void syncFromProject(projectStore, currentHandle);
        });
      },
      refreshPaths,
      stop() {
        if (unsubscribeProject) {
          unsubscribeProject();
          unsubscribeProject = null;
        }
        currentHandle = null;
        clearAllSources();
      }
    };
  });

  return store;
}
