/**
 * Studio application composition root.
 *
 * Owns top-level project/session lifecycle wiring, including the canonical
 * asset import flow that now recognizes foliage GLBs inside the same content
 * library system as every other imported asset.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getAllMaterialDefinitions,
  getAllNPCDefinitions,
  getAllShaderDefinitions,
  getAllPluginConfigurations,
  getPluginConfiguration,
  getAllQuestDefinitions,
  getAllSpellDefinitions,
  getAllTextureDefinitions,
  getPlayerDefinition,
  addAssetDefinitionToSession,
  addEnvironmentDefinitionToSession,
  addMaterialDefinitionToSession,
  addTextureDefinitionToSession,
  updateAssetDefinitionInSession,
  updateMaterialDefinitionInSession,
  removeAssetDefinitionFromSession,
  removeMaterialDefinitionFromSession,
  assetDefinitionHasSceneReferences,
  materialDefinitionHasReferences,
  createDefaultEnvironmentDefinition,
  createDefaultRegion,
  createScopedId
} from "@sugarmagic/domain";
import {
  buildSugarlangPreviewBootPayloadForSession,
  collectPluginShellContributions,
  ensureDiscoveredPluginConfiguration,
  listDiscoveredPluginDefinitions,
  planGameDeployment,
  resolveSugarLangTargetLanguage,
  resolveInstalledPluginDefinitions
} from "@sugarmagic/plugins";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  pickDirectory,
  saveProject,
  saveProjectWithManagedFiles,
  inspectManagedProjectFiles,
  importPbrTextureSet,
  importTextureDefinition,
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
  useRenderProductModeView,
  type ItemWorkspaceViewport,
  type NPCWorkspaceViewport,
  type WorkspaceNavigationTarget,
  type WorkspaceViewport,
  type PlayerWorkspaceViewport
} from "@sugarmagic/workspaces";
import {
  ActionStripe,
  CreateRegionDialog,
  Inspector,
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
import { useAssetSources } from "./asset-sources";
import {
  getStudioPluginWorkspaceDefinition,
  listStudioPluginWorkspaceDefinitions
} from "./plugins/catalog";
import { readStudioPluginRuntimeEnvironment } from "./runtimeEnv";
import { SUGARDEPLOY_PLUGIN_ID } from "@sugarmagic/plugins";
import { resolveNPCInteractionOptions } from "@sugarmagic/workspaces";

function renderPluginSectionGroup(
  sections: ReturnType<typeof collectPluginShellContributions>["designSections"],
  props: Parameters<
    ReturnType<typeof collectPluginShellContributions>["designSections"][number]["render"]
  >[0]
) {
  if (sections.length === 0) {
    return null;
  }

  return sections.map((section) => (
    <Fragment key={`${section.pluginId}:${section.sectionId}`}>
      {section.render(props)}
    </Fragment>
  ));
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
    activeRenderWorkspaceKind: shell.activeRenderWorkspaceKind,
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
  const capturedAssetSources = assetSources;
  const capturedInstalledPluginIds = installedPluginIds;
  const capturedSnapshot = snapshot;
  async function onMessage(event: MessageEvent) {
    if (event.data?.type === "PREVIEW_READY") {
      window.removeEventListener("message", onMessage);
      await postPreviewBootMessage(
        capturedWindow,
        capturedSession,
        capturedSnapshot,
        capturedAssetSources,
        capturedInstalledPluginIds
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
  if (snapshot.activeProductMode === "render") {
    shell.setActiveRenderWorkspaceKind(snapshot.activeRenderWorkspaceKind);
  }
  if (snapshot.activeRegionId) {
    shell.setActiveRegionId(snapshot.activeRegionId);
  }
  shell.setActiveEnvironmentId(snapshot.activeEnvironmentId ?? null);
  shell.setSelection(snapshot.selectedEntityIds);
}

async function postPreviewBootMessage(
  previewWindow: Window,
  session: ReturnType<typeof projectStore.getState>["session"],
  snapshot: AuthoringContextSnapshot,
  assetSources: Record<string, string>,
  installedPluginIds: string[]
) {
  if (!session || previewWindow.closed) {
    return;
  }

  const regions = getAllRegions(session);
  const runtimeEnvironment = readStudioPluginRuntimeEnvironment();
  previewWindow.postMessage(
    {
      type: "PREVIEW_BOOT",
      regions,
      activeRegionId: session.activeRegionId,
      activeEnvironmentId: snapshot.activeEnvironmentId,
      installedPluginIds,
      pluginRuntimeEnvironment: runtimeEnvironment,
      pluginConfigurations: session.gameProject.pluginConfigurations,
      contentLibrary: session.contentLibrary,
      playerDefinition: session.gameProject.playerDefinition,
      spellDefinitions: session.gameProject.spellDefinitions,
      itemDefinitions: session.gameProject.itemDefinitions,
      documentDefinitions: session.gameProject.documentDefinitions,
      npcDefinitions: session.gameProject.npcDefinitions,
      dialogueDefinitions: session.gameProject.dialogueDefinitions,
      questDefinitions: session.gameProject.questDefinitions,
      assetSources,
      pluginBootPayloads: {
        sugarlang:
          (await buildSugarlangPreviewBootPayloadForSession(
            session,
            snapshot.activeWorkspaceId ?? session.gameProject.identity.id,
            runtimeEnvironment
          )) ?? undefined
      }
    },
    "*"
  );
}

// --- App ---

export function App() {
  const activeProductMode = useStore(shellStore, (s) => s.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (s) => s.activeWorkspaceId);
  const activeBuildKind = useStore(shellStore, (s) => s.activeBuildWorkspaceKind);
  const activeDesignKind = useStore(shellStore, (s) => s.activeDesignWorkspaceKind);
  const activeRenderKind = useStore(shellStore, (s) => s.activeRenderWorkspaceKind);
  const activeRegionId = useStore(shellStore, (s) => s.activeRegionId);
  const activeEnvironmentId = useStore(shellStore, (s) => s.activeEnvironmentId);
  const selectedIds = useStore(shellStore, (s) => s.selection.entityIds);

  const phase = useStore(projectStore, (s) => s.phase);
  const projectHandle = useStore(projectStore, (s) => s.handle);
  const session = useStore(projectStore, (s) => s.session);
  const previewWindow = useStore(previewStore, (s) => s.previewWindow);

  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;
  const isBuild = activeProductMode === "build";
  const isDesign = activeProductMode === "design";
  const isRender = activeProductMode === "render";
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
    if (target.kind === "shader-graph") {
      shell.setActiveProductMode("render");
      shell.setActiveRenderWorkspaceKind("shaders");
      return;
    }

    shell.setActiveProductMode("build");
    shell.setActiveRegionId(target.regionId);
    shell.setActiveBuildWorkspaceKind("behavior");
  }, []);

  function handleCreateRegion(input: { displayName: string; regionId: string }) {
    if (!session) return;
    const newRegion = createDefaultRegion({
      regionId: input.regionId,
      displayName: input.displayName,
      defaultEnvironmentId:
        session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null
    });
    projectStore.getState().updateSession(addRegionToSession(session, newRegion));
    shellStore.getState().setActiveRegionId(input.regionId);
    setCreateRegionOpen(false);
  }

  const assetDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAssetDefinitions(session);
  }, [session]);
  const materialDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllMaterialDefinitions(session);
  }, [session]);
  const textureDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllTextureDefinitions(session);
  }, [session]);
  const assetSources = useAssetSources(projectHandle, session?.contentLibrary ?? null);

  const environmentDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllEnvironmentDefinitions(session);
  }, [session]);

  const shaderDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllShaderDefinitions(session);
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

  useEffect(() => {
    if (!isPreviewRunning || !previewWindow || previewWindow.closed || !session) {
      return;
    }

    const snapshot: AuthoringContextSnapshot = {
      activeProductMode,
      activeBuildWorkspaceKind: activeBuildKind,
      activeDesignWorkspaceKind: activeDesignKind,
      activeRenderWorkspaceKind: activeRenderKind,
      activeRegionId,
      activeEnvironmentId,
      activeWorkspaceId,
      selectedEntityIds: selectedIds
    };

    void postPreviewBootMessage(
      previewWindow,
      session,
      snapshot,
      assetSources,
      installedPluginIds
    );
  }, [
    activeBuildKind,
    activeDesignKind,
    activeEnvironmentId,
    activeProductMode,
    activeRegionId,
    activeRenderKind,
    activeWorkspaceId,
    assetSources,
    installedPluginIds,
    isPreviewRunning,
    previewWindow,
    selectedIds,
    session
  ]);

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
  const studioRuntimeEnvironment = useMemo(
    () => readStudioPluginRuntimeEnvironment(),
    []
  );
  useEffect(() => {
    (globalThis as Record<string, unknown>).SUGARMAGIC_SUGARLANG_PROXY_BASE_URL =
      studioRuntimeEnvironment.SUGARMAGIC_SUGARLANG_PROXY_BASE_URL ?? "";
    (globalThis as Record<string, unknown>).SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL =
      studioRuntimeEnvironment.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL ?? "";
  }, [studioRuntimeEnvironment]);
  const sugarlangTargetLanguage =
    resolveSugarLangTargetLanguage(studioRuntimeEnvironment) ?? "es";
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
      {
        const sectionWorkspaceKinds = new Set(
          pluginShellContributions.designSections.map(
            (section) => section.workspaceKind
          )
        );

        return pluginShellContributions.designWorkspaces.filter(
          (workspace) =>
            studioPluginWorkspaceKinds.has(workspace.workspaceKind) ||
            sectionWorkspaceKinds.has(workspace.workspaceKind)
        );
      },
    [
      pluginShellContributions.designSections,
      pluginShellContributions.designWorkspaces,
      studioPluginWorkspaceKinds
    ]
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

  const handleImportAsset = useCallback(async () => {
    const { handle, descriptor, session: currentSession } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importSourceAsset({
        projectHandle: handle,
        descriptor,
        projectId: currentSession.gameProject.identity.id
      });
      let nextSession = currentSession;
      for (const textureDefinition of result.textureDefinitions) {
        nextSession = addTextureDefinitionToSession(nextSession, textureDefinition);
      }
      for (const materialDefinition of result.materialDefinitions) {
        nextSession = addMaterialDefinitionToSession(nextSession, materialDefinition);
      }
      nextSession = addAssetDefinitionToSession(nextSession, result.assetDefinition);
      projectStore.getState().updateSession(nextSession);
      if (result.warnings.length > 0) {
        window.alert(`Asset import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`);
      }
      return result.assetDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Asset import failed: ${String(error)}`
      );
      return null;
    }
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

  const handleSetAssetMaterialSlotBinding = useCallback(
    (
      definitionId: string,
      slotName: string,
      slotIndex: number,
      materialDefinitionId: string | null
    ) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      const assetDefinition =
        currentSession.contentLibrary.assetDefinitions.find(
          (definition) => definition.definitionId === definitionId
        ) ?? null;
      if (!assetDefinition) return;

      const nextBindings = (assetDefinition.materialSlotBindings ?? []).map((binding) =>
        binding.slotName === slotName && binding.slotIndex === slotIndex
          ? {
              ...binding,
              materialDefinitionId
            }
          : binding
      );

      projectStore
        .getState()
        .updateSession(
          updateAssetDefinitionInSession(currentSession, definitionId, {
            materialSlotBindings: nextBindings
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

  const handleCreateMaterialDefinition = useCallback(
    (shaderDefinitionId: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return null;

      const nextIndex = currentSession.contentLibrary.materialDefinitions.length + 1;
      const materialDefinition = {
        definitionId: `${currentSession.gameProject.identity.id}:material:${createScopedId("material")}`,
        definitionKind: "material" as const,
        displayName: `Material ${nextIndex}`,
        shaderDefinitionId,
        parameterValues: {},
        textureBindings: {}
      };

      projectStore
        .getState()
        .updateSession(addMaterialDefinitionToSession(currentSession, materialDefinition));
      return materialDefinition;
    },
    []
  );

  const handleImportTextureDefinition = useCallback(async () => {
    const { handle, descriptor, session: currentSession } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importTextureDefinition({
        projectHandle: handle,
        descriptor
      });
      projectStore
        .getState()
        .updateSession(addTextureDefinitionToSession(currentSession, result.textureDefinition));
      return result.textureDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Texture import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleImportPbrMaterial = useCallback(async () => {
    const { handle, descriptor, session: currentSession } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importPbrTextureSet({
        projectHandle: handle,
        descriptor
      });

      // Pick the right built-in PBR shader variant based on which
      // files the importer found. "orm" → Standard PBR (ORM);
      // "separate" → Standard PBR (Separate). Each variant's graph
      // is authored to sample exactly the textures its workflow
      // supplies — no runtime branching required on the shader side.
      const targetBuiltInKey =
        result.suggestedShaderVariant === "separate"
          ? "standard-pbr-separate"
          : "standard-pbr";
      const targetShaderId =
        currentSession.contentLibrary.shaderDefinitions.find(
          (definition) => definition.metadata.builtInKey === targetBuiltInKey
        )?.shaderDefinitionId ?? null;
      if (!targetShaderId) {
        window.alert(
          `The built-in "${targetBuiltInKey}" shader is missing from the content library.`
        );
        return null;
      }

      let nextSession = currentSession;
      for (const textureDefinition of result.textures) {
        nextSession = addTextureDefinitionToSession(nextSession, textureDefinition);
      }

      const materialDefinition = {
        definitionId: `${currentSession.gameProject.identity.id}:material:${createScopedId("material")}`,
        definitionKind: "material" as const,
        displayName: result.suggestedMaterialDisplayName,
        shaderDefinitionId: targetShaderId,
        parameterValues: {},
        textureBindings: result.textureBindings
      };
      nextSession = addMaterialDefinitionToSession(nextSession, materialDefinition);
      projectStore.getState().updateSession(nextSession);
      if (result.warnings.length > 0) {
        window.alert(`PBR import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`);
      }
      return materialDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `PBR texture-set import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleUpdateMaterialDefinition = useCallback(
    (definitionId: string, patch: Parameters<typeof updateMaterialDefinitionInSession>[2]) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateMaterialDefinitionInSession(currentSession, definitionId, patch)
        );
    },
    []
  );

  const handleRemoveMaterialDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    if (materialDefinitionHasReferences(currentSession, definitionId)) {
      window.alert(
        "Remove this material from all landscape channels and asset slots before deleting it."
      );
      return;
    }

    if (!window.confirm("Remove this material from the project?")) {
      return;
    }

    projectStore
      .getState()
      .updateSession(removeMaterialDefinitionFromSession(currentSession, definitionId));
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
      activeProductMode === "render" ||
      (activeProductMode === "design" &&
        !designWorkspaceRequiresViewport(activeDesignKind))
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
    materialDefinitions,
    textureDefinitions,
    documentDefinitions,
    environmentDefinitions,
    shaderDefinitions,
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
    onSetAssetMaterialSlotBinding: handleSetAssetMaterialSlotBinding,
    onSetAssetDefaultShader: (definitionId, slot, shaderDefinitionId) =>
      dispatchCommand({
        kind: "SetAssetDefaultShader",
        target: {
          aggregateKind: "content-definition",
          aggregateId: definitionId
        },
        subject: {
          subjectKind: "asset-definition",
          subjectId: definitionId
        },
        payload: {
          definitionId,
          slot,
          shaderDefinitionId: shaderDefinitionId ?? null
        }
      }),
    onSetAssetDefaultShaderParameterOverride: (definitionId, slot, override) =>
      dispatchCommand({
        kind: "SetAssetDefaultShaderParameterOverride",
        target: {
          aggregateKind: "content-definition",
          aggregateId: definitionId
        },
        subject: {
          subjectKind: "asset-definition",
          subjectId: definitionId
        },
        payload: {
          definitionId,
          slot,
          override
        }
      }),
    onClearAssetDefaultShaderParameterOverride: (definitionId, slot, parameterId) =>
      dispatchCommand({
        kind: "ClearAssetDefaultShaderParameterOverride",
        target: {
          aggregateKind: "content-definition",
          aggregateId: definitionId
        },
        subject: {
          subjectKind: "asset-definition",
          subjectId: definitionId
        },
        payload: {
          definitionId,
          slot,
          parameterId
        }
      }),
    onRemoveAssetDefinition: handleRemoveAssetDefinition,
    onCreateMaterialDefinition: handleCreateMaterialDefinition,
    onImportPbrMaterial: handleImportPbrMaterial,
    onImportTextureDefinition: handleImportTextureDefinition,
    onUpdateMaterialDefinition: handleUpdateMaterialDefinition,
    onRemoveMaterialDefinition: handleRemoveMaterialDefinition,
    isMaterialReferenced: (definitionId) =>
      session ? materialDefinitionHasReferences(session, definitionId) : false,
    renderLayoutInspectorSections: ({ activeRegion: layoutRegion }) =>
      renderPluginSectionGroup(
        pluginShellContributions.designSections.filter(
          (section) => section.workspaceKind === "layout"
        ),
        {
          workspaceKind: "layout",
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          regions: regionDocuments,
          activeRegion: layoutRegion,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand
        }
      )
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
    onNavigateToTarget: handleWorkspaceNavigation,
    renderNPCInspectorSections: ({ selectedNPC, updateNPC }) =>
      renderPluginSectionGroup(
        pluginShellContributions.designSections.filter(
          (section) => section.workspaceKind === "npcs"
        ),
        {
          workspaceKind: "npcs",
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          regions: regionDocuments,
          activeRegion,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand,
          selectedNPC,
          updateNPC
        }
      ),
    renderQuestInspectorSections: ({
      selectedQuest,
      updateQuest,
      selectedQuestNode
    }) =>
      renderPluginSectionGroup(
        pluginShellContributions.designSections.filter(
          (section) => section.workspaceKind === "quests"
        ),
        {
          workspaceKind: "quests",
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          regions: regionDocuments,
          activeRegion,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand,
          selectedQuest,
          updateQuest,
          selectedQuestNode
        }
      )
  });
  const renderView = useRenderProductModeView({
    activeRenderKind,
    gameProjectId: session?.gameProject.identity.id ?? null,
    shaderDefinitions,
    onSelectKind: (kind) => shellStore.getState().setActiveRenderWorkspaceKind(kind),
    onCommand: dispatchCommand,
    navigationTarget: workspaceNavigationTarget,
    onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null)
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
  const genericPluginView = useMemo(() => {
    if (activePluginWorkspaceDefinition) {
      return null;
    }

    const workspace = renderablePluginWorkspaceItems.find(
      (entry) => entry.workspaceKind === activeDesignKind
    );
    if (!workspace) {
      return null;
    }

    const sections = pluginShellContributions.designSections.filter(
      (section) => section.workspaceKind === activeDesignKind
    );
    if (sections.length === 0) {
      return null;
    }

    return {
      leftPanel: null,
      rightPanel: (
        <Inspector selectionLabel={workspace.label}>
          <Stack gap="sm">
            <Text size="sm" c="var(--sm-color-subtext)">
              Plugin-owned authoring surfaces render here through the shared shell contribution seam.
            </Text>
            <Text size="xs" c="var(--sm-color-overlay0)">
              Target language: {sugarlangTargetLanguage}
            </Text>
          </Stack>
        </Inspector>
      ),
      centerPanel: (
        <Stack
          gap="lg"
          p="xl"
          h="100%"
          style={{
            minHeight: 0,
            overflowY: "auto"
          }}
        >
          {renderPluginSectionGroup(sections, {
            workspaceKind: activeDesignKind,
            gameProjectId: session?.gameProject.identity.id ?? null,
            gameProject: session?.gameProject ?? null,
            pluginConfigurations,
            regions: regionDocuments,
            activeRegion,
            targetLanguage: sugarlangTargetLanguage,
            onCommand: dispatchCommand
          })}
        </Stack>
      ),
      viewportOverlay: null
    };
  }, [
    activeDesignKind,
    activePluginWorkspaceDefinition,
    activeRegion,
    pluginConfigurations,
    pluginShellContributions.designSections,
    regionDocuments,
    renderablePluginWorkspaceItems,
    session?.gameProject,
    session?.gameProject.identity.id,
    sugarlangTargetLanguage
  ]);

  const activeDesignPanels = activePluginView ?? genericPluginView ?? designView;

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
                : isRender
                  ? renderView.subHeaderPanel
                : undefined
            : undefined
        }
        leftPanel={
          isBuild
            ? buildView.leftPanel
            : isDesign
              ? activeDesignPanels.leftPanel
              : isRender
                ? renderView.leftPanel
                : null
        }
        rightPanel={
          isBuild
            ? buildView.rightPanel
            : isDesign
              ? activeDesignPanels.rightPanel
              : isRender
                ? renderView.rightPanel
                : undefined
        }
        bottomPanel={
          <StatusBar message={statusMessage} severity={phase === "error" ? "error" : "info"} trailing={activeWorkspaceId ?? undefined} />
        }
        centerPanel={
          phase === "active" && isBuild && buildView.centerPanel ? (
            buildView.centerPanel
          ) : phase === "active" && isDesign && activeDesignPanels.centerPanel ? (
            activeDesignPanels.centerPanel
          ) : phase === "active" && isRender && renderView.centerPanel ? (
            renderView.centerPanel
          ) : (
            <ViewportFrame>
              {phase === "active" ? (
                <>
                  <div ref={viewportRef} style={{ position: "absolute", inset: 0 }} />
                  {isBuild && buildView.viewportOverlay}
                  {isDesign && activeDesignPanels.viewportOverlay}
                  {isRender && renderView.viewportOverlay}
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
