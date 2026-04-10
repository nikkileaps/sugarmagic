import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, Group, Menu, UnstyledButton, Modal, Stack, Switch, Badge } from "@mantine/core";
import { productModes } from "@sugarmagic/productmodes";
import type { SemanticCommand, RegionDocument } from "@sugarmagic/domain";
import {
  createAuthoringSession,
  applyCommand,
  undoSession,
  markSessionClean,
  switchActiveRegion,
  addRegionToSession,
  getActiveRegion,
  getAllRegions,
  getAllAssetDefinitions,
  getAllDialogueDefinitions,
  getAllDocumentDefinitions,
  getAllEnvironmentDefinitions,
  getAllItemDefinitions,
  getAllNPCDefinitions,
  getAllPluginConfigurations,
  getPluginConfiguration,
  getAllQuestDefinitions,
  getAllSpellDefinitions,
  getPlayerDefinition,
  addAssetDefinitionToSession,
  addEnvironmentDefinitionToSession,
  updateAssetDefinitionInSession,
  removeAssetDefinitionFromSession,
  assetDefinitionHasSceneReferences,
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState
} from "@sugarmagic/domain";
import {
  buildSugarlangPreviewBootPayloadForSession,
  collectPluginShellContributions,
  ensureDiscoveredPluginConfiguration,
  listDiscoveredPluginDefinitions,
  planGameDeployment,
  resolveInstalledPluginDefinitions
} from "@sugarmagic/plugins";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  pickDirectory,
  readBlobFile,
  saveProject,
  saveProjectWithManagedFiles,
  inspectManagedProjectFiles,
  reloadProject,
  importSourceAsset
} from "@sugarmagic/io";
import {
  createShellStore,
  createProjectStore,
  createPreviewStore,
  CORE_DESIGN_WORKSPACE_KINDS,
  designWorkspaceRequiresViewport,
  type AuthoringContextSnapshot
} from "@sugarmagic/shell";
import {
  useBuildProductModeView,
  useDesignProductModeView,
  type ItemWorkspaceViewport,
  type NPCWorkspaceViewport,
  type WorkspaceNavigationTarget,
  type WorkspaceViewport,
  type PlayerWorkspaceViewport
} from "@sugarmagic/workspaces";
import {
  ActionStripe,
  CreateRegionDialog,
  ModeBar,
  ProjectManagerDialog,
  ShellFrame,
  StatusBar,
  ViewportFrame,
  shellIcons,
  type ModeBarItem
} from "@sugarmagic/ui";
import { useStore } from "zustand";
import { createAuthoringViewport } from "./viewport/authoringViewport";
import { createItemViewport } from "./viewport/itemViewport";
import { createNPCViewport } from "./viewport/npcViewport";
import { createPlayerViewport } from "./viewport/playerViewport";
import {
  getStudioPluginWorkspaceDefinition,
  listStudioPluginWorkspaceDefinitions
} from "./plugins/catalog";
import { readStudioPluginRuntimeEnvironment } from "./runtimeEnv";
import { SUGARDEPLOY_PLUGIN_ID } from "@sugarmagic/plugins";
import { resolveNPCInteractionOptions } from "@sugarmagic/workspaces";

function revokeAssetSources(assetSources: Record<string, string>) {
  for (const url of Object.values(assetSources)) {
    URL.revokeObjectURL(url);
  }
}

async function createAssetSourceMap(
  handle: FileSystemDirectoryHandle,
  assetDefinitions: ReturnType<typeof getAllAssetDefinitions>
): Promise<Record<string, string>> {
  const nextSources: Record<string, string> = {};

  for (const definition of assetDefinitions) {
    const pathSegments = definition.source.relativeAssetPath
      .split("/")
      .filter(Boolean);
    const blob = await readBlobFile(handle, ...pathSegments);
    if (!blob) continue;
    nextSources[definition.source.relativeAssetPath] = URL.createObjectURL(blob);
  }

  return nextSources;
}

const shellStore = createShellStore("build");
const projectStore = createProjectStore();
const previewStore = createPreviewStore();

const modeBarItems: ModeBarItem[] = productModes.map((mode) => ({
  id: mode.id,
  label: mode.label,
  icon: shellIcons[mode.id as keyof typeof shellIcons] ?? ""
}));

// --- Error handling ---

function handleProjectError(e: unknown) {
  if (e instanceof DOMException && e.name === "AbortError") return;
  window.alert(`An error occurred: ${e}`);
  projectStore.getState().reset();
}

// --- Project lifecycle ---

function activateRegion(region: RegionDocument | undefined) {
  if (!region) return;
  shellStore.getState().setActiveRegionId(region.identity.id);
}

function activateDefaultEnvironment(environmentId: string | null | undefined) {
  shellStore.getState().setActiveEnvironmentId(environmentId ?? null);
}

