/**
 * Studio application composition root.
 *
 * Owns top-level project/session lifecycle wiring, including the canonical
 * asset import flow that now recognizes foliage GLBs inside the same content
 * library system as every other imported asset.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Text,
  Group,
  Menu,
  UnstyledButton,
  Modal,
  Stack,
  Switch,
  Badge
} from "@mantine/core";
import { productModes } from "@sugarmagic/productmodes";
import { ManageScenesModal } from "./ManageScenesModal";
import { CreditsPreview } from "./CreditsPreview";
import { createCharacterWizardServices } from "./character-wizard/characterWizardServices";
import type {
  SemanticCommand,
  RegionDocument,
  SurfaceBinding,
  ItemDefinition,
  AudioClipDefinition,
  AudioMixerSettings,
  MusicBindings,
  PaintedMaskTargetAddress,
  RuntimeSoundEventKey,
  SoundCueDefinition
} from "@sugarmagic/domain";
import {
  getAssetDefinition,
  getMaskTextureDefinition,
  createAuthoringSession,
  applyCommand,
  undoSession,
  markSessionClean,
  switchActiveRegion,
  switchActiveScene,
  getActiveScene,
  addSceneToSession,
  updateSceneInSession,
  deleteSceneFromSession,
  reorderSceneInSession,
  convertAssetScopeInSession,
  copyOverlayEntryToScene,
  addRegionToSession,
  getActiveRegion,
  getAllRegions,
  getAllAssetDefinitions,
  getAllAudioClipDefinitions,
  getAllCharacterAnimationDefinitions,
  getAllCharacterModelDefinitions,
  getAllDialogueDefinitions,
  getAllDocumentDefinitions,
  getAllEnvironmentDefinitions,
  getAllItemDefinitions,
  getAllMaterialDefinitions,
  getAllSoundCueDefinitions,
  getAllNPCDefinitions,
  getAllShaderDefinitions,
  getAllPluginConfigurations,
  getPluginConfiguration,
  getAllQuestDefinitions,
  getAllSurfaceDefinitions,
  getAllSpellDefinitions,
  getAllTextureDefinitions,
  listFlowerTypeDefinitions,
  listGrassTypeDefinitions,
  listMaskTextureDefinitions,
  listRockTypeDefinitions,
  getPlayerDefinition,
  addAssetDefinitionToSession,
  addAudioClipDefinitionToSession,
  addCharacterAnimationDefinitionToSession,
  addCharacterModelDefinitionToSession,
  addEnvironmentDefinitionToSession,
  addMaterialDefinitionToSession,
  addMaskTextureDefinitionToSession,
  addSurfaceDefinitionToSession,
  addTextureDefinitionToSession,
  addSoundCueDefinitionToSession,
  updateAudioClipDefinitionInSession,
  updateAssetDefinitionInSession,
  updateMaterialDefinitionInSession,
  updateSoundCueDefinitionInSession,
  removeAudioClipDefinitionFromSession,
  removeSoundCueDefinitionFromSession,
  setSoundEventBindingInSession,
  updateAudioMixerInSession,
  updateMusicBindingsInSession,
  updateCreditsInSession,
  duplicateMaterialDefinitionInSession,
  duplicateSurfaceDefinitionInSession,
  updateSurfaceDefinitionInSession,
  removeMaterialDefinitionFromSession,
  removeTextureDefinitionFromSession,
  textureDefinitionHasReferences,
  removeAssetDefinitionFromSession,
  assetDefinitionHasReferences,
  removeSurfaceDefinitionFromSession,
  materialDefinitionHasReferences,
  createDefaultMaterialPbr,
  createDefaultSurfaceDefinition,
  createDefaultEnvironmentDefinition,
  createDefaultSoundCueDefinition,
  createDefaultMechanicsDefinition,
  createDefaultRegion,
  createScopedId
} from "@sugarmagic/domain";
import {
  buildSugarlangPreviewBootPayloadForSession,
  collectPluginShellContributions,
  ensureDiscoveredPluginConfiguration,
  getDeploymentSettings,
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
  saveProjectWithManagedFiles,
  inspectManagedProjectFiles,
  importPbrTextureSet,
  importMaskTextureDefinition,
  importTextureDefinition,
  importCharacterAnimationDefinition,
  importCharacterModelDefinition,
  importAudioClipDefinition,
  readBlobFile,
  readMaskFile,
  writeBlobFile,
  reloadProject,
  importSourceAsset,
  createBlankMaskFile,
  writeMaskFile,
  writeItemThumbnailFile,
  pickFile,
  writeDocumentPageFile
} from "@sugarmagic/io";
import {
  collectMechanicsConsumerInvocations,
  validateMechanicsDefinition
} from "@sugarmagic/runtime-core";
import {
  createShellStore,
  createProjectStore,
  createPreviewStore,
  createAssetSourceStore,
  createDesignPreviewStore,
  createSurfaceEditingStore,
  createViewportStore,
  CORE_DESIGN_WORKSPACE_KINDS,
  type AuthoringContextSnapshot
} from "@sugarmagic/shell";
import {
  SurfaceAuthoringProvider,
  type WorkspaceViewport,
  useBuildProductModeView,
  useDesignProductModeView,
  usePublishProductModeView,
  useRenderProductModeView,
  type WorkspaceNavigationTarget
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
import { bakePaintUvsIntoGlb } from "./asset-pipeline/paint-uvs";
import { createItemViewport } from "./viewport/itemViewport";
import { SurfacePreviewViewport } from "./viewport/surfacePreviewViewport";
import { LibraryPopover } from "./library/LibraryPopover";
import { shouldShowSharedViewport } from "./viewport/viewportVisibility";
import { createWebRenderEngine } from "@sugarmagic/render-web";
import { captureItemThumbnail } from "./thumbnail/captureItemThumbnail";
import { connectStudioRenderEngineProjector } from "./viewport/RenderEngineProjector";
import { mountAuthoringCameraOverlay } from "./viewport/overlays/authoring-camera";
import { mountLandscapeAuthoringOverlay } from "./viewport/overlays/landscape-authoring";
import { mountScatterBrushOverlay } from "./viewport/overlays/scatter-brush";
import { mountSurfaceBrushOverlay } from "./viewport/overlays/surface-brush";
import { mountMaskPaintOverlay } from "./viewport/overlays/mask-paint";
import { mountTransformGizmoOverlay } from "./viewport/overlays/layout-transform";
import { mountSpatialAuthoringOverlay } from "./viewport/overlays/spatial-authoring";
import {
  getStudioPluginWorkspaceDefinition,
  listStudioPluginWorkspaceDefinitions
} from "./plugins/catalog";
import { readStudioPluginRuntimeEnvironment } from "./runtimeEnv";
import { SUGARDEPLOY_PLUGIN_ID } from "@sugarmagic/plugins";
import { resolveNPCInteractionOptions } from "@sugarmagic/workspaces";
import { UIPreviewSession } from "./preview/UIPreviewSession";

function renderPluginSectionGroup(
  sections: ReturnType<
    typeof collectPluginShellContributions
  >["designSections"],
  props: Parameters<
    ReturnType<
      typeof collectPluginShellContributions
    >["designSections"][number]["render"]
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
const viewportStore = createViewportStore();
const assetSourceStore = createAssetSourceStore();
const designPreviewStore = createDesignPreviewStore();
const surfaceEditingStore = createSurfaceEditingStore();
const studioRenderEngine = createWebRenderEngine({
  compileProfile: "authoring-preview"
});

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
    projectStore
      .getState()
      .setActive(active.handle, active.descriptor, session);
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
    if (
      hasExisting &&
      !window.confirm(
        "This directory already contains a Sugarmagic project. Replace it?"
      )
    )
      return;
    const active = await createProjectInDirectory(handle, input);
    const session = createAuthoringSession(
      active.gameProject,
      active.regions,
      active.contentLibrary
    );
    projectStore
      .getState()
      .setActive(active.handle, active.descriptor, session);
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
  if (
    command.target.aggregateKind === "region-document" &&
    !getActiveRegion(session)
  ) {
    return;
  }
  projectStore.getState().updateSession(applyCommand(session, command));
}

interface PerformSaveOptions {
  // Story 45.8 — `true` skips the managed-files overwrite confirm
  // dialog. Used by plugin-driven sagas (cut-major-version) that have
  // already confirmed the operation up-front through their own modal
  // and just need to flush the bumped state to disk silently.
  silentOverwriteManagedFiles: boolean;
}

interface PerformSaveResult {
  ok: boolean;
  reason?: string;
}

async function performSave(
  options: PerformSaveOptions
): Promise<PerformSaveResult> {
  const { handle, descriptor, session } = projectStore.getState();
  if (!handle || !descriptor || !session) {
    return { ok: false, reason: "No project is loaded." };
  }
  const mechanicsValidation = validateMechanicsDefinition(
    session.gameProject.mechanics,
    {
      consumers: collectMechanicsConsumerInvocations({
        spellDefinitions: session.gameProject.spellDefinitions,
        itemDefinitions: session.gameProject.itemDefinitions
      })
    }
  );
  if (!mechanicsValidation.valid) {
    const reason = `Project mechanics are invalid:\n${mechanicsValidation.issues
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n")}`;
    if (!options.silentOverwriteManagedFiles) {
      window.alert(`${reason}\n\nProject was not saved.`);
    }
    return { ok: false, reason };
  }
  const baseSaveInput = {
    handle,
    descriptor,
    gameProject: session.gameProject,
    contentLibrary: session.contentLibrary,
    regions: getAllRegions(session)
  };
  const sugarDeployConfiguration = getPluginConfiguration(
    session.gameProject.pluginConfigurations,
    SUGARDEPLOY_PLUGIN_ID
  );
  const canRunSugarDeploy = sugarDeployConfiguration?.enabled === true;
  const publishedWebSnapshot = {
    // Story 46.10 follow-up — feed the in-memory runtime snapshot
    // through so boot.json bakes the real game content (regions +
    // content library + asset sources) rather than empty
    // placeholders.
    regions: getAllRegions(session),
    contentLibrary: session.contentLibrary,
    assetSources: {} as Record<string, string>,
    activeRegionId: session.activeRegionId,
    activeEnvironmentId: null as string | null
  };

  // Story 46.15 reshape — non-secret runtime config env now flows
  // from per-game plugin config (which is already in memory on the
  // session) rather than from sugarmagic-root .env. No async fetch,
  // no two-pass plan: planGameDeployment computes the env map
  // internally from enabled plugins' gatewayRuntimeConfigKeys.
  const deploymentPlan =
    canRunSugarDeploy &&
    getDeploymentSettings(session.gameProject).backendDeploymentTargetId
      ? planGameDeployment(session.gameProject, publishedWebSnapshot)
      : null;

  try {
    if (deploymentPlan?.status === "invalid") {
      const reason = `Deployment plan is invalid:\n${deploymentPlan.conflicts
        .map((conflict) => `- ${conflict.message}`)
        .join("\n")}`;
      if (!options.silentOverwriteManagedFiles) {
        window.alert(
          `${reason}\n\nManaged deployment files were not generated; project.sgrmagic was still saved.`
        );
      }
      const result = await saveProjectWithManagedFiles(baseSaveInput);
      projectStore.getState().updateSession(
        markSessionClean({
          ...session,
          contentLibrary: result.reconciledContentLibrary
        })
      );
      return { ok: false, reason };
    }

    const managedFiles = deploymentPlan?.managedFiles ?? [];
    const inspection = await inspectManagedProjectFiles({
      handle,
      managedFiles
    });

    if (
      inspection.changedManagedFiles.length > 0 &&
      !options.silentOverwriteManagedFiles
    ) {
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
        const result = await saveProjectWithManagedFiles(baseSaveInput);
        projectStore.getState().updateSession(
          markSessionClean({
            ...session,
            contentLibrary: result.reconciledContentLibrary
          })
        );
        return { ok: true };
      }
    }

    const result = await saveProjectWithManagedFiles({
      ...baseSaveInput,
      managedFiles,
      overwriteManagedFiles: inspection.changedManagedFiles.length > 0
    });

    projectStore.getState().updateSession(
      markSessionClean({
        ...session,
        contentLibrary: result.reconciledContentLibrary
      })
    );
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

async function handleSave() {
  await performSave({ silentOverwriteManagedFiles: false });
}

// Story 45.8 — exposed to the plugin workspace via PluginWorkspaceViewProps.
// Lets sagas (cut-major-version is the first) flush in-memory dispatches
// to disk mid-flow with no UI prompts.
async function requestSaveFromPlugin(): Promise<PerformSaveResult> {
  return performSave({ silentOverwriteManagedFiles: true });
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
  projectStore
    .getState()
    .setActive(reloaded.handle, reloaded.descriptor, newSession);
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

// Plan 058 §058.2 — Ambient Context switch: the top-bar Scene
// selector routes here. Every Design workspace + Preview follows
// the session's activeSceneId.
function handleSceneSelect(sceneId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(switchActiveScene(session, sceneId));
}

// Plan 058 §058.3 — Manage Scenes handlers (session-level
// structural mutations, same seam as addRegionToSession).
function handleAddScene(displayName: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(addSceneToSession(session, { displayName }));
}

function handleRenameScene(sceneId: string, displayName: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateSceneInSession(session, sceneId, { displayName }));
}

// Plan 058 §058.6 — Scene properties panel writes (description,
// notes, unlock condition, overrides, transition card).
function handleUpdateScene(
  sceneId: string,
  patch: Parameters<typeof updateSceneInSession>[2]
) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateSceneInSession(session, sceneId, patch));
}

function handleDeleteScene(sceneId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(deleteSceneFromSession(session, sceneId));
}

function handleReorderScene(sceneId: string, direction: "up" | "down") {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(reorderSceneInSession(session, sceneId, direction));
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
    activePublishWorkspaceKind: shell.activePublishWorkspaceKind,
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
  // Story 47.10.5 — listener stays attached for the lifetime of the
  // preview window so a window.location.reload() inside preview.tsx
  // (the "New Game" reset path) gets a fresh PREVIEW_BOOT response.
  // Originally one-shot; removing the listener after the first
  // READY meant a reloaded preview hung on a blank screen forever
  // because Studio stopped answering. Removed when the preview
  // window closes (handled by the same interval below).
  async function onMessage(event: MessageEvent) {
    if (event.data?.type === "PREVIEW_READY") {
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
      window.removeEventListener("message", onMessage);
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
  if (snapshot.activeProductMode === "publish") {
    shell.setActivePublishWorkspaceKind(snapshot.activePublishWorkspaceKind);
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
      // Plan 058 §058.1 — Scenes ride the boot payload; the
      // runtime composes the active Scene's overlays onto the
      // region base. Preview uses the author's ambient Scene
      // context implicitly via the scenes array ordering for now
      // (explicit activeSceneId threading lands with 058.2's
      // selector).
      scenes: session.gameProject.scenes,
      // Plan 059 §059.4 — Episodes screen label.
      scenesUiLabel: session.gameProject.scenesUiLabel,
      // Ambient Context: Preview boots whichever Scene is active
      // in the editor — no separate "preview which Scene?" picker.
      activeSceneId: session.activeSceneId,
      activeRegionId: session.activeRegionId,
      activeEnvironmentId: snapshot.activeEnvironmentId,
      installedPluginIds,
      pluginRuntimeEnvironment: runtimeEnvironment,
      pluginConfigurations: session.gameProject.pluginConfigurations,
      contentLibrary: session.contentLibrary,
      mechanics: session.gameProject.mechanics,
      playerDefinition: session.gameProject.playerDefinition,
      spellDefinitions: session.gameProject.spellDefinitions,
      itemDefinitions: session.gameProject.itemDefinitions,
      documentDefinitions: session.gameProject.documentDefinitions,
      npcDefinitions: session.gameProject.npcDefinitions,
      dialogueDefinitions: session.gameProject.dialogueDefinitions,
      questDefinitions: session.gameProject.questDefinitions,
      menuDefinitions: session.gameProject.menuDefinitions,
      hudDefinition: session.gameProject.hudDefinition,
      uiTheme: session.gameProject.uiTheme,
      soundEventBindings: session.gameProject.soundEventBindings,
      audioMixer: session.gameProject.audioMixer,
      // Plan 059 §059.1 — project music slots.
      musicBindings: session.gameProject.musicBindings,
      // Plan 059 §059.2 — credits roll content.
      creditsDefinition: session.gameProject.creditsDefinition,
      // Plan 059 §059.3 — entry title sequence's first card.
      gameTitle: session.gameProject.displayName,
      assetSources,
      // Story 47.10.5 — authored fresh-start record. Studio preview
      // mirrors the published-web boot.json shape so a "New Game"
      // reset spawns at the project-curated values rather than the
      // implicit playerPresence defaults.
      defaultGameSavePayload: session.gameProject.defaultGameSavePayload,
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
  const activePublishKind = useStore(
    shellStore,
    (s) => s.activePublishWorkspaceKind
  );
  const activeBuildKind = useStore(
    shellStore,
    (s) => s.activeBuildWorkspaceKind
  );
  const activeDesignKind = useStore(
    shellStore,
    (s) => s.activeDesignWorkspaceKind
  );
  const activeRenderKind = useStore(
    shellStore,
    (s) => s.activeRenderWorkspaceKind
  );
  const activeRegionId = useStore(shellStore, (s) => s.activeRegionId);
  const activeEnvironmentId = useStore(
    shellStore,
    (s) => s.activeEnvironmentId
  );
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
  const isPublish = activeProductMode === "publish";
  const isPreviewRunning = useStore(previewStore, (s) => s.isPreviewRunning);

  const regions = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session).map((r) => ({
      id: r.identity.id,
      displayName: r.displayName
    }));
  }, [session]);
  const regionDocuments = useMemo(() => {
    if (!session) return [];
    return getAllRegions(session);
  }, [session]);

  const [createRegionOpen, setCreateRegionOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [manageScenesOpen, setManageScenesOpen] = useState(false);
  const [workspaceNavigationTarget, setWorkspaceNavigationTarget] =
    useState<WorkspaceNavigationTarget | null>(null);

  const handleWorkspaceNavigation = useCallback(
    (target: WorkspaceNavigationTarget) => {
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
    },
    []
  );

  function handleCreateRegion(input: {
    displayName: string;
    regionId: string;
  }) {
    if (!session) return;
    const newRegion = createDefaultRegion({
      regionId: input.regionId,
      displayName: input.displayName,
      defaultEnvironmentId:
        session.contentLibrary.environmentDefinitions[0]?.definitionId ?? null
    });
    projectStore
      .getState()
      .updateSession(addRegionToSession(session, newRegion));
    shellStore.getState().setActiveRegionId(input.regionId);
    setCreateRegionOpen(false);
  }

  const assetDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAssetDefinitions(session);
  }, [session]);
  const audioClipDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAudioClipDefinitions(session);
  }, [session]);
  const soundCueDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllSoundCueDefinitions(session);
  }, [session]);
  const characterModelDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllCharacterModelDefinitions(session);
  }, [session]);
  const characterAnimationDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllCharacterAnimationDefinitions(session);
  }, [session]);
  const materialDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllMaterialDefinitions(session);
  }, [session]);
  const surfaceDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllSurfaceDefinitions(session);
  }, [session]);
  const grassTypeDefinitions = useMemo(() => {
    if (!session) return [];
    return listGrassTypeDefinitions(session.contentLibrary);
  }, [session]);
  const flowerTypeDefinitions = useMemo(() => {
    if (!session) return [];
    return listFlowerTypeDefinitions(session.contentLibrary);
  }, [session]);
  const rockTypeDefinitions = useMemo(() => {
    if (!session) return [];
    return listRockTypeDefinitions(session.contentLibrary);
  }, [session]);
  const textureDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllTextureDefinitions(session);
  }, [session]);
  const maskTextureDefinitions = useMemo(() => {
    if (!session) return [];
    return listMaskTextureDefinitions(session.contentLibrary);
  }, [session]);
  const assetSources = useStore(assetSourceStore, (state) => state.sources);
  const editedSurfaceDefinitionId = useStore(
    surfaceEditingStore,
    (state) => state.editedSurfaceDefinitionId
  );
  const surfacePreviewGeometryKind = useStore(
    surfaceEditingStore,
    (state) => state.previewGeometryKind
  );
  const activeMaskPaintTarget = useStore(
    viewportStore,
    (state) => state.activeMaskPaintTarget
  );

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
    if (!projectHandle || phase !== "active") {
      assetSourceStore.getState().stop();
      return;
    }

    assetSourceStore.getState().start(projectHandle, projectStore);
    return () => {
      assetSourceStore.getState().stop();
    };
  }, [phase, projectHandle]);

  useEffect(() => {
    return connectStudioRenderEngineProjector({
      engine: studioRenderEngine,
      stores: {
        projectStore,
        shellStore,
        viewportStore,
        assetSourceStore,
        designPreviewStore
      }
    });
  }, []);

  useEffect(() => {
    if (
      !isPreviewRunning ||
      !previewWindow ||
      previewWindow.closed ||
      !session
    ) {
      return;
    }

    const snapshot: AuthoringContextSnapshot = {
      activeProductMode,
      activeBuildWorkspaceKind: activeBuildKind,
      activeDesignWorkspaceKind: activeDesignKind,
      activeRenderWorkspaceKind: activeRenderKind,
      activePublishWorkspaceKind: activePublishKind,
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

  const discoveredPlugins = useMemo(
    () => listDiscoveredPluginDefinitions(),
    []
  );
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
      collectPluginShellContributions(
        pluginConfigurations,
        (pluginId) =>
          installedPlugins.find(
            (plugin) => plugin.manifest.pluginId === pluginId
          )?.shell ?? null
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
    (
      globalThis as Record<string, unknown>
    ).SUGARMAGIC_SUGARLANG_PROXY_BASE_URL =
      studioRuntimeEnvironment.SUGARMAGIC_SUGARLANG_PROXY_BASE_URL ?? "";
    (
      globalThis as Record<string, unknown>
    ).SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL =
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
  const renderablePluginWorkspaceItems = useMemo(() => {
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
  }, [
    pluginShellContributions.designSections,
    pluginShellContributions.designWorkspaces,
    studioPluginWorkspaceKinds
  ]);
  const npcInteractionOptions = useMemo(
    () =>
      resolveNPCInteractionOptions(
        pluginShellContributions.npcInteractionOptions
      ),
    [pluginShellContributions.npcInteractionOptions]
  );

  useEffect(() => {
    if (activeProductMode !== "design") return;
    const availableDesignWorkspaceKinds = new Set<string>([
      ...CORE_DESIGN_WORKSPACE_KINDS,
      ...renderablePluginWorkspaceItems.map(
        (workspace) => workspace.workspaceKind
      )
    ]);
    if (availableDesignWorkspaceKinds.has(activeDesignKind)) return;
    shellStore.getState().setActiveDesignWorkspaceKind("player");
  }, [activeDesignKind, activeProductMode, renderablePluginWorkspaceItems]);

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
    const configuration = getPluginConfiguration(
      pluginConfigurations,
      pluginId
    );
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
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importSourceAsset({
        projectHandle: handle,
        descriptor,
        projectId: currentSession.gameProject.identity.id
      });
      let nextSession = currentSession;
      for (const textureDefinition of result.textureDefinitions) {
        nextSession = addTextureDefinitionToSession(
          nextSession,
          textureDefinition
        );
      }
      for (const materialDefinition of result.materialDefinitions) {
        nextSession = addMaterialDefinitionToSession(
          nextSession,
          materialDefinition
        );
      }
      nextSession = addAssetDefinitionToSession(
        nextSession,
        result.assetDefinition
      );
      projectStore.getState().updateSession(nextSession);
      // The import wrote new files; without refreshing their blob
      // URLs the Layout viewport can't render the asset until the
      // project reloads (the preview re-reads files at boot, which
      // hid this). Same pattern as audio/texture imports.
      await assetSourceStore
        .getState()
        .refreshPaths([
          result.assetDefinition.source.relativeAssetPath,
          ...result.textureDefinitions.map(
            (definition) => definition.source.relativeAssetPath
          )
        ]);
      if (result.warnings.length > 0) {
        window.alert(
          `Asset import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`
        );
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
      projectStore.getState().updateSession(
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
      surface: SurfaceBinding<"universal"> | null
    ) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      const assetDefinition =
        currentSession.contentLibrary.assetDefinitions.find(
          (definition) => definition.definitionId === definitionId
        ) ?? null;
      if (!assetDefinition) return;

      const nextSurfaceSlots = assetDefinition.surfaceSlots.map((slot) =>
        slot.slotName === slotName && slot.slotIndex === slotIndex
          ? {
              ...slot,
              surface
            }
          : slot
      );

      projectStore.getState().updateSession(
        updateAssetDefinitionInSession(currentSession, definitionId, {
          surfaceSlots: nextSurfaceSlots
        })
      );
    },
    []
  );

  // Assets library modal (Game > Libraries > Assets): when opened
  // from a placed instance's "Edit definition", preselect that asset.
  const [assetsLibraryPreselectId, setAssetsLibraryPreselectId] = useState<
    string | null
  >(null);

  const handleSetAssetDefaultShader = useCallback(
    (
      definitionId: string,
      slot: "surface" | "deform" | "effect",
      shaderDefinitionId: string | null
    ) =>
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
    []
  );

  const handleRemoveAssetDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    projectStore
      .getState()
      .updateSession(
        removeAssetDefinitionFromSession(currentSession, definitionId)
      );
  }, []);

  const handleCreateMaterialDefinition = useCallback(() => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return null;

    const nextIndex =
      currentSession.contentLibrary.materialDefinitions.length + 1;
    const materialDefinition = {
      definitionId: `${currentSession.gameProject.identity.id}:material:${createScopedId("material")}`,
      definitionKind: "material" as const,
      displayName: `Material ${nextIndex}`,
      pbr: createDefaultMaterialPbr(),
      shaderDefinitionId: null
    };

    projectStore
      .getState()
      .updateSession(
        addMaterialDefinitionToSession(currentSession, materialDefinition)
      );
    return materialDefinition;
  }, []);

  const handleImportTextureDefinition = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importTextureDefinition({
        projectHandle: handle,
        descriptor
      });
      projectStore
        .getState()
        .updateSession(
          addTextureDefinitionToSession(
            currentSession,
            result.textureDefinition
          )
        );
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

  const handleImportCharacterAnimationDefinition = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importCharacterAnimationDefinition({
        projectHandle: handle,
        descriptor,
        projectId: currentSession.gameProject.identity.id
      });
      projectStore
        .getState()
        .updateSession(
          addCharacterAnimationDefinitionToSession(
            currentSession,
            result.characterAnimationDefinition
          )
        );
      if (result.warnings.length > 0) {
        window.alert(
          `Character animation import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`
        );
      }
      return result.characterAnimationDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Character animation import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleImportCharacterModelDefinition = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importCharacterModelDefinition({
        projectHandle: handle,
        descriptor,
        projectId: currentSession.gameProject.identity.id
      });
      projectStore
        .getState()
        .updateSession(
          addCharacterModelDefinitionToSession(
            currentSession,
            result.characterModelDefinition
          )
        );
      if (result.warnings.length > 0) {
        window.alert(
          `Character model import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`
        );
      }
      return result.characterModelDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Character model import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  // Plan 062 §062.6 — Studio-side Character Wizard services: io +
  // the solver worker + the vendored CC0 clips, behind the
  // workspaces-facing interface. Definitions register on the
  // session here (same shape as the import handlers above); the
  // workspace binds slots via its own update command.
  const characterWizardServices = useMemo(
    () =>
      createCharacterWizardServices({
        getProjectContext: () => {
          const {
            handle,
            descriptor,
            session: currentSession
          } = projectStore.getState();
          if (!handle || !descriptor || !currentSession) return null;
          return {
            projectHandle: handle,
            descriptor,
            projectId: currentSession.gameProject.identity.id
          };
        },
        registerDefinitions: (model, animations) => {
          const { session: currentSession } = projectStore.getState();
          if (!currentSession) return;
          let nextSession = model
            ? addCharacterModelDefinitionToSession(currentSession, model)
            : currentSession;
          for (const animation of animations) {
            nextSession = addCharacterAnimationDefinitionToSession(
              nextSession,
              animation
            );
          }
          projectStore.getState().updateSession(nextSession);
        },
        // §062.9 — edit-in-place rewrote asset files under the same
        // paths; refresh their blob URLs so previews reload.
        refreshAssetPaths: (relativeAssetPaths) =>
          assetSourceStore.getState().refreshPaths(relativeAssetPaths)
      }),
    []
  );

  const handleImportAudioClipDefinition = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importAudioClipDefinition({
        projectHandle: handle,
        descriptor
      });
      projectStore
        .getState()
        .updateSession(
          addAudioClipDefinitionToSession(
            currentSession,
            result.audioClipDefinition
          )
        );
      await assetSourceStore
        .getState()
        .refreshPaths([result.audioClipDefinition.source.relativeAssetPath]);
      return result.audioClipDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Audio import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleUpdateAudioClipDefinition = useCallback(
    (definitionId: string, patch: Partial<AudioClipDefinition>) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateAudioClipDefinitionInSession(
            currentSession,
            definitionId,
            patch
          )
        );
    },
    []
  );

  const handleRemoveAudioClipDefinition = useCallback(
    (definitionId: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      if (!window.confirm("Remove this audio clip from the project?")) return;
      projectStore
        .getState()
        .updateSession(
          removeAudioClipDefinitionFromSession(currentSession, definitionId)
        );
    },
    []
  );

  const handleCreateSoundCueDefinition = useCallback(() => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return null;
    const soundCueDefinitionsForSession =
      currentSession.contentLibrary.soundCueDefinitions ?? [];
    const cue = createDefaultSoundCueDefinition({
      displayName: `Sound Cue ${soundCueDefinitionsForSession.length + 1}`,
      clips: []
    });
    projectStore
      .getState()
      .updateSession(addSoundCueDefinitionToSession(currentSession, cue));
    return cue;
  }, []);

  const handleUpdateSoundCueDefinition = useCallback(
    (definitionId: string, patch: Partial<SoundCueDefinition>) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateSoundCueDefinitionInSession(currentSession, definitionId, patch)
        );
    },
    []
  );

  const handleRemoveSoundCueDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    if (!window.confirm("Remove this sound cue from the project?")) return;
    projectStore
      .getState()
      .updateSession(
        removeSoundCueDefinitionFromSession(currentSession, definitionId)
      );
  }, []);

  const handleSetSoundEventBinding = useCallback(
    (eventKey: RuntimeSoundEventKey, soundCueDefinitionId: string | null) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          setSoundEventBindingInSession(
            currentSession,
            eventKey,
            soundCueDefinitionId
          )
        );
    },
    []
  );

  const handleUpdateAudioMixer = useCallback(
    (patch: Partial<AudioMixerSettings>) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(updateAudioMixerInSession(currentSession, patch));
    },
    []
  );

  // Plan 059 §059.1 — project music slots.
  const handleUpdateMusicBindings = useCallback(
    (patch: Partial<MusicBindings>) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(updateMusicBindingsInSession(currentSession, patch));
    },
    []
  );

  const handleGenerateItemThumbnail = useCallback(
    async (item: ItemDefinition): Promise<string | null> => {
      const { handle, session: currentSession } = projectStore.getState();
      if (!handle || !currentSession) return null;
      const modelDefinitionId = item.presentation.modelAssetDefinitionId;
      if (!modelDefinitionId) return null;
      const modelDefinition =
        currentSession.contentLibrary.assetDefinitions.find(
          (definition) => definition.definitionId === modelDefinitionId
        );
      const sources = assetSourceStore.getState().sources;
      const modelUrl = modelDefinition
        ? sources[modelDefinition.source.relativeAssetPath]
        : undefined;
      if (!modelDefinition || !modelUrl) {
        window.alert("Cannot generate thumbnail: bound model is not loaded.");
        return null;
      }
      try {
        const blob = await captureItemThumbnail({
          engine: studioRenderEngine,
          item,
          contentLibrary: currentSession.contentLibrary,
          assetSources: sources,
          modelGlbUrl: modelUrl
        });
        const relativePath = await writeItemThumbnailFile(
          handle,
          item.definitionId,
          blob
        );
        // Force the asset-source store to mint a fresh blob URL for this
        // path (overwriting any stale URL from a previous Generate click).
        await assetSourceStore.getState().refreshPaths([relativePath]);
        return relativePath;
      } catch (error) {
        window.alert(
          error instanceof Error
            ? `Thumbnail generation failed: ${error.message}`
            : `Thumbnail generation failed: ${String(error)}`
        );
        return null;
      }
    },
    []
  );

  const handleAppendDocumentPage = useCallback(
    async (
      documentDefinitionId: string,
      pageIndex: number
    ): Promise<string | null> => {
      const { handle } = projectStore.getState();
      if (!handle) return null;

      try {
        const fileHandle = await pickFile({
          types: [
            {
              description: "Document page image",
              accept: {
                "image/png": [".png"],
                "image/jpeg": [".jpg", ".jpeg"]
              }
            }
          ]
        });
        const file = await fileHandle.getFile();
        const relativePath = await writeDocumentPageFile(
          handle,
          documentDefinitionId,
          pageIndex,
          file
        );
        await assetSourceStore.getState().refreshPaths([relativePath]);
        return relativePath;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return null;
        }
        window.alert(
          error instanceof Error
            ? `Document page import failed: ${error.message}`
            : `Document page import failed: ${String(error)}`
        );
        return null;
      }
    },
    []
  );

  const handleCreateMaskTextureDefinition = useCallback(async () => {
    const { handle, session: currentSession } = projectStore.getState();
    if (!handle || !currentSession) {
      return null;
    }

    const idSuffix = createScopedId("mask");
    const definitionId = `mask-texture:${idSuffix}`;
    const relativeAssetPath = `masks/${idSuffix}.png`;
    const nextIndex =
      (currentSession.contentLibrary.maskTextureDefinitions?.length ?? 0) + 1;

    try {
      await createBlankMaskFile(handle, relativeAssetPath, [512, 512], "r8");
      const definition = {
        definitionId,
        definitionKind: "mask-texture" as const,
        displayName: `Painted Mask ${nextIndex}`,
        source: {
          relativeAssetPath,
          fileName: `${idSuffix}.png`,
          mimeType: "image/png"
        },
        format: "r8" as const,
        resolution: [512, 512] as [number, number]
      };
      projectStore
        .getState()
        .updateSession(
          addMaskTextureDefinitionToSession(currentSession, definition)
        );
      await assetSourceStore.getState().refreshPaths([relativeAssetPath]);
      return definition;
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : `Painted mask creation failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleImportMaskTextureDefinition = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importMaskTextureDefinition({
        projectHandle: handle,
        descriptor
      });
      projectStore
        .getState()
        .updateSession(
          addMaskTextureDefinitionToSession(
            currentSession,
            result.maskTextureDefinition
          )
        );
      return result.maskTextureDefinition;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Mask texture import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleReadMaskTexture = useCallback(async (maskTextureId: string) => {
    const { handle, session: currentSession } = projectStore.getState();
    if (!handle || !currentSession) {
      return null;
    }
    const definition =
      currentSession.contentLibrary.maskTextureDefinitions?.find(
        (candidate) => candidate.definitionId === maskTextureId
      ) ?? null;
    if (!definition) {
      return null;
    }
    return readMaskFile(handle, definition.source.relativeAssetPath);
  }, []);

  // Painted-mask preview cache (Plan 068.8 QoL): live pixels behind
  // the inspector thumbnails. Filled lazily from disk, updated on
  // every stroke/fill commit via handleWriteMaskTexture.
  const paintedMaskPreviewCanvases = useRef(
    new Map<string, HTMLCanvasElement>()
  );
  const paintedMaskPreviewLoads = useRef(new Set<string>());
  const [paintedMaskPreviewVersion, setPaintedMaskPreviewVersion] =
    useState(0);

  const getPaintedMaskPreviewCanvas = useCallback(
    (maskTextureId: string): HTMLCanvasElement | null => {
      const cached = paintedMaskPreviewCanvases.current.get(maskTextureId);
      if (cached) {
        return cached;
      }
      if (!paintedMaskPreviewLoads.current.has(maskTextureId)) {
        paintedMaskPreviewLoads.current.add(maskTextureId);
        void (async () => {
          const imageData = await handleReadMaskTexture(maskTextureId);
          const { session: currentSession } = projectStore.getState();
          const definition = currentSession
            ? getMaskTextureDefinition(
                currentSession.contentLibrary,
                maskTextureId
              )
            : null;
          const canvas = document.createElement("canvas");
          canvas.width = imageData?.width ?? definition?.resolution[0] ?? 512;
          canvas.height = imageData?.height ?? definition?.resolution[1] ?? 512;
          const context2d = canvas.getContext("2d");
          if (context2d && imageData) {
            context2d.putImageData(imageData, 0, 0);
          }
          paintedMaskPreviewCanvases.current.set(maskTextureId, canvas);
          paintedMaskPreviewLoads.current.delete(maskTextureId);
          setPaintedMaskPreviewVersion((version) => version + 1);
        })();
      }
      return null;
    },
    [handleReadMaskTexture]
  );

  const handleGenerateAssetPaintUvs = useCallback(
    async (assetDefinitionId: string) => {
      const { handle, session: currentSession } = projectStore.getState();
      if (!handle || !currentSession) {
        return;
      }
      const definition = getAssetDefinition(
        currentSession.contentLibrary,
        assetDefinitionId
      );
      if (!definition) {
        window.alert(`Missing asset definition "${assetDefinitionId}".`);
        return;
      }
      const pathSegments = definition.source.relativeAssetPath
        .split("/")
        .filter(Boolean);
      const blob = await readBlobFile(handle, ...pathSegments);
      if (!blob) {
        window.alert(
          `Asset file "${definition.source.relativeAssetPath}" was not found.`
        );
        return;
      }
      try {
        const result = await bakePaintUvsIntoGlb(await blob.arrayBuffer());
        await writeBlobFile(
          handle,
          pathSegments,
          new Blob([result.glb], { type: "model/gltf-binary" })
        );
        // Drop the renderables FIRST: the refreshPaths store tick is
        // what triggers the projection pass that re-schedules their
        // loads. The reverse order rebuilt before dropping and left
        // the asset invisible until some unrelated store tick.
        workspaceViewportRef.current?.reloadAssetRenderables?.(
          assetDefinitionId
        );
        await assetSourceStore
          .getState()
          .refreshPaths([definition.source.relativeAssetPath]);
        if (result.unwrappedMeshCount === 0) {
          window.alert(
            "All meshes in this asset already carry paint UVs; nothing was regenerated."
          );
        }
      } catch (error) {
        console.error("[paint-uvs] generation failed", error);
        window.alert(
          `Paint UV generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    []
  );

  const handleWriteMaskTexture = useCallback(
    async (maskTextureId: string, imageData: ImageData) => {
      const { handle, session: currentSession } = projectStore.getState();
      if (!handle || !currentSession) {
        return;
      }
      const definition =
        currentSession.contentLibrary.maskTextureDefinitions?.find(
          (candidate) => candidate.definitionId === maskTextureId
        ) ?? null;
      if (!definition) {
        throw new Error(`Missing painted mask definition "${maskTextureId}".`);
      }
      await writeMaskFile(
        handle,
        definition.source.relativeAssetPath,
        imageData
      );
      // Keep the preview cache truthful on every commit.
      const previewCanvas =
        paintedMaskPreviewCanvases.current.get(maskTextureId) ??
        document.createElement("canvas");
      previewCanvas.width = imageData.width;
      previewCanvas.height = imageData.height;
      previewCanvas.getContext("2d")?.putImageData(imageData, 0, 0);
      paintedMaskPreviewCanvases.current.set(maskTextureId, previewCanvas);
      setPaintedMaskPreviewVersion((version) => version + 1);
      await assetSourceStore
        .getState()
        .refreshPaths([definition.source.relativeAssetPath]);
    },
    []
  );

  const handleImportPbrMaterial = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;

    try {
      const result = await importPbrTextureSet({
        projectHandle: handle,
        descriptor
      });

      let nextSession = currentSession;
      for (const textureDefinition of result.textures) {
        nextSession = addTextureDefinitionToSession(
          nextSession,
          textureDefinition
        );
      }

      const materialDefinition = {
        definitionId: `${currentSession.gameProject.identity.id}:material:${createScopedId("material")}`,
        definitionKind: "material" as const,
        displayName: result.suggestedMaterialDisplayName,
        pbr: createDefaultMaterialPbr({
          baseColorMap: result.textureBindings.basecolor_texture ?? null,
          normalMap: result.textureBindings.normal_texture ?? null,
          ormMap: result.textureBindings.orm_texture ?? null,
          roughnessMap: result.textureBindings.roughness_texture ?? null,
          metallicMap: result.textureBindings.metallic_texture ?? null,
          ambientOcclusionMap: result.textureBindings.ao_texture ?? null
        }),
        shaderDefinitionId: null
      };
      nextSession = addMaterialDefinitionToSession(
        nextSession,
        materialDefinition
      );
      projectStore.getState().updateSession(nextSession);
      if (result.warnings.length > 0) {
        window.alert(
          `PBR import completed with warnings:\n\n- ${result.warnings.join("\n- ")}`
        );
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
    (
      definitionId: string,
      patch: Parameters<typeof updateMaterialDefinitionInSession>[2]
    ) => {
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

  const handleDuplicateMaterialDefinition = useCallback(
    (sourceDefinitionId: string): string | null => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return null;
      const result = duplicateMaterialDefinitionInSession(
        currentSession,
        sourceDefinitionId
      );
      if (!result) return null;
      projectStore.getState().updateSession(result.session);
      return result.newDefinitionId;
    },
    []
  );

  const handleCreateSurfaceDefinition = useCallback(() => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return null;
    const surfaceDefinition = createDefaultSurfaceDefinition(
      currentSession.gameProject.identity.id,
      {
        displayName: `Surface ${(currentSession.contentLibrary.surfaceDefinitions ?? []).length + 1}`
      }
    );
    projectStore
      .getState()
      .updateSession(
        addSurfaceDefinitionToSession(currentSession, surfaceDefinition)
      );
    return surfaceDefinition;
  }, []);

  const handleUpdateSurfaceDefinition = useCallback(
    (
      definitionId: string,
      patch: Parameters<typeof updateSurfaceDefinitionInSession>[2]
    ) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(
          updateSurfaceDefinitionInSession(currentSession, definitionId, patch)
        );
    },
    []
  );

  const handleDuplicateSurfaceDefinition = useCallback(
    (definitionId: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return null;
      const result = duplicateSurfaceDefinitionInSession(
        currentSession,
        definitionId
      );
      if (!result) return null;
      projectStore.getState().updateSession(result.session);
      return result.newDefinitionId;
    },
    []
  );

  const handleRemoveSurfaceDefinition = useCallback((definitionId: string) => {
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) return;
    if (!window.confirm("Remove this surface from the project?")) {
      return;
    }
    projectStore
      .getState()
      .updateSession(
        removeSurfaceDefinitionFromSession(currentSession, definitionId)
      );
  }, []);

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
      .updateSession(
        removeMaterialDefinitionFromSession(currentSession, definitionId)
      );
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

  // --- Viewport lifecycle (tied to the shared center viewport DOM) ---
  const viewportRef = useRef<HTMLDivElement>(null);
  // The mounted WorkspaceViewport instance (Plan 068.8: paint-UV
  // baking asks it to reload an asset's renderables after the source
  // GLB is rewritten).
  const workspaceViewportRef = useRef<WorkspaceViewport | null>(null);

  // --- Active region remains shell/project truth; the authoring viewport now
  // observes it directly via shell-store projection instead of a React effect.
  const activeRegion = session ? getActiveRegion(session) : null;

  useEffect(() => {
    const nextSurfaceDefinitionId =
      editedSurfaceDefinitionId &&
      surfaceDefinitions.some(
        (definition) => definition.definitionId === editedSurfaceDefinitionId
      )
        ? editedSurfaceDefinitionId
        : (surfaceDefinitions[0]?.definitionId ?? null);
    if (nextSurfaceDefinitionId === editedSurfaceDefinitionId) {
      return;
    }
    surfaceEditingStore
      .getState()
      .setEditedSurfaceDefinitionId(nextSurfaceDefinitionId);
  }, [editedSurfaceDefinitionId, surfaceDefinitions]);

  // --- Build workspace view (owns its own lifecycle) ---
  const buildView = useBuildProductModeView({
    activeBuildKind,
    activeRegionId,
    activeEnvironmentId,
    selectedIds,
    session,
    assetDefinitions,
    surfaceDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    materialDefinitions,
    textureDefinitions,
    maskTextureDefinitions,
    documentDefinitions,
    environmentDefinitions,
    shaderDefinitions,
    audioClipDefinitions,
    soundCueDefinitions,
    assetSources,
    soundEventBindings: session?.gameProject.soundEventBindings ?? {},
    audioMixer: session?.gameProject.audioMixer ?? null,
    npcDefinitions,
    questDefinitions,
    getViewportElement: () => viewportRef.current,
    viewportStore,
    regions,
    onSelectKind: (kind) =>
      shellStore.getState().setActiveBuildWorkspaceKind(kind),
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
    // Plan 058 §058.3 — scope conversion + cross-Scene copy.
    onConvertAssetScope: (regionId, instanceId) => {
      const { session } = projectStore.getState();
      if (!session) return;
      projectStore
        .getState()
        .updateSession(
          convertAssetScopeInSession(session, { regionId, instanceId })
        );
    },
    onCopyEntryToScene: (options) => {
      const { session } = projectStore.getState();
      const fromScene = session ? getActiveScene(session) : null;
      if (!session || !fromScene) return;
      projectStore
        .getState()
        .updateSession(
          copyOverlayEntryToScene(session, {
            fromSceneId: fromScene.sceneId,
            ...options
          })
        );
    },
    onGenerateAssetPaintUvs: handleGenerateAssetPaintUvs,
    onOpenAssetsLibrary: (definitionId) => {
      setAssetsLibraryPreselectId(definitionId);
      shellStore.getState().setActiveLibrary("assets");
    },
    onCreateMaterialDefinition: handleCreateMaterialDefinition,
    onImportPbrMaterial: handleImportPbrMaterial,
    onImportTextureDefinition: handleImportTextureDefinition,
    onCreateMaskTextureDefinition: handleCreateMaskTextureDefinition,
    onImportMaskTextureDefinition: handleImportMaskTextureDefinition,
    onUpdateMaterialDefinition: handleUpdateMaterialDefinition,
    onDuplicateMaterialDefinition: handleDuplicateMaterialDefinition,
    onRemoveMaterialDefinition: handleRemoveMaterialDefinition,
    onCreateSurfaceDefinition: handleCreateSurfaceDefinition,
    onUpdateSurfaceDefinition: handleUpdateSurfaceDefinition,
    onDuplicateSurfaceDefinition: handleDuplicateSurfaceDefinition,
    onRemoveSurfaceDefinition: handleRemoveSurfaceDefinition,
    onCreateSoundCueDefinition: handleCreateSoundCueDefinition,
    onUpdateSoundCueDefinition: handleUpdateSoundCueDefinition,
    onRemoveSoundCueDefinition: handleRemoveSoundCueDefinition,
    onSetSoundEventBinding: handleSetSoundEventBinding,
    onUpdateAudioMixer: handleUpdateAudioMixer,
    musicBindings: session?.gameProject.musicBindings ?? null,
    onUpdateMusicBindings: handleUpdateMusicBindings,
    selectedSurfaceDefinitionId: editedSurfaceDefinitionId,
    onSelectSurfaceDefinition: (definitionId) =>
      surfaceEditingStore.getState().setEditedSurfaceDefinitionId(definitionId),
    activeMaskPaintTarget,
    onSetMaskPaintTarget: (target) =>
      viewportStore.getState().setActiveMaskPaintTarget(target),
    surfaceCenterPanel: (
      <SurfacePreviewViewport
        engine={studioRenderEngine}
        contentLibrary={session?.contentLibrary ?? null}
        surfaceDefinition={
          surfaceDefinitions.find(
            (definition) =>
              definition.definitionId === editedSurfaceDefinitionId
          ) ?? null
        }
        previewGeometryKind={surfacePreviewGeometryKind}
        onChangePreviewGeometryKind={(kind) =>
          surfaceEditingStore.getState().setPreviewGeometryKind(kind)
        }
      />
    ),
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
    gameProjectId: session?.gameProject.identity.id ?? null,
    regions: regionDocuments,
    scenes: session?.gameProject.scenes ?? [],
    creditsDefinition:
      session?.gameProject.creditsDefinition ?? { sections: [] },
    onUpdateCredits: (credits) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore
        .getState()
        .updateSession(updateCreditsInSession(currentSession, credits));
    },
    renderCreditsPreview: () => (
      <CreditsPreview
        credits={session?.gameProject.creditsDefinition ?? { sections: [] }}
      />
    ),
    playerDefinition,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    menuDefinitions: session?.gameProject.menuDefinitions ?? [],
    hudDefinition: session?.gameProject.hudDefinition ?? null,
    uiTheme: session?.gameProject.uiTheme ?? {
      tokens: {},
      styles: []
    },
    mechanics:
      session?.gameProject.mechanics ?? createDefaultMechanicsDefinition(),
    extraWorkspaceItems: renderablePluginWorkspaceItems,
    npcInteractionOptions,
    assetDefinitions,
    assetSources,
    characterModelDefinitions,
    characterAnimationDefinitions,
    designPreviewStore,
    onSelectKind: (kind) =>
      shellStore.getState().setActiveDesignWorkspaceKind(kind),
    onCommand: dispatchCommand,
    onImportCharacterModelDefinition: handleImportCharacterModelDefinition,
    onImportCharacterAnimationDefinition:
      handleImportCharacterAnimationDefinition,
    characterWizardServices,
    onImportAsset: handleImportAsset,
    onGenerateItemThumbnail: handleGenerateItemThumbnail,
    onAppendDocumentPage: handleAppendDocumentPage,
    renderGameUIPreview: ({ initialVisibleMenuKey }) => (
      <UIPreviewSession
        project={session?.gameProject ?? null}
        initialVisibleMenuKey={initialVisibleMenuKey}
      />
    ),
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
    textureDefinitions,
    onSelectKind: (kind) =>
      shellStore.getState().setActiveRenderWorkspaceKind(kind),
    onCommand: dispatchCommand,
    navigationTarget: workspaceNavigationTarget,
    onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null)
  });
  // Story 46.5 — gather plugin-contributed Publish workspaces (e.g.
  // SugarDeploy's Provision / Release / Deploy). Two halves: shell
  // contributions provide labels + icons + sort order; plugin
  // workspace definitions provide createWorkspaceView. We zip them
  // by workspaceKind, render each contribution's view, and pass the
  // sorted result into the Publish productmode hook.
  const pluginPublishWorkspaceItems = useMemo(() => {
    const publishWorkspaceDefinitions =
      studioPluginWorkspaceDefinitions.filter(
        (definition) => definition.productMode === "publish"
      );
    return pluginShellContributions.publishWorkspaces
      .map((contribution) => {
        const definition = publishWorkspaceDefinitions.find(
          (entry) => entry.workspaceKind === contribution.workspaceKind
        );
        if (!definition) return null;
        const view = definition.createWorkspaceView({
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          onCommand: dispatchCommand,
          requestSave: requestSaveFromPlugin
        });
        return {
          workspaceKind: contribution.workspaceKind,
          label: contribution.label,
          icon: contribution.icon,
          view
        };
      })
      .filter(
        (
          entry
        ): entry is {
          workspaceKind: string;
          label: string;
          icon: string;
          view: ReturnType<
            (typeof studioPluginWorkspaceDefinitions)[number]["createWorkspaceView"]
          >;
        } => entry !== null
      );
  }, [
    pluginShellContributions.publishWorkspaces,
    studioPluginWorkspaceDefinitions,
    pluginConfigurations,
    session?.gameProject
  ]);
  const publishView = usePublishProductModeView({
    activePublishKind,
    gameProject: session?.gameProject ?? null,
    pluginConfigurations,
    onSelectKind: (kind) =>
      shellStore.getState().setActivePublishWorkspaceKind(kind),
    pluginPublishWorkspaces: pluginPublishWorkspaceItems
  });
  const activePluginWorkspaceDefinition =
    getStudioPluginWorkspaceDefinition(activeDesignKind);
  const activePluginView = useMemo(() => {
    if (!activePluginWorkspaceDefinition) return null;
    return activePluginWorkspaceDefinition.createWorkspaceView({
      gameProjectId: session?.gameProject.identity.id ?? null,
      gameProject: session?.gameProject ?? null,
      pluginConfigurations,
      onCommand: dispatchCommand,
      requestSave: requestSaveFromPlugin
    });
  }, [
    activePluginWorkspaceDefinition,
    pluginConfigurations,
    session?.gameProject
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
              Plugin-owned authoring surfaces render here through the shared
              shell contribution seam.
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
    sugarlangTargetLanguage
  ]);

  const activeDesignPanels =
    activePluginView ?? genericPluginView ?? designView;
  const shouldRenderSharedViewport = shouldShowSharedViewport({
    phase,
    activeProductMode,
    activeBuildKind,
    activeDesignKind,
    buildCenterPanelVisible: Boolean(buildView.centerPanel),
    designCenterPanelVisible: Boolean(activeDesignPanels.centerPanel)
  });

  useEffect(() => {
    if (!shouldRenderSharedViewport) {
      return;
    }
    if (!viewportRef.current) {
      return;
    }
    // Player + NPC now provide a self-contained `centerPanel`
    // (CharacterPreview), so the shared 3D viewport is only mounted
    // for design > items. Other design kinds (spells, documents,
    // dialogues, quests) also use centerPanel and the
    // shouldRenderSharedViewport gate above already short-circuits
    // those — only items reaches here in design mode.
    if (activeProductMode === "design" && activeDesignKind !== "items") {
      return;
    }
    const viewport =
      activeProductMode === "design"
        ? createItemViewport({
            engine: studioRenderEngine,
            stores: {
              projectStore,
              shellStore,
              viewportStore,
              assetSourceStore,
              designPreviewStore
            }
          })
        : createAuthoringViewport({
            engine: studioRenderEngine,
            stores: {
              projectStore,
              shellStore,
              viewportStore,
              assetSourceStore,
              designPreviewStore
            },
            readMaskTexture: handleReadMaskTexture,
            writeMaskTexture: handleWriteMaskTexture,
            createMaskTextureDefinition: handleCreateMaskTextureDefinition,
            overlays: [
              mountAuthoringCameraOverlay,
              mountLandscapeAuthoringOverlay,
              mountScatterBrushOverlay,
              mountSurfaceBrushOverlay,
              mountMaskPaintOverlay,
              mountTransformGizmoOverlay,
              mountSpatialAuthoringOverlay
            ]
          });
    viewport.mount(viewportRef.current);
    workspaceViewportRef.current = viewport;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        viewport.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(viewportRef.current);

    return () => {
      observer.disconnect();
      workspaceViewportRef.current = null;
      viewport.unmount();
    };
  }, [
    activeDesignKind,
    activeProductMode,
    handleReadMaskTexture,
    handleWriteMaskTexture,
    shouldRenderSharedViewport
  ]);

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

  // The shared definition catalogs every surface editor consumes
  // (binding editor, layer stack, mask editor, slot editors) —
  // provided once here instead of threading a 10-prop bundle down
  // 4+ component levels. Memoized so consumers only re-render when
  // a catalog actually changes.
  const surfaceAuthoringCatalog = useMemo(
    () => ({
      surfaceDefinitions,
      materialDefinitions,
      textureDefinitions,
      maskTextureDefinitions,
      shaderDefinitions,
      grassTypeDefinitions,
      flowerTypeDefinitions,
      rockTypeDefinitions,
      onCreateMaskTextureDefinition: handleCreateMaskTextureDefinition,
      onImportMaskTextureDefinition: handleImportMaskTextureDefinition,
      activeMaskPaintTarget,
      onSetMaskPaintTarget: (target: PaintedMaskTargetAddress | null) =>
        viewportStore.getState().setActiveMaskPaintTarget(target),
      getPaintedMaskPreviewCanvas,
      paintedMaskPreviewVersion
    }),
    [
      surfaceDefinitions,
      materialDefinitions,
      textureDefinitions,
      maskTextureDefinitions,
      shaderDefinitions,
      grassTypeDefinitions,
      flowerTypeDefinitions,
      rockTypeDefinitions,
      handleCreateMaskTextureDefinition,
      handleImportMaskTextureDefinition,
      activeMaskPaintTarget,
      getPaintedMaskPreviewCanvas,
      paintedMaskPreviewVersion
    ]
  );

  return (
    <SurfaceAuthoringProvider catalog={surfaceAuthoringCatalog}>
      <ProjectManagerDialog
        opened={phase === "no-project"}
        onOpen={handleOpenProject}
        onCreate={handleCreateProject}
      />
      <CreateRegionDialog
        opened={createRegionOpen}
        onClose={() => setCreateRegionOpen(false)}
        onCreate={handleCreateRegion}
      />
      <LibraryPopover
        shellStore={shellStore}
        materialDefinitions={materialDefinitions}
        textureDefinitions={textureDefinitions}
        shaderDefinitions={shaderDefinitions}
        audioClipDefinitions={audioClipDefinitions}
        assetDefinitions={assetDefinitions}
        contentLibrary={session?.contentLibrary ?? null}
        assetSources={assetSources}
        assetResolver={studioRenderEngine.assetResolver}
        isMaterialReferenced={(definitionId) =>
          session
            ? materialDefinitionHasReferences(session, definitionId)
            : false
        }
        isTextureReferenced={(definitionId) =>
          session
            ? textureDefinitionHasReferences(session, definitionId)
            : false
        }
        isAssetReferenced={(definitionId) =>
          session ? assetDefinitionHasReferences(session, definitionId) : false
        }
        assetsPreselectId={assetsLibraryPreselectId}
        onImportAssetDefinition={handleImportAsset}
        onUpdateAssetDefinition={handleUpdateAssetDefinition}
        onSetAssetMaterialSlotBinding={handleSetAssetMaterialSlotBinding}
        onSetAssetDefaultShader={handleSetAssetDefaultShader}
        onRemoveAssetDefinition={handleRemoveAssetDefinition}
        onRemoveTextureDefinition={(definitionId) => {
          const { session: currentSession } = projectStore.getState();
          if (!currentSession) return;
          projectStore
            .getState()
            .updateSession(
              removeTextureDefinitionFromSession(currentSession, definitionId)
            );
        }}
        onCreateMaterialDefinition={handleCreateMaterialDefinition}
        onImportPbrMaterial={handleImportPbrMaterial}
        onImportTextureDefinition={handleImportTextureDefinition}
        onImportAudioClipDefinition={handleImportAudioClipDefinition}
        onUpdateAudioClipDefinition={handleUpdateAudioClipDefinition}
        onRemoveMaterialDefinition={handleRemoveMaterialDefinition}
        onRemoveAudioClipDefinition={handleRemoveAudioClipDefinition}
        onEditShaderInGraph={(shaderDefinitionId) => {
          // Close the popover and route the existing workspace-
          // navigation handler to the Render workspace's shader
          // graph editor with this shader pre-selected.
          shellStore.getState().setActiveLibrary(null);
          handleWorkspaceNavigation({
            kind: "shader-graph",
            shaderDefinitionId
          });
        }}
      />
      {session && (
        <ManageScenesModal
          opened={manageScenesOpen}
          onClose={() => setManageScenesOpen(false)}
          scenes={session.gameProject.scenes}
          activeSceneId={session.activeSceneId}
          scenesUiLabel={session.gameProject.scenesUiLabel}
          questDefinitions={session.gameProject.questDefinitions}
          environmentDefinitions={session.contentLibrary.environmentDefinitions.map(
            (definition) => ({
              definitionId: definition.definitionId,
              displayName: definition.displayName
            })
          )}
          regions={[...session.regions.values()].map((region) => ({
            regionId: region.identity.id,
            displayName: region.displayName
          }))}
          soundCueDefinitions={(
            session.contentLibrary.soundCueDefinitions ?? []
          ).map((cue) => ({
            definitionId: cue.definitionId,
            displayName: cue.displayName
          }))}
          onAddScene={handleAddScene}
          onRenameScene={handleRenameScene}
          onUpdateScene={handleUpdateScene}
          onDeleteScene={handleDeleteScene}
          onReorderScene={handleReorderScene}
          onSelectScene={handleSceneSelect}
        />
      )}
      <Modal
        opened={pluginsOpen}
        onClose={() => setPluginsOpen(false)}
        title="Plugins"
        centered
        styles={{
          header: {
            background: "var(--sm-color-surface1)",
            borderBottom: "1px solid var(--sm-panel-border)"
          },
          title: { color: "var(--sm-color-text)", fontWeight: 600 },
          body: { background: "var(--sm-color-surface1)", padding: "20px" },
          content: { background: "var(--sm-color-surface1)" },
          close: {
            color: "var(--sm-color-overlay1)",
            "&:hover": { background: "var(--sm-active-bg)" }
          }
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
                const configuration =
                  pluginConfigurations.find(
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
                          onClick={() =>
                            handleUninstallPlugin(plugin.manifest.pluginId)
                          }
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
                          <Text
                            key={entry.settingsId}
                            size="xs"
                            c="var(--sm-color-subtext)"
                          >
                            Project Settings: {entry.label}
                          </Text>
                        ))}
                        {(plugin.shell.designWorkspaces ?? []).map((entry) => (
                          <Text
                            key={entry.workspaceKind}
                            size="xs"
                            c="var(--sm-color-subtext)"
                          >
                            Design Workspace: {entry.label}
                          </Text>
                        ))}
                        {(plugin.shell.designSections ?? []).map((entry) => (
                          <Text
                            key={entry.sectionId}
                            size="xs"
                            c="var(--sm-color-subtext)"
                          >
                            Design Section: {entry.workspaceKind} /{" "}
                            {entry.label}
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
                      onClick={() =>
                        handleInstallPlugin(plugin.manifest.pluginId)
                      }
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
            <Text fw={700} size="sm" c="var(--sm-color-text)" mr="md">
              Sugarmagic
            </Text>
            {phase === "active" && session && (
              <Group
                gap={6}
                align="center"
                mr="var(--sm-space-lg)"
                wrap="nowrap"
              >
                <Menu position="bottom-start" offset={4}>
                  <Menu.Target>
                    <UnstyledButton
                      px="md"
                      py={6}
                      styles={{
                        root: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-accent-blue)",
                          background: "var(--sm-active-bg)",
                          borderRadius: "var(--sm-radius-sm)",
                          "&:hover": { background: "var(--sm-active-bg-hover)" }
                        }
                      }}
                    >
                      📁 {session.gameProject.displayName}
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown
                    styles={{
                      dropdown: {
                        background: "var(--sm-color-surface1)",
                        border: "1px solid var(--sm-panel-border)",
                        minWidth: 200,
                        padding: "var(--sm-space-xs) 0"
                      }
                    }}
                  >
                    <Menu.Item
                      onClick={handleSave}
                      // Always available: not every mutation flips the
                      // dirty flag (painted-mask strokes are the known
                      // gap), and a save that finds nothing changed is
                      // harmless. Better to always let the author save
                      // than to silently strand real changes behind a
                      // grayed-out menu (2026-07-13).
                      rightSection={
                        <Text size="xs" c="var(--sm-color-overlay0)">
                          ⌘S
                        </Text>
                      }
                      styles={{
                        item: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-color-text)",
                          padding: "10px 16px",
                          "&:hover": { background: "var(--sm-active-bg)" },
                          "&[data-disabled]": {
                            color: "var(--sm-color-overlay0)"
                          }
                        }
                      }}
                    >
                      💾 Save Game
                    </Menu.Item>
                    <Menu.Item
                      onClick={handleUndo}
                      disabled={undoCount === 0}
                      rightSection={
                        <Text size="xs" c="var(--sm-color-overlay0)">
                          ⌘Z
                        </Text>
                      }
                      styles={{
                        item: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-color-text)",
                          padding: "10px 16px",
                          "&:hover": { background: "var(--sm-active-bg)" },
                          "&[data-disabled]": {
                            color: "var(--sm-color-overlay0)"
                          }
                        }
                      }}
                    >
                      ↩ Undo
                    </Menu.Item>
                    <Menu.Divider
                      styles={{
                        divider: { borderColor: "var(--sm-panel-border)" }
                      }}
                    />
                    <Menu.Sub position="right-start" offset={4}>
                      <Menu.Sub.Target>
                        <Menu.Sub.Item
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          📚 Libraries
                        </Menu.Sub.Item>
                      </Menu.Sub.Target>
                      <Menu.Sub.Dropdown
                        styles={{
                          dropdown: {
                            background: "var(--sm-color-surface1)",
                            border: "1px solid var(--sm-panel-border)",
                            minWidth: 200,
                            padding: "var(--sm-space-xs) 0"
                          }
                        }}
                      >
                        <Menu.Item
                          onClick={() => {
                            setAssetsLibraryPreselectId(null);
                            shellStore.getState().setActiveLibrary("assets");
                          }}
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          📦 Assets
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            shellStore.getState().setActiveLibrary("materials")
                          }
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          🎨 Materials
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            shellStore.getState().setActiveLibrary("textures")
                          }
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          🖼 Textures
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            shellStore.getState().setActiveLibrary("shaders")
                          }
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          ⚙ Shaders
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            shellStore.getState().setActiveLibrary("audio")
                          }
                          styles={{
                            item: {
                              fontSize: "var(--sm-font-size-lg)",
                              color: "var(--sm-color-text)",
                              padding: "10px 16px",
                              "&:hover": { background: "var(--sm-active-bg)" }
                            }
                          }}
                        >
                          Audio
                        </Menu.Item>
                      </Menu.Sub.Dropdown>
                    </Menu.Sub>
                    <Menu.Divider
                      styles={{
                        divider: { borderColor: "var(--sm-panel-border)" }
                      }}
                    />
                    <Menu.Item
                      onClick={() => setPluginsOpen(true)}
                      styles={{
                        item: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-color-text)",
                          padding: "10px 16px",
                          "&:hover": { background: "var(--sm-active-bg)" }
                        }
                      }}
                    >
                      🧩 Plugins
                    </Menu.Item>
                    <Menu.Item
                      onClick={handleReload}
                      styles={{
                        item: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-color-text)",
                          padding: "10px 16px",
                          "&:hover": { background: "var(--sm-active-bg)" }
                        }
                      }}
                    >
                      🔄 Reload Project
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                <Badge
                  variant="light"
                  color="blue"
                  size="sm"
                  styles={{
                    root: {
                      background: "var(--sm-active-bg)",
                      color: "var(--sm-accent-blue)",
                      fontWeight: 600,
                      textTransform: "none"
                    }
                  }}
                >
                  v{session.gameProject.majorVersion}
                </Badge>
                {/* Plan 058 §058.2 — Scene selector (Ambient
                    Context). Scope narrows left to right:
                    project > version > Scene > workspaces. */}
                <Menu position="bottom-start" width={240}>
                  <Menu.Target>
                    <UnstyledButton
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        borderRadius: 6,
                        background: "var(--sm-active-bg)",
                        color: "var(--sm-color-text)",
                        fontSize: "var(--sm-font-size-sm)",
                        fontWeight: 600
                      }}
                    >
                      🎬{" "}
                      {getActiveScene(session)?.displayName ??
                        session.gameProject.scenesUiLabel}
                      <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown
                    styles={{
                      dropdown: {
                        background: "var(--sm-color-surface1)",
                        border: "1px solid var(--sm-panel-border)",
                        padding: "var(--sm-space-xs) 0"
                      }
                    }}
                  >
                    <Menu.Label>
                      {session.gameProject.scenesUiLabel}s
                    </Menu.Label>
                    {session.gameProject.scenes.map((scene) => (
                      <Menu.Item
                        key={scene.sceneId}
                        onClick={() => handleSceneSelect(scene.sceneId)}
                        styles={{
                          item: {
                            fontSize: "var(--sm-font-size-lg)",
                            color:
                              scene.sceneId ===
                              getActiveScene(session)?.sceneId
                                ? "var(--sm-accent-blue)"
                                : "var(--sm-color-text)",
                            padding: "10px 16px",
                            "&:hover": { background: "var(--sm-active-bg)" }
                          }
                        }}
                      >
                        {scene.sceneId === getActiveScene(session)?.sceneId
                          ? "✓ "
                          : ""}
                        {scene.displayName}
                      </Menu.Item>
                    ))}
                    <Menu.Divider
                      styles={{
                        divider: { borderColor: "var(--sm-panel-border)" }
                      }}
                    />
                    <Menu.Item
                      onClick={() => setManageScenesOpen(true)}
                      styles={{
                        item: {
                          fontSize: "var(--sm-font-size-lg)",
                          color: "var(--sm-color-text)",
                          padding: "10px 16px",
                          "&:hover": { background: "var(--sm-active-bg)" }
                        }
                      }}
                    >
                      ⚙ Manage {session.gameProject.scenesUiLabel}s...
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            )}
            <ModeBar
              items={modeBarItems}
              activeId={activeProductMode}
              onSelect={(id) =>
                shellStore
                  .getState()
                  .setActiveProductMode(id as typeof activeProductMode)
              }
            />
            {phase === "active" && (
              <ActionStripe
                isPreviewRunning={isPreviewRunning}
                onStartPreview={() =>
                  handleStartPreview(assetSources, installedPluginIds)
                }
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
                  : isPublish
                    ? publishView.subHeaderPanel
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
                : isPublish
                  ? publishView.leftPanel
                  : null
        }
        rightPanel={
          isBuild
            ? buildView.rightPanel
            : isDesign
              ? activeDesignPanels.rightPanel
              : isRender
                ? renderView.rightPanel
                : isPublish
                  ? publishView.rightPanel
                  : undefined
        }
        bottomPanel={
          <StatusBar
            message={statusMessage}
            severity={phase === "error" ? "error" : "info"}
            trailing={activeWorkspaceId ?? undefined}
          />
        }
        centerPanel={
          phase === "active" && isBuild && buildView.centerPanel ? (
            buildView.centerPanel
          ) : phase === "active" &&
            isDesign &&
            activeDesignPanels.centerPanel ? (
            activeDesignPanels.centerPanel
          ) : phase === "active" && isRender && renderView.centerPanel ? (
            renderView.centerPanel
          ) : phase === "active" && isPublish && publishView.centerPanel ? (
            publishView.centerPanel
          ) : (
            <ViewportFrame>
              {shouldRenderSharedViewport ? (
                <>
                  <div
                    ref={viewportRef}
                    style={{ position: "absolute", inset: 0 }}
                  />
                  {isBuild && buildView.viewportOverlay}
                  {isDesign && activeDesignPanels.viewportOverlay}
                  {isRender && renderView.viewportOverlay}
                  {isPublish && publishView.viewportOverlay}
                </>
              ) : (
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Open or create a project to begin.
                </Text>
              )}
            </ViewportFrame>
          )
        }
      />
    </SurfaceAuthoringProvider>
  );
}