async function handleOpenProject() {
  try {
    const active = await openProject();
    const session = createAuthoringSession(
      active.gameProject,
      active.regions,
      active.contentLibrary
    );
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
    activateDefaultEnvironment(
      session.contentLibrary.environmentDefinitions[0]?.definitionId
    );
  } catch (e) {
    handleProjectError(e);
  }
}

async function handleCreateProject(input: { gameName: string; slug: string }) {
  try {
    const handle = await pickDirectory();
    const hasExisting = await checkDirectoryHasProject(handle);
    if (hasExisting && !window.confirm("This directory already contains a Sugarmagic project. Replace it?")) return;
    const active = await createProjectInDirectory(handle, input);
    const session = createAuthoringSession(
      active.gameProject,
      active.regions,
      active.contentLibrary
    );
    projectStore.getState().setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
    activateDefaultEnvironment(
      session.contentLibrary.environmentDefinitions[0]?.definitionId
    );
  } catch (e) {
    handleProjectError(e);
  }
}

function dispatchCommand(command: SemanticCommand) {
  const { session } = projectStore.getState();
  if (!session) return;
  if (command.target.aggregateKind === "region-document" && !getActiveRegion(session)) {
    return;
  }
  projectStore.getState().updateSession(applyCommand(session, command));
}

async function handleSave() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;
  const sugarDeployConfiguration = getPluginConfiguration(
    session.gameProject.pluginConfigurations,
    SUGARDEPLOY_PLUGIN_ID
  );
  const canRunSugarDeploy = sugarDeployConfiguration?.enabled === true;
  const deploymentPlan =
    canRunSugarDeploy && session.gameProject.deployment.deploymentTargetId
      ? planGameDeployment(session.gameProject)
      : null;

  if (deploymentPlan?.status === "invalid") {
    window.alert(
      `Deployment plan is invalid and managed deployment files were not generated:\n\n${deploymentPlan.conflicts
        .map((conflict) => `- ${conflict.message}`)
        .join("\n")}`
    );
    await saveProject({
      handle,
      descriptor,
      gameProject: session.gameProject,
      contentLibrary: session.contentLibrary,
      regions: getAllRegions(session)
    });
    projectStore.getState().updateSession(markSessionClean(session));
    return;
  }

  const managedFiles = deploymentPlan?.managedFiles ?? [];
  const inspection = await inspectManagedProjectFiles({
    handle,
    managedFiles
  });

  if (inspection.changedManagedFiles.length > 0) {
    const changedOnly = inspection.changedManagedFiles.filter(
      (path) => !inspection.driftedManagedFiles.includes(path)
    );
    const messageParts = [
      "SugarDeploy detected existing managed deployment files that will be regenerated on save."
    ];
    if (changedOnly.length > 0) {
      messageParts.push(
        "",
        "Generated files to overwrite:",
        ...changedOnly.map((path) => `- ${path}`)
      );
    }
    if (inspection.driftedManagedFiles.length > 0) {
      messageParts.push(
        "",
        "Files with manual edits that will be overwritten:",
        ...inspection.driftedManagedFiles.map((path) => `- ${path}`)
      );
    }
    messageParts.push("", "Overwrite these managed deployment files?");

    const confirmed = window.confirm(messageParts.join("\n"));
    if (!confirmed) {
      await saveProject({
        handle,
        descriptor,
        gameProject: session.gameProject,
        contentLibrary: session.contentLibrary,
        regions: getAllRegions(session)
      });
      projectStore.getState().updateSession(markSessionClean(session));
      return;
    }
  }

  await saveProjectWithManagedFiles({
    handle,
    descriptor,
    gameProject: session.gameProject,
    contentLibrary: session.contentLibrary,
    regions: getAllRegions(session),
    managedFiles,
    overwriteManagedFiles: inspection.changedManagedFiles.length > 0
  });

  projectStore.getState().updateSession(markSessionClean(session));
}

async function handleReload() {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) return;
  const reloaded = await reloadProject({
    handle,
    descriptor,
    gameProject: session.gameProject,
    contentLibrary: session.contentLibrary,
    regions: getAllRegions(session)
  });
  const newSession = createAuthoringSession(
    reloaded.gameProject,
    reloaded.regions,
    reloaded.contentLibrary
  );
  projectStore.getState().setActive(reloaded.handle, reloaded.descriptor, newSession);
  activateRegion(reloaded.regions[0]);
  activateDefaultEnvironment(
    newSession.contentLibrary.environmentDefinitions[0]?.definitionId
  );
}

function handleRegionSelect(regionId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(switchActiveRegion(session, regionId));
  shellStore.getState().setActiveRegionId(regionId);
}

// --- Preview ---

function handleStartPreview(
  assetSources: Record<string, string>,
  installedPluginIds: string[]
) {
  const { session } = projectStore.getState();
  if (!session) return;

  const shell = shellStore.getState();

  // Snapshot authoring context
  const snapshot: AuthoringContextSnapshot = {
    activeProductMode: shell.activeProductMode,
    activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
    activeDesignWorkspaceKind: shell.activeDesignWorkspaceKind,
    activeRegionId: shell.activeRegionId,
    activeEnvironmentId: shell.activeEnvironmentId,
    activeWorkspaceId: shell.activeWorkspaceId,
    selectedEntityIds: shell.selection.entityIds
  };

  // Open preview window
  const previewWindow = window.open(
    "/preview.html",
    "sugarmagic-preview",
    "width=1280,height=720"
  );
  if (!previewWindow) {
    window.alert("Could not open preview window. Check your popup blocker.");
    return;
  }

  previewStore.getState().startPreview(snapshot, previewWindow);

  // Wait for preview ready, then send boot data
  const capturedSession = session;
  const capturedWindow = previewWindow;
  async function onMessage(event: MessageEvent) {
    if (event.data?.type === "PREVIEW_READY") {
      window.removeEventListener("message", onMessage);
      const regions = getAllRegions(capturedSession);
      capturedWindow.postMessage(
        {
          type: "PREVIEW_BOOT",
          regions,
          activeRegionId: capturedSession.activeRegionId,
          activeEnvironmentId: snapshot.activeEnvironmentId,
          installedPluginIds,
          pluginRuntimeEnvironment: readStudioPluginRuntimeEnvironment(),
          pluginConfigurations: capturedSession.gameProject.pluginConfigurations,
          contentLibrary: capturedSession.contentLibrary,
          playerDefinition: capturedSession.gameProject.playerDefinition,
          spellDefinitions: capturedSession.gameProject.spellDefinitions,
          itemDefinitions: capturedSession.gameProject.itemDefinitions,
          documentDefinitions: capturedSession.gameProject.documentDefinitions,
          npcDefinitions: capturedSession.gameProject.npcDefinitions,
          dialogueDefinitions: capturedSession.gameProject.dialogueDefinitions,
          questDefinitions: capturedSession.gameProject.questDefinitions,
          assetSources,
          pluginBootPayloads: {
            sugarlang:
              (await buildSugarlangPreviewBootPayloadForSession(
                capturedSession,
                snapshot.activeWorkspaceId ??
                  capturedSession.gameProject.identity.id,
                readStudioPluginRuntimeEnvironment()
              )) ?? undefined
          }
        },
        "*"
      );
    }
  }
  window.addEventListener("message", onMessage);

  // Handle preview window closing externally
  const checkClosed = setInterval(() => {
    if (previewWindow.closed) {
      clearInterval(checkClosed);
      handleStopPreview();
    }
  }, 500);
}

function handleStopPreview() {
  const snapshot = previewStore.getState().stopPreview();
  if (!snapshot) return;

  // Restore authoring context
  const shell = shellStore.getState();
  shell.setActiveProductMode(snapshot.activeProductMode);
  if (snapshot.activeProductMode === "build") {
    shell.setActiveBuildWorkspaceKind(snapshot.activeBuildWorkspaceKind);
  }
  if (snapshot.activeProductMode === "design") {
    shell.setActiveDesignWorkspaceKind(snapshot.activeDesignWorkspaceKind);
  }
  if (snapshot.activeRegionId) {
    shell.setActiveRegionId(snapshot.activeRegionId);
  }
  shell.setActiveEnvironmentId(snapshot.activeEnvironmentId ?? null);
  shell.setSelection(snapshot.selectedEntityIds);
}

// --- App ---

export function App() {
  const activeProductMode = useStore(shellStore, (s) => s.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (s) => s.activeWorkspaceId);
  const activeBuildKind = useStore(shellStore, (s) => s.activeBuildWorkspaceKind);
  const activeDesignKind = useStore(shellStore, (s) => s.activeDesignWorkspaceKind);
  const activeRegionId = useStore(shellStore, (s) => s.activeRegionId);
  const activeEnvironmentId = useStore(shellStore, (s) => s.activeEnvironmentId);
  const selectedIds = useStore(shellStore, (s) => s.selection.entityIds);

  const phase = useStore(projectStore, (s) => s.phase);
  const projectHandle = useStore(projectStore, (s) => s.handle);
  const session = useStore(projectStore, (s) => s.session);

  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;
  const isBuild = activeProductMode === "build";
  const isDesign = activeProductMode === "design";
  const isPreviewRunning = useStore(previewStore, (s) => s.isPreviewRunning);

  const regions = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session).map((r) => ({ id: r.identity.id, displayName: r.displayName }));
  }, [session]);
  const regionDocuments = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session);
  }, [session]);

  const [createRegionOpen, setCreateRegionOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [assetSources, setAssetSources] = useState<Record<string, string>>({});
  const [viewportReadyVersion, setViewportReadyVersion] = useState(0);
  const [workspaceNavigationTarget, setWorkspaceNavigationTarget] =
    useState<WorkspaceNavigationTarget | null>(null);

  const handleWorkspaceNavigation = useCallback((target: WorkspaceNavigationTarget) => {
    setWorkspaceNavigationTarget(target);
    const shell = shellStore.getState();
    if (target.kind === "quest-stage") {
      shell.setActiveProductMode("design");
      shell.setActiveDesignWorkspaceKind("quests");
      return;
    }

    shell.setActiveProductMode("build");
    shell.setActiveRegionId(target.regionId);
    shell.setActiveBuildWorkspaceKind("behavior");
  }, []);

  function handleCreateRegion(input: { displayName: string; regionId: string }) {
    if (!session) return;
    const newRegion: RegionDocument = {
      identity: { id: input.regionId, schema: "RegionDocument", version: 1 },
      displayName: input.displayName,
      placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
      scene: {
        folders: [],
        placedAssets: [],
        playerPresence: null,
        npcPresences: [],
        itemPresences: []
      },
      environmentBinding: {
        defaultEnvironmentId:
          session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null
      },
      areas: [],
      behaviors: [],
      landscape: createDefaultRegionLandscapeState(),
      markers: [],
      gameplayPlacements: []
    };
    projectStore.getState().updateSession(addRegionToSession(session, newRegion));
    shellStore.getState().setActiveRegionId(input.regionId);
    setCreateRegionOpen(false);
  }

  const assetDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAssetDefinitions(session);
  }, [session]);

  const environmentDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllEnvironmentDefinitions(session);
  }, [session]);

  const playerDefinition = useMemo(() => {
    if (!session) return null;
    return getPlayerDefinition(session);
  }, [session]);

  const npcDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllNPCDefinitions(session);
  }, [session]);

  const itemDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllItemDefinitions(session);
  }, [session]);

  const spellDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllSpellDefinitions(session);
  }, [session]);

  const documentDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllDocumentDefinitions(session);
  }, [session]);

  const dialogueDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllDialogueDefinitions(session);
  }, [session]);

  const questDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllQuestDefinitions(session);
  }, [session]);

  const pluginConfigurations = useMemo(() => {
    if (!session) return [];
    return getAllPluginConfigurations(session);
  }, [session]);
  const installedPluginIds = useMemo(
    () => pluginConfigurations.map((configuration) => configuration.pluginId),
    [pluginConfigurations]
  );

  const discoveredPlugins = useMemo(() => listDiscoveredPluginDefinitions(), []);
  const installedPlugins = useMemo(
    () => resolveInstalledPluginDefinitions(installedPluginIds),
    [installedPluginIds]
  );
  const availablePlugins = useMemo(
    () =>
      discoveredPlugins.filter(
        (plugin) => !installedPluginIds.includes(plugin.manifest.pluginId)
      ),
    [discoveredPlugins, installedPluginIds]
  );
  const pluginShellContributions = useMemo(
    () =>
      collectPluginShellContributions(pluginConfigurations, (pluginId) =>
        installedPlugins.find((plugin) => plugin.manifest.pluginId === pluginId)?.shell ??
        null
      ),
    [installedPlugins, pluginConfigurations]
  );
  const studioPluginWorkspaceDefinitions = useMemo(
    () => listStudioPluginWorkspaceDefinitions(),
    []
  );
  const studioPluginWorkspaceKinds = useMemo(
    () =>
      new Set(
        studioPluginWorkspaceDefinitions.map(
          (definition) => definition.workspaceKind
        )
      ),
    [studioPluginWorkspaceDefinitions]
  );
  const renderablePluginWorkspaceItems = useMemo(
    () =>
      pluginShellContributions.designWorkspaces.filter(
        (workspace) => studioPluginWorkspaceKinds.has(workspace.workspaceKind)
      ),
    [pluginShellContributions.designWorkspaces, studioPluginWorkspaceKinds]
  );
  const npcInteractionOptions = useMemo(
    () => resolveNPCInteractionOptions(pluginShellContributions.npcInteractionOptions),
    [pluginShellContributions.npcInteractionOptions]
  );

  useEffect(() => {
    if (activeProductMode !== "design") return;
    const availableDesignWorkspaceKinds = new Set<string>([
      ...CORE_DESIGN_WORKSPACE_KINDS,
      ...renderablePluginWorkspaceItems.map((workspace) => workspace.workspaceKind)
    ]);
    if (availableDesignWorkspaceKinds.has(activeDesignKind)) return;
    shellStore.getState().setActiveDesignWorkspaceKind("player");
  }, [activeDesignKind, activeProductMode, renderablePluginWorkspaceItems]);

  const environmentViewportOverrideId =
    activeBuildKind === "environment"
      ? activeEnvironmentId ?? environmentDefinitions[0]?.definitionId ?? null
      : null;

  useEffect(() => {
    if (!session) return;
    if (activeEnvironmentId) return;
    const firstEnvironmentId =
      session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null;
    if (!firstEnvironmentId) return;
    shellStore.getState().setActiveEnvironmentId(firstEnvironmentId);
  }, [activeEnvironmentId, session]);

  function handleSetPluginEnabled(pluginId: string, enabled: boolean) {
    if (!session) return;
    if (!installedPluginIds.includes(pluginId)) return;
    const configuration = ensureDiscoveredPluginConfiguration(
      pluginConfigurations,
      pluginId,
      enabled
    );
    dispatchCommand({
      kind: "UpdatePluginConfiguration",
      target: {
        aggregateKind: "plugin-config",
        aggregateId: configuration.identity.id
      },
      subject: {
        subjectKind: "plugin-configuration",
        subjectId: configuration.identity.id
      },
      payload: {
        configuration
      }
    });
  }

  function handleInstallPlugin(pluginId: string) {
    if (!session) return;
    if (getPluginConfiguration(pluginConfigurations, pluginId)) return;

    const configuration = ensureDiscoveredPluginConfiguration(
      pluginConfigurations,
      pluginId,
      false
    );
    dispatchCommand({
      kind: "UpdatePluginConfiguration",
      target: {
        aggregateKind: "plugin-config",
        aggregateId: configuration.identity.id
      },
      subject: {
        subjectKind: "plugin-configuration",
        subjectId: configuration.identity.id
      },
      payload: {
        configuration
      }
    });
  }

  function handleUninstallPlugin(pluginId: string) {
    const configuration = getPluginConfiguration(pluginConfigurations, pluginId);
    if (!configuration) return;

    dispatchCommand({
      kind: "DeletePluginConfiguration",
      target: {
        aggregateKind: "plugin-config",
        aggregateId: configuration.identity.id
      },
      subject: {
        subjectKind: "plugin-configuration",
        subjectId: configuration.identity.id
      },
      payload: {
        pluginId
      }
    });
  }

  useEffect(() => {
    let disposed = false;
    let generatedSources: Record<string, string> = {};

    if (!projectHandle || assetDefinitions.length === 0) {
      void Promise.resolve().then(() => {
        if (!disposed) {
          setAssetSources({});
        }
      });
      return undefined;
    }

    void createAssetSourceMap(projectHandle, assetDefinitions).then(
      (nextSources) => {
        if (disposed) {
          revokeAssetSources(nextSources);
          return;
        }
        generatedSources = nextSources;
        setAssetSources(nextSources);
      }
    );

    return () => {
      disposed = true;
      revokeAssetSources(generatedSources);
    };
  }, [assetDefinitions, projectHandle]);

  const handleImportAsset = useCallback(async () => {
    const { handle, descriptor, session: currentSession } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    const result = await importSourceAsset({
      projectHandle: handle,
      descriptor
    });
    projectStore
      .getState()
      .updateSession(addAssetDefinitionToSession(currentSession, result.assetDefinition));
    return result.assetDefinition;
  }, []);

  const handleUpdateAssetDefinition = useCallback(
    (definitionId: string, displayName: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateAssetDefinitionInSession(currentSession, definitionId, {
            displayName
          })
        );
    },
    []
  );

  const handleRemoveAssetDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    if (assetDefinitionHasSceneReferences(currentSession, definitionId)) {
      window.alert("Remove all placed instances before deleting this asset from the project.");
      return;
    }

    if (!window.confirm("Remove this asset definition from the project?")) {
      return;
    }

    projectStore
      .getState()
      .updateSession(removeAssetDefinitionFromSession(currentSession, definitionId));
  }, []);

  const handleCreateEnvironment = useCallback(() => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;

    const nextIndex =
      currentSession.contentLibrary.environmentDefinitions.length + 1;
    const environmentDefinition = createDefaultEnvironmentDefinition(
      currentSession.gameProject.identity.id,
      {
        displayName: `Environment ${nextIndex}`
      }
    );

    const nextSession = addEnvironmentDefinitionToSession(
      currentSession,
      environmentDefinition
    );
    projectStore.getState().updateSession(nextSession);
    shellStore
      .getState()
      .setActiveEnvironmentId(environmentDefinition.definitionId);
  }, []);

  // --- Viewport lifecycle (tied to project phase) ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const buildViewportRef = useRef<WorkspaceViewport | null>(null);
  const playerViewportRef = useRef<PlayerWorkspaceViewport | null>(null);
  const itemViewportRef = useRef<ItemWorkspaceViewport | null>(null);
  const npcViewportRef = useRef<NPCWorkspaceViewport | null>(null);

  useEffect(() => {
    if (phase !== "active") return;
    if (
      activeProductMode === "design" &&
      !designWorkspaceRequiresViewport(activeDesignKind)
    ) {
      buildViewportRef.current = null;
      playerViewportRef.current = null;
      itemViewportRef.current = null;
      npcViewportRef.current = null;
      const readyFrame = window.requestAnimationFrame(() => {
        setViewportReadyVersion((version) => version + 1);
      });
      return () => {
        window.cancelAnimationFrame(readyFrame);
      };
    }
    if (!viewportRef.current) return;
    const viewport =
      activeProductMode === "design"
        ? activeDesignKind === "npcs"
          ? createNPCViewport()
          : activeDesignKind === "items"
            ? createItemViewport()
            : createPlayerViewport()
        : createAuthoringViewport();
    viewport.mount(viewportRef.current);
    if (activeProductMode === "design") {
      if (activeDesignKind === "npcs") {
        npcViewportRef.current = viewport as NPCWorkspaceViewport;
        playerViewportRef.current = null;
        itemViewportRef.current = null;
      } else if (activeDesignKind === "items") {
        itemViewportRef.current = viewport as ItemWorkspaceViewport;
        playerViewportRef.current = null;
        npcViewportRef.current = null;
      } else {
        playerViewportRef.current = viewport as PlayerWorkspaceViewport;
        itemViewportRef.current = null;
        npcViewportRef.current = null;
      }
      buildViewportRef.current = null;
    } else {
      buildViewportRef.current = viewport as WorkspaceViewport;
      playerViewportRef.current = null;
      npcViewportRef.current = null;
    }
    const readyFrame = window.requestAnimationFrame(() => {
      setViewportReadyVersion((version) => version + 1);
    });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) viewport.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(viewportRef.current);

    return () => {
      window.cancelAnimationFrame(readyFrame);
      observer.disconnect();
      viewport.unmount();
      buildViewportRef.current = null;
      playerViewportRef.current = null;
      itemViewportRef.current = null;
      npcViewportRef.current = null;
    };
  }, [activeDesignKind, activeProductMode, phase]);

  // --- Sync viewport with active region ---
  const activeRegion = session ? getActiveRegion(session) : null;

  useEffect(() => {
    if (isBuild && buildViewportRef.current && activeRegion && session?.contentLibrary) {
      buildViewportRef.current.updateFromRegion({
        region: activeRegion,
        contentLibrary: session.contentLibrary,
        playerDefinition: session.gameProject.playerDefinition,
        itemDefinitions: session.gameProject.itemDefinitions,
        npcDefinitions: session.gameProject.npcDefinitions,
        assetSources,
        environmentOverrideId: environmentViewportOverrideId
      });
    }
  }, [
    activeRegion,
    assetSources,
    environmentViewportOverrideId,
    isBuild,
    session?.contentLibrary,
    session?.gameProject.itemDefinitions,
    session?.gameProject.npcDefinitions,
    session?.gameProject.playerDefinition
  ]);

  // --- Build workspace view (owns its own lifecycle) ---
  const buildView = useBuildProductModeView({
    activeBuildKind,
    viewportReadyVersion,
    activeRegionId,
    activeEnvironmentId,
    selectedIds,
    session,
    assetDefinitions,
    documentDefinitions,
    environmentDefinitions,
    npcDefinitions,
    questDefinitions,
    getViewport: () => buildViewportRef.current,
    getViewportElement: () => viewportRef.current,
    regions,
    onSelectKind: (kind) => shellStore.getState().setActiveBuildWorkspaceKind(kind),
    onSelectRegion: handleRegionSelect,
    onCreateRegion: () => setCreateRegionOpen(true),
    onSelectEnvironment: (environmentId) =>
      shellStore.getState().setActiveEnvironmentId(environmentId),
    onCreateEnvironment: handleCreateEnvironment,
    onSelect: (ids) => shellStore.getState().setSelection(ids),
    onCommand: dispatchCommand,
    navigationTarget: workspaceNavigationTarget,
    onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null),
    onNavigateToTarget: handleWorkspaceNavigation,
    onImportAsset: handleImportAsset,
    onUpdateAssetDefinition: handleUpdateAssetDefinition,
    onRemoveAssetDefinition: handleRemoveAssetDefinition
  });

  const designView = useDesignProductModeView({
    activeDesignKind,
    viewportReadyVersion,
    gameProjectId: session?.gameProject.identity.id ?? null,
    regions: regionDocuments,
    playerDefinition,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    extraWorkspaceItems: renderablePluginWorkspaceItems,
    npcInteractionOptions,
    contentLibrary: session?.contentLibrary ?? null,
    assetDefinitions,
    assetSources,
    getPlayerViewport: () => playerViewportRef.current,
    getItemViewport: () => itemViewportRef.current,
    getNPCViewport: () => npcViewportRef.current,
    getViewportElement: () => viewportRef.current,
    onSelectKind: (kind) => shellStore.getState().setActiveDesignWorkspaceKind(kind),
    onCommand: dispatchCommand,
    navigationTarget: workspaceNavigationTarget,
    onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null),
    onNavigateToTarget: handleWorkspaceNavigation
  });
  const activePluginWorkspaceDefinition = getStudioPluginWorkspaceDefinition(
    activeDesignKind
  );
  const activePluginView = useMemo(() => {
    if (!activePluginWorkspaceDefinition) return null;
    return activePluginWorkspaceDefinition.createWorkspaceView({
      gameProjectId: session?.gameProject.identity.id ?? null,
      gameProject: session?.gameProject ?? null,
      pluginConfigurations,
      onCommand: dispatchCommand
    });
  }, [
    activePluginWorkspaceDefinition,
    pluginConfigurations,
    session?.gameProject,
    session?.gameProject.identity.id
  ]);

  const activeDesignPanels = activePluginView ?? designView;

  const handleUndo = useCallback(() => {
    const { session: s } = projectStore.getState();
    if (!s) return;
    projectStore.getState().updateSession(undoSession(s));
  }, []);

  const statusMessage = useMemo(() => {
    if (phase === "no-project") return "No project open";
    if (phase === "error") return "Error loading project";
    const dirty = isDirty ? " (unsaved)" : "";
    return `${activeProductMode} workspace ready${dirty}`;
  }, [phase, isDirty, activeProductMode]);

  return (
    <>
      <ProjectManagerDialog opened={phase === "no-project"} onOpen={handleOpenProject} onCreate={handleCreateProject} />
      <CreateRegionDialog opened={createRegionOpen} onClose={() => setCreateRegionOpen(false)} onCreate={handleCreateRegion} />
      <Modal
        opened={pluginsOpen}
        onClose={() => setPluginsOpen(false)}
        title="Plugins"
        centered
        styles={{
          header: { background: "var(--sm-color-surface1)", borderBottom: "1px solid var(--sm-panel-border)" },
          title: { color: "var(--sm-color-text)", fontWeight: 600 },
          body: { background: "var(--sm-color-surface1)", padding: "20px" },
          content: { background: "var(--sm-color-surface1)" },
          close: { color: "var(--sm-color-overlay1)", "&:hover": { background: "var(--sm-active-bg)" } }
        }}
      >
        <Stack gap="md">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
              Installed Plugins
            </Text>
            {installedPlugins.length === 0 ? (
              <Text size="sm" c="var(--sm-color-overlay0)">
                No plugins installed in this project yet.
              </Text>
            ) : (
              installedPlugins.map((plugin) => {
                const configuration = pluginConfigurations.find(
                  (entry) => entry.pluginId === plugin.manifest.pluginId
                ) ?? null;
                return (
                  <Stack
                    key={plugin.manifest.pluginId}
                    gap="xs"
                    p="md"
                    style={{
                      border: "1px solid var(--sm-panel-border)",
                      borderRadius: "var(--sm-radius-md)",
                      background: "var(--sm-color-surface2)"
                    }}
                  >
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={4} style={{ flex: 1 }}>
                        <Text fw={600}>{plugin.manifest.displayName}</Text>
                      </Stack>
                      <Stack gap="xs" align="flex-end">
                        <Switch
                          checked={configuration?.enabled === true}
                          onChange={() =>
                            handleSetPluginEnabled(
                              plugin.manifest.pluginId,
                              configuration?.enabled !== true
                            )
                          }
                          label="Enabled"
                        />
                        <UnstyledButton
                          onClick={() => handleUninstallPlugin(plugin.manifest.pluginId)}
                          style={{
                            color: "var(--sm-color-overlay1)",
                            fontSize: "var(--sm-font-size-sm)"
                          }}
                        >
                          Uninstall
                        </UnstyledButton>
                      </Stack>
                    </Group>
                    <Group gap={6}>
                      {plugin.manifest.capabilityIds.map((capabilityId) => (
                        <Badge key={capabilityId} variant="light" color="blue">
                          {capabilityId}
                        </Badge>
                      ))}
                    </Group>
                    {plugin.shell ? (
                      <Stack gap={4}>
                        {(plugin.shell.projectSettings ?? []).map((entry) => (
                          <Text key={entry.settingsId} size="xs" c="var(--sm-color-subtext)">
                            Project Settings: {entry.label}
                          </Text>
                        ))}
                        {(plugin.shell.designWorkspaces ?? []).map((entry) => (
                          <Text key={entry.workspaceKind} size="xs" c="var(--sm-color-subtext)">
                            Design Workspace: {entry.label}
                          </Text>
                        ))}
                        {(plugin.shell.designSections ?? []).map((entry) => (
                          <Text key={entry.sectionId} size="xs" c="var(--sm-color-subtext)">
                            Design Section: {entry.workspaceKind} / {entry.label}
                          </Text>
                        ))}
                      </Stack>
                    ) : null}
                  </Stack>
                );
              })
            )}
          </Stack>
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
              Available To Install
            </Text>
            {availablePlugins.length === 0 ? (
              <Text size="sm" c="var(--sm-color-overlay0)">
                No newly discovered plugins are waiting to be installed.
              </Text>
            ) : (
              availablePlugins.map((plugin) => (
                <Stack
                  key={plugin.manifest.pluginId}
                  gap="xs"
                  p="md"
                  style={{
                    border: "1px solid var(--sm-panel-border)",
                    borderRadius: "var(--sm-radius-md)",
                    background: "var(--sm-color-surface2)"
                  }}
                >
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Text fw={600}>{plugin.manifest.displayName}</Text>
                    </Stack>
                    <UnstyledButton
                      onClick={() => handleInstallPlugin(plugin.manifest.pluginId)}
                      style={{
                        color: "var(--sm-accent-blue)",
                        fontSize: "var(--sm-font-size-sm)",
                        fontWeight: 600
                      }}
                    >
                      Install
                    </UnstyledButton>
                  </Group>
                  <Group gap={6}>
                    {plugin.manifest.capabilityIds.map((capabilityId) => (
                      <Badge key={capabilityId} variant="light" color="gray">
                        {capabilityId}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              ))
            )}
          </Stack>
        </Stack>
      </Modal>

      <ShellFrame
        headerPanel={
          <Group h={44} px="md" align="center" gap={0} wrap="nowrap">
            <Text fw={700} size="sm" c="var(--sm-color-text)" mr="md">Sugarmagic</Text>
            {phase === "active" && (
              <Menu position="bottom-start" offset={4}>
                <Menu.Target>
                  <UnstyledButton px="md" py={6} styles={{ root: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-accent-blue)", background: "var(--sm-active-bg)", borderRadius: "var(--sm-radius-sm)", marginRight: "var(--sm-space-lg)", "&:hover": { background: "var(--sm-active-bg-hover)" } } }}>
                    📁 Game
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown styles={{ dropdown: { background: "var(--sm-color-surface1)", border: "1px solid var(--sm-panel-border)", minWidth: 200, padding: "var(--sm-space-xs) 0" } }}>
                  <Menu.Item onClick={handleSave} disabled={!isDirty} rightSection={<Text size="xs" c="var(--sm-color-overlay0)">⌘S</Text>} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" }, "&[data-disabled]": { color: "var(--sm-color-overlay0)" } } }}>💾 Save Game</Menu.Item>
                  <Menu.Item onClick={handleUndo} disabled={undoCount === 0} rightSection={<Text size="xs" c="var(--sm-color-overlay0)">⌘Z</Text>} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" }, "&[data-disabled]": { color: "var(--sm-color-overlay0)" } } }}>↩ Undo</Menu.Item>
                  <Menu.Divider styles={{ divider: { borderColor: "var(--sm-panel-border)" } }} />
                  <Menu.Item onClick={() => setPluginsOpen(true)} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" } } }}>🧩 Plugins</Menu.Item>
                  <Menu.Item onClick={handleReload} styles={{ item: { fontSize: "var(--sm-font-size-lg)", color: "var(--sm-color-text)", padding: "10px 16px", "&:hover": { background: "var(--sm-active-bg)" } } }}>🔄 Reload Project</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
            <ModeBar items={modeBarItems} activeId={activeProductMode} onSelect={(id) => shellStore.getState().setActiveProductMode(id as typeof activeProductMode)} />
            {phase === "active" && (
              <ActionStripe
                isPreviewRunning={isPreviewRunning}
                onStartPreview={() => handleStartPreview(assetSources, installedPluginIds)}
                onStopPreview={handleStopPreview}
                previewDisabled={!session}
              />
            )}
          </Group>
        }
        subHeaderPanel={
          phase === "active"
            ? isBuild
              ? buildView.subHeaderPanel
              : isDesign
                ? designView.subHeaderPanel
                : undefined
            : undefined
        }
        leftPanel={
          isBuild ? buildView.leftPanel : isDesign ? activeDesignPanels.leftPanel : null
        }
        rightPanel={
          isBuild ? buildView.rightPanel : isDesign ? activeDesignPanels.rightPanel : undefined
        }
        bottomPanel={
          <StatusBar message={statusMessage} severity={phase === "error" ? "error" : "info"} trailing={activeWorkspaceId ?? undefined} />
        }
        centerPanel={
          phase === "active" && isBuild && buildView.centerPanel ? (
            buildView.centerPanel
          ) : phase === "active" && isDesign && activeDesignPanels.centerPanel ? (
            activeDesignPanels.centerPanel
          ) : (
            <ViewportFrame>
              {phase === "active" ? (
                <>
                  <div ref={viewportRef} style={{ position: "absolute", inset: 0 }} />
                  {isBuild && buildView.viewportOverlay}
                  {isDesign && activeDesignPanels.viewportOverlay}
                </>
              ) : (
                <Text size="sm" c="var(--sm-color-overlay0)">Open or create a project to begin.</Text>
              )}
            </ViewportFrame>
          )
        }
      />
    </>
  );
}
