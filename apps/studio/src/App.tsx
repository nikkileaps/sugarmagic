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
import { StoryStructureView } from "./StoryStructureView";
import { SceneComposerPanel } from "./SceneComposerPanel";
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
  type AssetColliderShape,
  assetDefinitionsNeedingColliderBake,
  classifyAssetColliderBake,
  getAssetDefinition,
  getMaskTextureDefinition,
  getSurfaceDefinition,
  cloneSurface,
  createDefaultSurface,
  type Surface,
  createAuthoringSession,
  applyCommand,
  redoSession,
  undoSession,
  markSessionClean,
  switchActiveRegion,
  switchActiveScene,
  getActiveScene,
  addSceneToSession,
  updateSceneInSession,
  updateEpisodeInSession,
  addEpisodeToSession,
  addSeasonToSession,
  deleteSeasonFromSession,
  reorderSeasonInSession,
  updateSeasonInSession,
  moveEpisodeToSeasonInSession,
  type Season,
  deleteEpisodeFromSession,
  reorderEpisodeInSession,
  moveSceneToEpisodeInSession,
  updateEpisodeEndRoutingInSession,
  type EpisodeEndRouting,
  deleteSceneFromSession,
  reorderSceneInSession,
  convertAssetScopeInSession,
  copyOverlayEntryToScene,
  addRegionToSession,
  getActiveRegion,
  getAllRegions,
  getAllAssetDefinitions,
  getAllAudioClipDefinitions,
  getAllAnimationLibraryDefinitions,
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
  getAllWorldFlagDefinitions,
  createWorldFlagDefinition,
  validateProjectContent,
  blockingIssues,
  getAllTextureDefinitions,
  listFlowerTypeDefinitions,
  listGrassTypeDefinitions,
  listMaskTextureDefinitions,
  listRockTypeDefinitions,
  getPlayerDefinition,
  addAssetDefinitionToSession,
  addAudioClipDefinitionToSession,
  addAnimationLibraryDefinitionToSession,
  updateAnimationLibraryDefinitionInSession,
  removeAnimationLibraryDefinitionFromSession,
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
  createScopedId,
  sceneOverlayForRegion,
  getAllScenes,
  getAllEpisodes,
  type Scene,
  getActiveRegionContents
} from "@sugarmagic/domain";
import {
  buildSugarlangPreviewBootPayloadForSession,
  collectPluginShellContributions,
  ensureDiscoveredPluginConfiguration,
  getDeploymentSettings,
  listDiscoveredPluginDefinitions,
  planGameDeployment,
  resolveInstalledPluginDefinitions
} from "@sugarmagic/plugins";
import {
  checkDirectoryHasProject,
  createProjectInDirectory,
  openProject,
  loadProjectFromHandle,
  rememberLastOpenedProject,
  recallLastOpenedProject,
  forgetLastOpenedProject,
  requestProjectDirectoryAccess,
  type ActiveProject,
  pickDirectory,
  saveProjectWithManagedFiles,
  inspectManagedProjectFiles,
  importPbrTextureSet,
  importMaskTextureDefinition,
  importTextureDefinition,
  seedCozyAnimations,
  cozySeedDefinitionId,
  importCharacterModelDefinition,
  importAudioClipDefinition,
  importAnimationLibraryFromGlbFile,
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
  validateMechanicsDefinition,
  bakeNavMesh,
  buildRegionNavMeshInput,
  computeNavMeshInputHash,
  registerActiveGameId,
  placedLightBudgetWarning
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
  WorldFlagRegistryProvider,
  type WorldFlagRegistry,
  type WorkspaceViewport,
  useBuildProductModeView,
  useDesignProductModeView,
  usePublishProductModeView,
  useRenderProductModeView,
  type WorkspaceNavigationTarget,
  useStoryProductModeView
} from "@sugarmagic/workspaces";
import {
  ActionStripe,
  CreateRegionDialog,
  Inspector,
  ModeBar,
  ProjectManagerDialog,
  ShellFrame,
  ErrorToast,
  ProgressToast,
  StatusBar,
  ViewportFrame,
  shellIcons,
  type ModeBarItem
} from "@sugarmagic/ui";
import { useStore } from "zustand";
import { createAuthoringViewport } from "./viewport/authoringViewport";
import { bakePaintUvsIntoGlb } from "./asset-pipeline/paint-uvs";
import { correctAssetOriginToBottomCenter } from "./asset-pipeline/origin-correct";
import { createItemViewport } from "./viewport/itemViewport";
import { SurfacePreviewViewport } from "./viewport/surfacePreviewViewport";
import {
  SurfaceStudioModal,
  type SurfaceStudioTarget
} from "./SurfaceStudioModal";
import { LibraryPopover } from "./library/LibraryPopover";
import { shouldShowSharedViewport } from "./viewport/viewportVisibility";
import { historyShortcut, isTypingTarget } from "./keyboard/history-shortcuts";
import {
  clearLivePaintedMasks,
  computeAssetColliderBounds,
  createWebRenderEngine
} from "@sugarmagic/render-web";
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
import {
  cancelActiveViewportGesture,
  resolveNPCInteractionOptions
} from "@sugarmagic/workspaces";
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
      {section.render({
        ...props,
        writeAssetFile: writeProjectAssetFile,
        readAssetFile: readProjectAssetFile,
        requestSave: requestSaveFromPlugin
      })}
    </Fragment>
  ));
}

/**
 * Lets a plugin put a derived artifact into the project's
 * `assets/`, which is how it reaches a deployed game.
 *
 * Injected here rather than spelled out at each of the six prop sites: it
 * varies with nothing, so repeating it six times would only create six places
 * to forget it.
 *
 * Mirrors the navmesh bake step for step, including the second line, which is
 * load-bearing: `readBlobFile` intermittently returns null for a file written
 * moments earlier, so the in-memory blob is published to the asset-source
 * store rather than read back off disk.
 */
async function writeProjectAssetFile(
  relativeAssetPath: string,
  blob: Blob
): Promise<void> {
  const { handle } = projectStore.getState();
  if (!handle) {
    throw new Error(`Cannot write "${relativeAssetPath}": no project is open.`);
  }
  if (!relativeAssetPath.startsWith("assets/")) {
    // Everything outside assets/ is either authored truth or a generated file
    // the save owns. A plugin writing there would be writing behind the
    // project's back, and the deploy would not ship it anyway.
    throw new Error(
      `Plugin asset paths must start with "assets/": got "${relativeAssetPath}".`
    );
  }
  await writeBlobFile(handle, relativeAssetPath.split("/"), blob);
  assetSourceStore.getState().setSource(relativeAssetPath, blob);
}

/**
 * The read half. Serves the copy the asset-source store already holds,
 * which is populated on project open for every declared path.
 *
 * Going through the store rather than the disk is deliberate: `readBlobFile`
 * intermittently returns null just after a write, and this file is declared,
 * so opening the project already loaded it.
 */
async function readProjectAssetFile(
  relativeAssetPath: string
): Promise<Blob | null> {
  const url = assetSourceStore.getState().sources[relativeAssetPath];
  if (!url) {
    return null;
  }
  const response = await fetch(url);
  return response.ok ? await response.blob() : null;
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

/**
 * Seed the Cozy Idle/Walk/Run animation library entries on project
 * open/create. Runs async after setActive so it doesn't block the
 * UI. Only generates clips that aren't already in the session
 * (safe to call every open).
 */
async function seedAnimationLibraryIfNeeded(
  handle: FileSystemDirectoryHandle,
  descriptor: Parameters<typeof seedCozyAnimations>[0]["descriptor"],
  projectId: string
) {
  const { session } = projectStore.getState();
  if (!session) return;
  const existing = new Set(
    getAllAnimationLibraryDefinitions(session).map((d) => d.definitionId)
  );
  const SLUGS = ["cozy-idle", "cozy-walk", "cozy-run"];
  if (
    SLUGS.every((slug) => existing.has(cozySeedDefinitionId(projectId, slug)))
  )
    return;

  try {
    const result = await seedCozyAnimations(
      { projectHandle: handle, descriptor, projectId },
      existing
    );
    if (result.definitions.length === 0) return;

    const storeState = projectStore.getState();
    if (!storeState.session) return;
    let next = storeState.session;
    for (const definition of result.definitions) {
      next = addAnimationLibraryDefinitionToSession(next, definition);
    }
    for (const { relativeAssetPath, blob } of result.writtenAssets) {
      assetSourceStore.getState().setSource(relativeAssetPath, blob);
    }
    storeState.updateSession(next);
  } catch (err) {
    console.warn("[animation-library] Cozy seed failed:", err);
  }
}

function activateRegion(region: RegionDocument | undefined) {
  if (!region) return;
  shellStore.getState().setActiveRegionId(region.identity.id);
}

function activateDefaultEnvironment(environmentId: string | null | undefined) {
  shellStore.getState().setActiveEnvironmentId(environmentId ?? null);
}

/** Everything that has to happen once a project's files are loaded. Shared
 *  by opening from the picker and reopening the remembered directory, so
 *  the two cannot drift. */
function activateLoadedProject(active: ActiveProject) {
  const session = createAuthoringSession(
    active.gameProject,
    active.regions,
    active.contentLibrary
  );
  // Drop the previous project's live painted-mask pixels on switch --
  // the registry is module-scope in render-web, so stale masks would
  // otherwise bleed into scatter sampling (068.13 mini-review).
  clearLivePaintedMasks();
  projectStore.getState().setActive(active.handle, active.descriptor, session);
  activateRegion(active.regions[0]);
  activateDefaultEnvironment(
    session.contentLibrary.environmentDefinitions[0]?.definitionId
  );
  // The handle itself is already stored by `loadProjectFromHandle`; this
  // only records WHICH of the stored ones was last open.
  rememberLastOpenedProject(active.gameProject.identity.id);
  return session;
}

async function handleOpenProject() {
  try {
    const active = await openProject();
    activateLoadedProject(active);
    void seedAnimationLibraryIfNeeded(
      active.handle,
      active.descriptor,
      active.gameProject.identity.id
    );
  } catch (e) {
    handleProjectError(e);
  }
}

/**
 * Open the directory Studio last had open, without a file picker.
 *
 * Returns false when there is nothing to reopen or the browser refused,
 * which is when the welcome dialog earns its place.
 */
async function reopenRememberedProject(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  try {
    const active = await loadProjectFromHandle(handle);
    activateLoadedProject(active);
    void seedAnimationLibraryIfNeeded(
      active.handle,
      active.descriptor,
      active.gameProject.identity.id
    );
    return true;
  } catch (error) {
    // The folder moved, was renamed, or stopped being a game root. Forget
    // it rather than offering a button that fails the same way every time,
    // and say so -- a silently-empty welcome screen looks like a bug.
    console.warn(
      "[studio] could not reopen the last project; it has been forgotten.",
      error
    );
    forgetLastOpenedProject();
    return false;
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
    // Drop the previous project's live painted-mask pixels on switch --
    // the registry is module-scope in render-web, so stale masks would
    // otherwise bleed into scatter sampling (068.13 mini-review).
    clearLivePaintedMasks();
    projectStore
      .getState()
      .setActive(active.handle, active.descriptor, session);
    activateRegion(active.regions[0]);
    activateDefaultEnvironment(
      session.contentLibrary.environmentDefinitions[0]?.definitionId
    );
    void seedAnimationLibraryIfNeeded(
      active.handle,
      active.descriptor,
      active.gameProject.identity.id
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
  // `true` skips the managed-files overwrite confirm
  // dialog. Used by plugin-driven sagas (cut-major-version) that have
  // already confirmed the operation up-front through their own modal
  // and just need to flush the bumped state to disk silently.
  silentOverwriteManagedFiles: boolean;
}

interface PerformSaveResult {
  ok: boolean;
  reason?: string;
  /**
   * Whether this refusal already put its reason on screen. The refusal paths
   * below each show their own dialog, worded for what they refused; a caller
   * that alerts on every `ok: false` would show a second, more generic one
   * over the top of it.
   */
  alreadyReported?: boolean;
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
    return {
      ok: false,
      reason,
      alreadyReported: !options.silentOverwriteManagedFiles
    };
  }
  // Content that references something which does not exist cannot work in
  // play and cannot be fixed by playing further, so it stops the save. The
  // same checker's warnings -- a half-authored talk node, say -- are normal
  // mid-session and let the save through.
  const contentValidation = validateProjectContent(
    session.gameProject,
    getAllRegions(session),
    session.contentLibrary
  );
  if (!contentValidation.valid) {
    const blocking = blockingIssues(contentValidation);
    const reason = `Project content is invalid:\n${blocking
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n")}`;
    if (!options.silentOverwriteManagedFiles) {
      window.alert(`${reason}\n\nProject was not saved.`);
    }
    return {
      ok: false,
      reason,
      alreadyReported: !options.silentOverwriteManagedFiles
    };
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
    // Feed the in-memory runtime snapshot
    // through so boot.json bakes the real game content (regions +
    // content library + asset sources) rather than empty
    // placeholders.
    regions: getAllRegions(session),
    contentLibrary: session.contentLibrary,
    assetSources: {} as Record<string, string>,
    activeRegionId: session.activeRegionId,
    activeEnvironmentId: null as string | null
  };

  // Non-secret runtime config env comes from per-game plugin config,
  // which is already in memory on the session, rather than from
  // sugarmagic-root .env. No async fetch and no two-pass plan:
  // planGameDeployment computes the env map internally from enabled
  // plugins' gatewayRuntimeConfigKeys.
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
      return {
        ok: false,
        reason,
        alreadyReported: !options.silentOverwriteManagedFiles
      };
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
    // Logged as well as returned: the reason reaches the caller, but the stack
    // is the only thing that says which write threw.
    console.error("[studio] save failed", error);
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

async function handleSave() {
  const result = await performSave({ silentOverwriteManagedFiles: false });
  // A save that does not happen has to say so. Only the refusals that have not
  // already shown their own dialog reach this -- an exception on the way to
  // disk used to be caught and returned as a reason nobody read, so the project
  // stayed dirty and looked saved.
  if (!result.ok && result.reason && !result.alreadyReported) {
    window.alert(`Project was not saved.\n\n${result.reason}`);
  }
}

// Exposed to the plugin workspace via PluginWorkspaceViewProps. Lets sagas
// (cut-major-version is the first) flush in-memory dispatches to disk
// mid-flow with no UI prompts.
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
  // Same on reload -- drop the old live painted-mask pixels (068.13 review).
  clearLivePaintedMasks();
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

// Ambient Context switch: the top-bar Scene selector routes here.
// Every Design workspace and Preview follows the session's
// activeSceneId.
function handleSceneSelect(sceneId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(switchActiveScene(session, sceneId));
}

// Scene structural mutations, session-level rather than semantic
// commands — same seam as addRegionToSession, and outside the undo
// stream.
function handleAddScene(displayName: string, episodeId?: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore.getState().updateSession(
    addSceneToSession(session, {
      displayName,
      // The Episode the author has SELECTED, which is what the modal's
      // field says it will use. Without it the Scene lands in whichever
      // Episode holds the active Scene.
      ...(episodeId ? { episodeId } : {})
    })
  );
}

function handleRenameScene(sceneId: string, displayName: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateSceneInSession(session, sceneId, { displayName }));
}

// Season and Episode structural mutations, same seam as the Scene
// handlers below (session-level, outside the semantic command/undo
// stream).
function handleAddSeason(displayName: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(addSeasonToSession(session, { displayName }));
}

function handleDeleteSeason(seasonId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(deleteSeasonFromSession(session, seasonId));
}

function handleReorderSeason(seasonId: string, direction: "up" | "down") {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(reorderSeasonInSession(session, seasonId, direction));
}

function handleUpdateSeason(
  seasonId: string,
  patch: Partial<Pick<Season, "displayName" | "description" | "notes">>
) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateSeasonInSession(session, seasonId, patch));
}

function handleMoveEpisodeToSeason(episodeId: string, toSeasonId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(
      moveEpisodeToSeasonInSession(session, episodeId, toSeasonId)
    );
}

function handleAddEpisode(displayName: string, seasonId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(addEpisodeToSession(session, { displayName, seasonId }));
}

function handleDeleteEpisode(episodeId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(deleteEpisodeFromSession(session, episodeId));
}

function handleReorderEpisode(episodeId: string, direction: "up" | "down") {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(reorderEpisodeInSession(session, episodeId, direction));
}

function handleMoveSceneToEpisode(sceneId: string, toEpisodeId: string) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(moveSceneToEpisodeInSession(session, sceneId, toEpisodeId));
}

function handleMoveQuestToScene(questDefinitionId: string, toSceneId: string) {
  // Through the command, not the session function directly: the quest
  // inspector performs the same move, and routing both here keeps one
  // enforcer -- and gives the Scene-side list undo for free.
  const { session } = projectStore.getState();
  if (!session) return;
  dispatchCommand({
    kind: "MoveQuestToScene",
    target: {
      aggregateKind: "game-project",
      aggregateId: session.gameProject.identity.id
    },
    subject: { subjectKind: "quest-definition", subjectId: questDefinitionId },
    payload: { questDefinitionId, toSceneId }
  });
}

function handleUpdateEpisodeEndRouting(routing: EpisodeEndRouting) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateEpisodeEndRoutingInSession(session, routing));
}

// Episode metadata + gate writes from the Manage Scenes modal.
function handleUpdateEpisode(
  episodeId: string,
  patch: Parameters<typeof updateEpisodeInSession>[2]
) {
  const { session } = projectStore.getState();
  if (!session) return;
  projectStore
    .getState()
    .updateSession(updateEpisodeInSession(session, episodeId, patch));
}

// Scene properties panel writes: description, notes, overrides,
// transition card.
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
  projectStore
    .getState()
    .updateSession(deleteSceneFromSession(session, sceneId));
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
  installedPluginIds: string[],
  /** Surfaces a refusal to boot (see PreviewBootResult) as a visible error. */
  onBootRefused?: (message: string, detail?: string) => void
) {
  const { session } = projectStore.getState();
  if (!session) return;

  const shell = shellStore.getState();

  // Snapshot authoring context
  const snapshot: AuthoringContextSnapshot = {
    activeProductMode: shell.activeProductMode,
    activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
    activeDesignWorkspaceKind: shell.activeDesignWorkspaceKind,
    activeStoryWorkspaceKind: shell.activeStoryWorkspaceKind,
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
  // The listener stays attached for the lifetime of the preview
  // window so a window.location.reload() inside preview.tsx (the
  // "New Game" reset path) gets a fresh PREVIEW_BOOT response.
  // Removing it after the first READY leaves a reloaded preview
  // hanging on a blank screen forever
  // because Studio stopped answering. Removed when the preview
  // window closes (handled by the same interval below).
  async function onMessage(event: MessageEvent) {
    if (event.data?.type === "PREVIEW_READY") {
      const result = await postPreviewBootMessage(
        capturedWindow,
        capturedSession,
        capturedSnapshot,
        capturedAssetSources,
        capturedInstalledPluginIds
      );
      if (!result.ok) {
        // Close the preview rather than leaving it on a blank screen. A window
        // that opened and shows nothing reads as a hang; a closed window plus an
        // error reads as a refusal, which is what it is.
        capturedWindow.close();
        onBootRefused?.(result.message, result.detail);
      }
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
  if (snapshot.activeProductMode === "story") {
    shell.setActiveStoryWorkspaceKind(snapshot.activeStoryWorkspaceKind);
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

/**
 * Why this returns a result instead of just posting.
 *
 * Preview IS the runtime, and the runtime must not run with sugarlang enabled
 * and no target language (nikki, 2026-07-31). Refusing is correct -- but it has
 * to be VISIBLE. Until 2026-07-31 the sugarlang payload was built inside the
 * `postMessage` argument list, so a throw meant PREVIEW_BOOT was never sent at
 * all: the preview window sat blank forever with nothing said, and it happened
 * for projects that do not use sugarlang either.
 */
type PreviewBootResult =
  | { ok: true }
  | { ok: false; message: string; detail?: string };

async function postPreviewBootMessage(
  previewWindow: Window,
  session: ReturnType<typeof projectStore.getState>["session"],
  snapshot: AuthoringContextSnapshot,
  assetSources: Record<string, string>,
  installedPluginIds: string[]
): Promise<PreviewBootResult> {
  if (!session || previewWindow.closed) {
    return { ok: true };
  }

  const regions = getAllRegions(session);
  const runtimeEnvironment = readStudioPluginRuntimeEnvironment();

  // Built BEFORE the message, so a failure here is a decision rather than a
  // silently suppressed postMessage.
  const sugarlangEnabled =
    session.gameProject.pluginConfigurations.find(
      (configuration) => configuration.pluginId === "sugarlang"
    )?.enabled === true;

  let sugarlangBootPayload: Awaited<
    ReturnType<typeof buildSugarlangPreviewBootPayloadForSession>
  > = null;
  try {
    sugarlangBootPayload = await buildSugarlangPreviewBootPayloadForSession(
      session,
      snapshot.activeWorkspaceId ?? session.gameProject.identity.id,
      runtimeEnvironment
    );
  } catch (error) {
    return {
      ok: false,
      message:
        "Preview could not start: building the Sugarlang payload failed.",
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  // ONLY when sugarlang is actually enabled. A project running vanilla, or with
  // only sugaragent, must not be blocked by sugarlang's configuration.
  if (sugarlangEnabled && !sugarlangBootPayload) {
    return {
      ok: false,
      message:
        "Preview did not start: Sugarlang is enabled but no target language is set.",
      detail:
        "Set a target language in the Sugarlang workspace's Language panel, or disable the Sugarlang plugin to preview without it."
    };
  }

  previewWindow.postMessage(
    {
      type: "PREVIEW_BOOT",
      regions,
      // The story rides the boot payload; the runtime gates the
      // Episodes across the flattened run and composes the active
      // Scene's overlays onto the region base.
      seasons: session.gameProject.seasons,
      episodeEndRouting: session.gameProject.episodeEndRouting,
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
      worldFlagDefinitions: session.gameProject.worldFlagDefinitions,
      spellDefinitions: session.gameProject.spellDefinitions,
      itemDefinitions: session.gameProject.itemDefinitions,
      documentDefinitions: session.gameProject.documentDefinitions,
      npcDefinitions: session.gameProject.npcDefinitions,
      dialogueDefinitions: session.gameProject.dialogueDefinitions,
      questDefinitions: getAllQuestDefinitions(session),
      menuDefinitions: session.gameProject.menuDefinitions,
      hudDefinition: session.gameProject.hudDefinition,
      uiTheme: session.gameProject.uiTheme,
      soundEventBindings: session.gameProject.soundEventBindings,
      audioMixer: session.gameProject.audioMixer,
      // Project music slots.
      musicBindings: session.gameProject.musicBindings,
      // Credits roll content.
      creditsDefinition: session.gameProject.creditsDefinition,
      // The entry title sequence's first card.
      gameTitle: session.gameProject.displayName,
      // Preview serves every project from ONE origin, so without this two
      // projects share the same databases and read each other's saves and
      // learner data. displayName is for humans; the id is what storage is
      // keyed on.
      gameId: session.gameProject.identity.id,
      assetSources,
      // The authored fresh-start record. Studio preview mirrors the
      // published-web boot.json shape so a "New Game" reset spawns at
      // the project-curated values rather than the implicit
      // playerPresence defaults.
      defaultGameSavePayload: session.gameProject.defaultGameSavePayload,
      pluginBootPayloads: {
        sugarlang: sugarlangBootPayload ?? undefined
      }
    },
    "*"
  );

  return { ok: true };
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
  const activeStoryKind = useStore(
    shellStore,
    (s) => s.activeStoryWorkspaceKind
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
  const activeSelectionId = useStore(
    shellStore,
    (s) => s.selection.activeEntityId
  );

  const phase = useStore(projectStore, (s) => s.phase);
  const projectHandle = useStore(projectStore, (s) => s.handle);
  const session = useStore(projectStore, (s) => s.session);
  const previewWindow = useStore(previewStore, (s) => s.previewWindow);

  // The project Studio last had open. When the browser still grants access
  // it reopens on its own and the author never sees the welcome dialog --
  // which is the common case after a reload. When the browser wants a
  // gesture first, the dialog offers a one-click way back in.
  const [reopenable, setReopenable] = useState<{
    handle: FileSystemDirectoryHandle;
    name: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remembered = await recallLastOpenedProject();
      if (cancelled || !remembered) return;
      if (remembered.access === "granted") {
        await reopenRememberedProject(remembered.handle);
        return;
      }
      setReopenable({
        handle: remembered.handle,
        name: remembered.handle.name
      });
    })();
    return () => {
      cancelled = true;
    };
    // Boot only: reopening on every render would fight the author's own
    // File > Open.
  }, []);

  // Studio itself needs the open project's id, because some
  // author-facing panels read the PLAYER's storage directly (the SugarProfile
  // panel's anonymous-user row and its Regenerate button). Those names lead
  // with the game, so without this they cannot be built and the panel throws.
  //
  // Registered from the open project rather than from a preview boot: Studio
  // and the Preview iframe are separate documents with separate copies of this
  // registry, and the panel is reachable whether or not Preview is running.
  const openProjectId = session?.gameProject.identity.id ?? null;
  useEffect(() => {
    registerActiveGameId(openProjectId);
  }, [openProjectId]);

  const isDirty = session?.isDirty ?? false;
  const undoCount = session?.undoStack.length ?? 0;
  const redoCount = session?.redoStack.length ?? 0;
  // Flips false->true once when a project loads; the only session-derived
  // trigger for the preview boot, so edits don't re-fire it.
  const hasSession = session != null;
  const isBuild = activeProductMode === "build";
  const isDesign = activeProductMode === "design";
  const isStory = activeProductMode === "story";
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
  const animationLibraryDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllAnimationLibraryDefinitions(session);
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
  const surfaceBrushSettings = useStore(
    viewportStore,
    (state) => state.surfaceBrushSettings
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

  const worldFlagDefinitions = useMemo(() => {
    if (!session) return [];
    return getAllWorldFlagDefinitions(session);
  }, [session]);

  const worldFlagRegistry = useMemo<WorldFlagRegistry>(
    () => ({
      worldFlagDefinitions,
      createWorldFlag: (name) => {
        const definition = createWorldFlagDefinition({
          name,
          displayName: name
        });
        dispatchCommand({
          kind: "CreateWorldFlagDefinition",
          target: {
            aggregateKind: "game-project",
            aggregateId:
              projectStore.getState().session?.gameProject.identity.id ?? ""
          },
          subject: {
            subjectKind: "world-flag-definition",
            subjectId: definition.definitionId
          },
          payload: { definition }
        });
        return definition.definitionId;
      }
    }),
    [worldFlagDefinitions]
  );

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
  /** Set when the preview refuses to boot -- e.g. sugarlang enabled with no
   *  target language. Rendered as an ErrorToast so the refusal is visible
   *  instead of presenting as a blank preview window. */
  const [previewBootError, setPreviewBootError] = useState<{
    message: string;
    detail?: string;
  } | null>(null);

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

  // The Preview boots ONCE, when you launch it, and does NOT auto-reboot on
  // Studio churn. Re-posting PREVIEW_BOOT on every selection change,
  // workspace-tab switch and session edit does not work: `host.start()` is
  // not idempotent (preview.tsx tears the runtime down and back up) AND the
  // fresh-start flag is consumed on the first boot, so any
  // re-post dumped a running game back onto the Start menu (the classic
  // "hit New Game, get in, bounced back to New Game"). The earlier
  // `assetSources` fix was the same class of bug; this generalizes it.
  //
  // The Preview is "play the game" — an isolated boot like Unreal PIE. The
  // Layout/Spatial viewports are where edits show live; re-launch the Preview
  // to pick up edits. So every boot-payload value is read IMPERATIVELY here,
  // and the only triggers are the preview opening and a project loading.
  useEffect(() => {
    if (!isPreviewRunning || !previewWindow || previewWindow.closed) {
      return;
    }
    const { session: currentSession } = projectStore.getState();
    if (!currentSession) {
      return;
    }
    const shell = shellStore.getState();
    const snapshot: AuthoringContextSnapshot = {
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      activeDesignWorkspaceKind: shell.activeDesignWorkspaceKind,
      activeStoryWorkspaceKind: shell.activeStoryWorkspaceKind,
      activeRenderWorkspaceKind: shell.activeRenderWorkspaceKind,
      activePublishWorkspaceKind: shell.activePublishWorkspaceKind,
      activeRegionId: shell.activeRegionId,
      activeEnvironmentId: shell.activeEnvironmentId,
      activeWorkspaceId: shell.activeWorkspaceId,
      selectedEntityIds: shell.selection.entityIds
    };
    const currentInstalledPluginIds =
      currentSession.gameProject.pluginConfigurations.map(
        (configuration) => configuration.pluginId
      );
    void postPreviewBootMessage(
      previewWindow,
      currentSession,
      snapshot,
      assetSourceStore.getState().sources,
      currentInstalledPluginIds
    ).then((result) => {
      if (!result.ok) {
        setPreviewBootError({ message: result.message, detail: result.detail });
      }
    });
    // Triggers ONLY: the preview opening, and a project first loading
    // (`hasSession` flips false->true once). Selection, tab switches, and
    // content edits deliberately do NOT reboot a running preview.
  }, [isPreviewRunning, previewWindow, hasSession]);

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
  // Studio EDITS this value, it does not resolve it. `resolveSugarLangTargetLanguage`
  // answers a runtime question -- "which language is this player learning?" --
  // and throws when there is no answer, which is correct for the runtime and
  // wrong here: a brand-new project has no language yet, and the author needs
  // Studio to come up so they can go set one. Read the config field directly.
  const sugarlangTargetLanguage = useMemo(() => {
    const entry = pluginConfigurations.find(
      (configuration) => configuration.pluginId === "sugarlang"
    );
    const configured = (
      entry?.config as { targetLanguage?: unknown } | undefined
    )?.targetLanguage;
    return typeof configured === "string" && configured.trim().length > 0
      ? configured.trim().toLowerCase()
      : "";
  }, [pluginConfigurations]);
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
      // Bake the collider's localBounds in-memory from the imported bytes
      // (Box3.setFromObject), never re-reading the just-written file --
      // FSAccess intermittently returns null right after a write. io set
      // the kind-aware shape; "none" colliders need no bounds.
      let importedAsset = result.assetDefinition;
      if (
        importedAsset.collider &&
        importedAsset.collider.shape !== "none" &&
        result.sourceBuffer
      ) {
        try {
          const localBounds = await computeAssetColliderBounds(
            result.sourceBuffer
          );
          if (localBounds) {
            importedAsset = {
              ...importedAsset,
              collider: { ...importedAsset.collider, localBounds }
            };
          }
        } catch (error) {
          console.warn("[collider-bounds] import bake failed", error);
        }
      }
      nextSession = addAssetDefinitionToSession(nextSession, importedAsset);
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

  // Assets library modal (Game > Libraries > Assets): when opened
  // from a placed instance's "Edit definition", preselect that asset.
  const [assetsLibraryPreselectId, setAssetsLibraryPreselectId] = useState<
    string | null
  >(null);

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

  // Studio-side Character Wizard services: io, the solver worker and
  // the vendored CC0 clips, behind the workspaces-facing interface.
  // Definitions register on the session here (same shape as the import
  // handlers above); the workspace binds slots via its own update
  // command.
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
        // Edit-in-place rewrites asset files under the same paths, so
        // publish the written bytes directly: re-reading a just-written
        // file intermittently returns null from FSAccess, which nukes
        // the blob URL.
        publishAssetSource: (relativeAssetPath, blob) =>
          assetSourceStore.getState().setSource(relativeAssetPath, blob)
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

  const handleImportAnimationLibrary = useCallback(async () => {
    const {
      handle,
      descriptor,
      session: currentSession
    } = projectStore.getState();
    if (!handle || !descriptor || !currentSession) return null;
    const fileHandle = await pickFile({
      types: [
        {
          description: "Blender GLB",
          accept: { "model/gltf-binary": [".glb"] }
        }
      ]
    });
    const file = await fileHandle.getFile();
    try {
      const result = await importAnimationLibraryFromGlbFile(file, {
        projectHandle: handle,
        descriptor,
        projectId: currentSession.gameProject.identity.id
      });
      if (result.warnings.length > 0) {
        console.warn("[animation-library] Import warnings:", result.warnings);
      }
      const { session: latestSession } = projectStore.getState();
      if (!latestSession) return null;
      let next = latestSession;
      for (const definition of result.definitions) {
        next = addAnimationLibraryDefinitionToSession(next, definition);
      }
      for (const { relativeAssetPath, blob } of result.writtenAssets) {
        assetSourceStore.getState().setSource(relativeAssetPath, blob);
      }
      projectStore.getState().updateSession(next);
      return result.definitions;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      window.alert(
        error instanceof Error
          ? error.message
          : `Animation import failed: ${String(error)}`
      );
      return null;
    }
  }, []);

  const handleUpdateAnimationLibraryDefinition = useCallback(
    (definitionId: string, displayName: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      projectStore.getState().updateSession(
        updateAnimationLibraryDefinitionInSession(
          currentSession,
          definitionId,
          {
            displayName
          }
        )
      );
    },
    []
  );

  const handleRemoveAnimationLibraryDefinition = useCallback(
    (definitionId: string) => {
      const { session: currentSession } = projectStore.getState();
      if (!currentSession) return;
      if (!window.confirm("Remove this animation library from the project?"))
        return;
      projectStore
        .getState()
        .updateSession(
          removeAnimationLibraryDefinitionFromSession(
            currentSession,
            definitionId
          )
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

  // Project music slots.
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
    const relativeAssetPath = definition.source.relativeAssetPath;
    // Prefer the asset-source blob -- the same source the renderer reads,
    // and reliable. The raw directory-handle read (readMaskFile)
    // intermittently returns null for files that DO exist (a
    // FileSystemAccess handle-staleness quirk; the asset-source map reads
    // the same file fine). Fall back to it only if there is no blob yet.
    let result: ImageData | null = null;
    const blobUrl = assetSourceStore.getState().sources[relativeAssetPath];
    if (blobUrl) {
      try {
        const blob = await (await fetch(blobUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context2d = canvas.getContext("2d", { willReadFrequently: true });
        if (context2d && bitmap.width > 0 && bitmap.height > 0) {
          context2d.drawImage(bitmap, 0, 0);
          result = context2d.getImageData(0, 0, bitmap.width, bitmap.height);
        }
        bitmap.close();
      } catch {
        result = null;
      }
    }
    if (!result) {
      result = await readMaskFile(handle, relativeAssetPath);
    }
    return result;
  }, []);

  // Painted-mask preview cache: live pixels behind the inspector
  // thumbnails. Filled lazily from disk, updated on every stroke/fill
  // commit via handleWriteMaskTexture.
  const paintedMaskPreviewCanvases = useRef(
    new Map<string, HTMLCanvasElement>()
  );
  const paintedMaskPreviewLoads = useRef(new Set<string>());
  const [paintedMaskPreviewVersion, setPaintedMaskPreviewVersion] = useState(0);

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
        // The paint-UV bake is geometry-neutral: it appends a uv1 channel
        // and vertex positions don't move, so the collider's localBounds
        // stay valid and need no rebake here. Origin correction below is
        // the opposite case -- it does shift geometry.
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

  // #358 -- re-pivot an imported asset's GLB to bottom-center so the move
  // gizmo sits on it. Same read -> transform -> write-back -> reload glue
  // as handleGenerateAssetPaintUvs. Manual, per-asset (Auto Correct
  // Origin button in the asset detail panel), not automatic on import.
  const handleCorrectAssetOrigin = useCallback(
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
        const result = await correctAssetOriginToBottomCenter(
          await blob.arrayBuffer()
        );
        if (!result.changed) {
          window.alert(
            "This asset's origin is already at its bottom-center; nothing to correct."
          );
          return;
        }
        await writeBlobFile(
          handle,
          pathSegments,
          new Blob([result.glb], { type: "model/gltf-binary" })
        );
        // Origin correction shifted geometry relative to the origin, so
        // the collider's localBounds are now stale; recompute from the
        // in-memory corrected GLB and patch the definition.
        if (definition.collider && definition.collider.shape !== "none") {
          try {
            const localBounds = await computeAssetColliderBounds(result.glb);
            const { session: latestSession } = projectStore.getState();
            if (localBounds && latestSession) {
              projectStore
                .getState()
                .updateSession(
                  updateAssetDefinitionInSession(
                    latestSession,
                    assetDefinitionId,
                    { collider: { ...definition.collider, localBounds } }
                  )
                );
            }
          } catch (error) {
            console.warn(
              "[collider-bounds] origin-correct rebake failed",
              error
            );
          }
        }
        // Same ordering as paint-UV regen: drop the renderables first so
        // the refreshPaths tick re-schedules their loads from the
        // rewritten file.
        workspaceViewportRef.current?.reloadAssetRenderables?.(
          assetDefinitionId
        );
        await assetSourceStore
          .getState()
          .refreshPaths([definition.source.relativeAssetPath]);
      } catch (error) {
        console.error("[origin-correct] correction failed", error);
        window.alert(
          `Origin correction failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    []
  );

  // Set an asset's DEFINITION collider shape (the type-level
  // default every placed / scattered instance inherits). "none" is the
  // walk-through decor answer for scattered foliage. Switching to a solid
  // shape bakes bounds from the GLB (reusing any already-baked bounds).
  const handleSetAssetColliderShape = useCallback(
    async (assetDefinitionId: string, shape: AssetColliderShape) => {
      const { session } = projectStore.getState();
      if (!session) {
        return;
      }
      const definition = getAssetDefinition(
        session.contentLibrary,
        assetDefinitionId
      );
      if (!definition) {
        return;
      }
      const current = definition.collider ?? null;

      if (shape === "none") {
        projectStore.getState().updateSession(
          updateAssetDefinitionInSession(session, assetDefinitionId, {
            collider: {
              shape: "none",
              localBounds: current?.localBounds ?? null
            }
          })
        );
        return;
      }

      // Solid shape needs local bounds; reuse the baked ones or measure the
      // GLB (same read as the origin bake). "none"-default foliage has none.
      let localBounds = current?.localBounds ?? null;
      if (!localBounds) {
        const { handle } = projectStore.getState();
        if (handle) {
          const pathSegments = definition.source.relativeAssetPath
            .split("/")
            .filter(Boolean);
          const blob = await readBlobFile(handle, ...pathSegments);
          if (blob) {
            try {
              localBounds = await computeAssetColliderBounds(
                await blob.arrayBuffer()
              );
            } catch (error) {
              console.warn("[collider-bounds] shape-change bake failed", error);
            }
          }
        }
      }
      const { session: latest } = projectStore.getState();
      if (!latest) {
        return;
      }
      projectStore.getState().updateSession(
        updateAssetDefinitionInSession(latest, assetDefinitionId, {
          collider: { shape, localBounds }
        })
      );
    },
    []
  );

  // Bake the navmeshes this region needs: its own, plus one for each Scene
  // whose composition actually changes what blocks movement.
  //
  // [LAW:one-source-of-truth] A navmesh is DERIVED from a composition, so
  // there is one artifact per composition that differs -- decided by the
  // input hash, not by an author remembering which Scene they had open.
  // Baking whatever Scene happened to be selected is what made a region's
  // single artifact silently belong to the wrong Scene.
  const handleBakeNavMesh = useCallback(async () => {
    const { session, handle } = projectStore.getState();
    if (!session || !handle) {
      return;
    }
    const region = getActiveRegion(session);
    if (!region) {
      return;
    }

    const shared = {
      region,
      contentLibrary: session.contentLibrary,
      playerDefinition: getPlayerDefinition(session),
      itemDefinitions: getAllItemDefinitions(session),
      npcDefinitions: getAllNPCDefinitions(session)
    };

    /** Bake one composition and write its artifact, or null if there is
     *  nothing walkable to bake. */
    const bakeComposition = async (
      activeScene: Scene | null,
      assetPath: string
    ) => {
      const input = buildRegionNavMeshInput({ ...shared, activeScene });
      const bytes = await bakeNavMesh(input);
      if (!bytes) return null;
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream"
      });
      await writeBlobFile(handle, assetPath.split("/"), blob);
      // Publish the in-memory blob so the runtime resolves it without a
      // read-after-write (the known FSAccess flake).
      assetSourceStore.getState().setSource(assetPath, blob);
      return {
        assetPath,
        inputHash: computeNavMeshInputHash(input),
        agentRadius: input.agentRadius
      };
    };

    // The region first: baked with NO Scene, so it is the free-roam mesh
    // and the default every Scene inherits.
    // Under assets/ so the deploy workflow ships it (it copies only assets/)
    // and it matches the file-backed-asset convention (assets/thumbnails, etc.).
    const regionArtifact = await bakeComposition(
      null,
      `assets/navmesh/${region.identity.id}.navmesh.bin`
    );
    if (!regionArtifact) {
      window.alert(
        "Draw a nav-bounds volume over the walkable ground first, then bake."
      );
      return;
    }
    dispatchCommand({
      kind: "SetRegionNavMesh",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: {
        subjectKind: "region-document",
        subjectId: region.identity.id
      },
      payload: { navMesh: regionArtifact }
    });

    // Then every Scene that happens here. A Scene whose composed input
    // hashes the same as the region's changes nothing about collision, so
    // it owns no artifact and inherits -- and any it owned before is
    // cleared, or it would keep pathing against a composition that no
    // longer differs.
    for (const scene of getAllScenes(
      getAllEpisodes(session.gameProject.seasons)
    )) {
      if (scene.regionId !== region.identity.id) continue;
      const sceneInput = buildRegionNavMeshInput({
        ...shared,
        activeScene: scene
      });
      const differs =
        computeNavMeshInputHash(sceneInput) !== regionArtifact.inputHash;
      const artifact = differs
        ? await bakeComposition(
            scene,
            `assets/navmesh/${region.identity.id}.${scene.sceneId}.navmesh.bin`
          )
        : null;
      dispatchCommand({
        kind: "SetSceneNavMesh",
        target: {
          aggregateKind: "game-project",
          aggregateId: session.gameProject.identity.id
        },
        subject: { subjectKind: "scene", subjectId: scene.sceneId },
        payload: { sceneId: scene.sceneId, navMesh: artifact }
      });
    }
  }, []);

  // Idempotent paint-UV ensure: generate only when the asset
  // doesn't already have them. Wired into both the Surface Brush's
  // first-touch setup and the Open-in-Studio entry so painting always
  // has a paint channel without a manual step.
  const handleEnsureAssetPaintUvs = useCallback(
    async (assetDefinitionId: string) => {
      if (workspaceViewportRef.current?.assetHasPaintUvs?.(assetDefinitionId)) {
        return;
      }
      await handleGenerateAssetPaintUvs(assetDefinitionId);
    },
    [handleGenerateAssetPaintUvs]
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
      // Publish the just-painted pixels to the renderer DIRECTLY from
      // memory instead of re-reading the file off the directory handle:
      // that read transiently returns null for a just-written file, which
      // left the mask texture blank on reload (the paint-persist bug).
      const pngBlob = await new Promise<Blob | null>((resolve) =>
        previewCanvas.toBlob((blob) => resolve(blob), "image/png")
      );
      if (pngBlob) {
        assetSourceStore
          .getState()
          .setSource(definition.source.relativeAssetPath, pngBlob);
      } else {
        await assetSourceStore
          .getState()
          .refreshPaths([definition.source.relativeAssetPath]);
      }
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
  // The mounted WorkspaceViewport instance. Paint-UV baking asks it to
  // reload an asset's renderables after the source GLB is rewritten.
  const workspaceViewportRef = useRef<WorkspaceViewport | null>(null);

  // --- Active region remains shell/project truth; the authoring viewport now
  // observes it directly via shell-store projection instead of a React effect.
  const activeRegion = session ? getActiveRegion(session) : null;

  // Navmesh staleness: re-derive the bake input hash and
  // compare to the baked one; a collider/nav-volume edit postdating the bake
  // flips this true (drives the "rebake" warning in the Spatial workspace).
  // Deps are the ACTUAL hash inputs (region + library + scene + player), not
  // `session` -- session identity changes on EVERY command, which made this
  // re-resolve all scene objects on unrelated edits (mini-review r3).
  const staleContentLibrary = session?.contentLibrary ?? null;
  const staleActiveScene = session ? getActiveScene(session) : null;
  const stalePlayerDefinition = session ? getPlayerDefinition(session) : null;
  const navMeshStale = useMemo(() => {
    if (!session || !activeRegion?.navMesh || !staleContentLibrary) {
      return false;
    }
    // Item/NPC definitions never contribute colliders (agents have null
    // colliders), so they aren't recompute triggers -- read them lazily.
    const input = buildRegionNavMeshInput({
      region: activeRegion,
      contentLibrary: staleContentLibrary,
      playerDefinition: stalePlayerDefinition,
      itemDefinitions: getAllItemDefinitions(session),
      npcDefinitions: getAllNPCDefinitions(session),
      activeScene: staleActiveScene
    });
    return computeNavMeshInputHash(input) !== activeRegion.navMesh.inputHash;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeRegion,
    staleContentLibrary,
    staleActiveScene,
    stalePlayerDefinition
  ]);

  // --- Surface Studio ---
  const [surfaceStudioTarget, setSurfaceStudioTarget] =
    useState<SurfaceStudioTarget | null>(null);
  // Transient progress toast -- e.g. while the scene reloads
  // after the Surface Studio closes, so it doesn't read as a hang.
  const [busyToast, setBusyToast] = useState<string | null>(null);
  useEffect(() => {
    if (!busyToast) {
      return;
    }
    // Safety dismiss so a missed settle signal can't strand the toast.
    const timeout = setTimeout(() => setBusyToast(null), 12000);
    return () => clearTimeout(timeout);
  }, [busyToast]);

  // Backfill collider localBounds for projects created before colliders
  // existed. The domain normalize sets the SHAPE on load; bounds need the
  // GLB, so fill them here, once per opened project (they persist after
  // save). Best-effort and sequential; skips "none" and already-baked.
  // Keyed on the project identity (not `session`) so an edit doesn't re-run
  // it; reads the LATEST session from the store to dodge stale closures.
  useEffect(() => {
    const projectId = session?.gameProject.identity.id;
    if (!projectId || !projectHandle) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const { session: current, handle } = projectStore.getState();
      if (!current || !handle) {
        return;
      }
      const pending = assetDefinitionsNeedingColliderBake(
        current.contentLibrary
      );
      for (const { definition: def } of pending) {
        if (cancelled) {
          return;
        }
        try {
          const pathSegments = def.source.relativeAssetPath
            .split("/")
            .filter(Boolean);
          const blob = await readBlobFile(handle, ...pathSegments);
          if (!blob || cancelled) {
            continue;
          }
          const localBounds = await computeAssetColliderBounds(
            await blob.arrayBuffer()
          );
          if (!localBounds || cancelled) {
            continue;
          }
          const { session: latest } = projectStore.getState();
          const target = latest
            ? getAssetDefinition(latest.contentLibrary, def.definitionId)
            : null;
          // Re-check through the same rule that selected it: the collider
          // may have been edited while the GLB was being read.
          const recheck = target ? classifyAssetColliderBake(target) : null;
          if (!latest || recheck?.kind !== "pending") {
            continue;
          }
          projectStore.getState().updateSession(
            updateAssetDefinitionInSession(latest, def.definitionId, {
              collider: { ...recheck.collider, localBounds }
            })
          );
        } catch (error) {
          console.warn(
            "[collider-bounds] backfill failed",
            def.definitionId,
            error
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.gameProject.identity.id, projectHandle]);
  const surfaceStudioSurface = useMemo<Surface<"universal"> | null>(() => {
    if (!session || !surfaceStudioTarget) {
      return null;
    }
    const region = getActiveRegion(session);
    if (!region) {
      return null;
    }
    const overlay = sceneOverlayForRegion(
      getActiveScene(session),
      region.identity.id
    );
    const instance =
      region.placedAssets.find(
        (asset) => asset.instanceId === surfaceStudioTarget.instanceId
      ) ??
      overlay?.placedAssets.find(
        (asset) => asset.instanceId === surfaceStudioTarget.instanceId
      ) ??
      null;
    const override =
      instance?.surfaceSlotOverrides?.find(
        (candidate) => candidate.slotName === surfaceStudioTarget.slotName
      )?.surface ?? null;
    const assetDefinition = getAssetDefinition(
      session.contentLibrary,
      surfaceStudioTarget.assetDefinitionId
    );
    const slotBinding =
      assetDefinition?.surfaceSlots.find(
        (candidate) => candidate.slotName === surfaceStudioTarget.slotName
      )?.surface ?? null;
    const binding = override ?? slotBinding;
    if (binding?.kind === "inline") {
      return binding.surface as Surface<"universal">;
    }
    if (binding?.kind === "reference") {
      const definition = getSurfaceDefinition(
        session.contentLibrary,
        binding.surfaceDefinitionId
      );
      if (definition) {
        return cloneSurface(definition.surface) as Surface<"universal">;
      }
    }
    return createDefaultSurface();
  }, [session, surfaceStudioTarget]);

  const handleSurfaceStudioChange = useCallback(
    (nextSurface: Surface<"universal">) => {
      const currentSession = projectStore.getState().session;
      if (!surfaceStudioTarget || !currentSession) {
        return;
      }
      const region = getActiveRegion(currentSession);
      if (!region) {
        return;
      }
      dispatchCommand({
        kind: "SetPlacedAssetSurfaceSlotOverride",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: {
          subjectKind: "placed-asset",
          subjectId: surfaceStudioTarget.instanceId
        },
        payload: {
          instanceId: surfaceStudioTarget.instanceId,
          slotName: surfaceStudioTarget.slotName,
          surface: { kind: "inline", surface: nextSurface },
          scope: surfaceStudioTarget.scope
        }
      });
    },
    [surfaceStudioTarget]
  );

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
    activeSelectionId,
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
    onToggleSelect: (id) => shellStore.getState().toggleSelection(id),
    onCommand: dispatchCommand,
    navigationTarget: workspaceNavigationTarget,
    onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null),
    onNavigateToTarget: handleWorkspaceNavigation,
    onImportAsset: handleImportAsset,
    onGenerateAssetPaintUvs: handleGenerateAssetPaintUvs,
    onBakeNavMesh: handleBakeNavMesh,
    navMeshStale,
    onOpenSurfaceStudio: async (target) => {
      // Ensure paint UVs exist BEFORE the Studio loads the asset (it
      // loads its own GLB copy, so the bake must land first).
      await handleEnsureAssetPaintUvs(target.assetDefinitionId);
      setSurfaceStudioTarget(target);
    },
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
          activeScene: session ? getActiveScene(session) : null,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand
        }
      )
  });

  const designView = useDesignProductModeView({
    activeDesignKind,
    gameProjectId: session?.gameProject.identity.id ?? null,
    gameProject: session?.gameProject ?? null,
    regions: regionDocuments,
    episodes: getAllEpisodes(session?.gameProject.seasons ?? []),
    soundCueDefinitions,
    creditsDefinition: session?.gameProject.creditsDefinition ?? {
      sections: []
    },
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
    animationLibraryDefinitions,
    designPreviewStore,
    onSelectKind: (kind) =>
      shellStore.getState().setActiveDesignWorkspaceKind(kind),
    onCommand: dispatchCommand,
    onImportCharacterModelDefinition: handleImportCharacterModelDefinition,
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
          activeScene: session ? getActiveScene(session) : null,
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
          activeScene: session ? getActiveScene(session) : null,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand,
          selectedQuest,
          updateQuest,
          selectedQuestNode
        }
      ),
    renderItemInspectorSections: ({ selectedItem }) =>
      renderPluginSectionGroup(
        pluginShellContributions.designSections.filter(
          (section) => section.workspaceKind === "items"
        ),
        {
          workspaceKind: "items",
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          regions: regionDocuments,
          activeRegion,
          activeScene: session ? getActiveScene(session) : null,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand,
          selectedItem
        }
      ),
    renderDialogueInspectorSections: ({
      selectedDialogue,
      selectedDialogueNode,
      updateDialogueNode
    }) =>
      renderPluginSectionGroup(
        pluginShellContributions.designSections.filter(
          (section) => section.workspaceKind === "dialogues"
        ),
        {
          workspaceKind: "dialogues",
          gameProjectId: session?.gameProject.identity.id ?? null,
          gameProject: session?.gameProject ?? null,
          pluginConfigurations,
          regions: regionDocuments,
          activeRegion,
          activeScene: session ? getActiveScene(session) : null,
          targetLanguage: sugarlangTargetLanguage,
          onCommand: dispatchCommand,
          selectedDialogue,
          selectedDialogueNode,
          updateDialogueNode
        }
      )
  });
  const storyView = useStoryProductModeView({
    activeStoryKind,
    onSelectKind: (kind) =>
      shellStore.getState().setActiveStoryWorkspaceKind(kind),
    // The Episode holding the Scene being worked in -- the graph draws the
    // chapter the author is actually inside, not whichever came first.
    graphEpisode: session
      ? (getAllEpisodes(session.gameProject.seasons).find((episode) =>
          episode.scenes.some(
            (scene) => scene.sceneId === session.activeSceneId
          )
        ) ??
        getAllEpisodes(session.gameProject.seasons)[0] ??
        null)
      : null,
    structurePanel: session ? (
      <StoryStructureView
        seasons={session.gameProject.seasons}
        activeSceneId={session.activeSceneId}
        questDefinitions={getAllQuestDefinitions(session)}
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
        episodeEndRouting={session.gameProject.episodeEndRouting}
        onUpdateEpisodeEndRouting={handleUpdateEpisodeEndRouting}
        onAddEpisode={handleAddEpisode}
        onUpdateEpisode={handleUpdateEpisode}
        onDeleteEpisode={handleDeleteEpisode}
        onReorderEpisode={handleReorderEpisode}
        onMoveSceneToEpisode={handleMoveSceneToEpisode}
        onMoveQuestToScene={handleMoveQuestToScene}
        onAddSeason={handleAddSeason}
        onUpdateSeason={handleUpdateSeason}
        onDeleteSeason={handleDeleteSeason}
        onReorderSeason={handleReorderSeason}
        onMoveEpisodeToSeason={handleMoveEpisodeToSeason}
      />
    ) : null,
    composerPanel: session ? (
      <SceneComposerPanel
        scenes={getAllScenes(getAllEpisodes(session.gameProject.seasons))}
        selectedScene={getActiveScene(session)}
        region={
          session.regions.get(getActiveScene(session)?.regionId ?? "") ?? null
        }
        // Only the Scene changes. The composer's region is derived from
        // it in `selectViewportProjection`, so writing the shell's active
        // region here would be a second copy of an answer the Scene
        // already holds -- and would move Build's region under the author.
        onSelectScene={handleSceneSelect}
        onPromotePresence={(presenceId) => {
          const scene = getActiveScene(session);
          if (!scene) return;
          dispatchCommand({
            kind: "PromotePresenceToRegion",
            target: {
              aggregateKind: "game-project",
              aggregateId: session.gameProject.identity.id
            },
            subject: { subjectKind: "scene", subjectId: scene.sceneId },
            payload: { sceneId: scene.sceneId, presenceId }
          });
        }}
        onSetSuppressed={(regionOwnedId, suppressed) => {
          const scene = getActiveScene(session);
          if (!scene) return;
          dispatchCommand({
            kind: "SetSceneSuppression",
            target: {
              aggregateKind: "game-project",
              aggregateId: session.gameProject.identity.id
            },
            subject: { subjectKind: "scene", subjectId: scene.sceneId },
            payload: { sceneId: scene.sceneId, regionOwnedId, suppressed }
          });
        }}
      />
    ) : null,
    quests: {
      isActive: false,
      gameProjectId: session?.gameProject.identity.id ?? null,
      questDefinitions: session ? getAllQuestDefinitions(session) : [],
      regions: regionDocuments,
      episodes: getAllEpisodes(session?.gameProject.seasons ?? []),
      soundCueDefinitions,
      dialogueDefinitions: session?.gameProject.dialogueDefinitions ?? [],
      itemDefinitions: session?.gameProject.itemDefinitions ?? [],
      npcDefinitions: session?.gameProject.npcDefinitions ?? [],
      spellDefinitions: session?.gameProject.spellDefinitions ?? [],
      onCommand: dispatchCommand,
      navigationTarget: workspaceNavigationTarget,
      onConsumeNavigationTarget: () => setWorkspaceNavigationTarget(null),
      onNavigateToTarget: handleWorkspaceNavigation
    },
    dialogues: {
      isActive: false,
      gameProjectId: session?.gameProject.identity.id ?? null,
      dialogueDefinitions: session?.gameProject.dialogueDefinitions ?? [],
      itemDefinitions: session?.gameProject.itemDefinitions ?? [],
      npcDefinitions: session?.gameProject.npcDefinitions ?? [],
      spellDefinitions: session?.gameProject.spellDefinitions ?? [],
      onCommand: dispatchCommand
    }
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
  // Gather plugin-contributed Publish workspaces (e.g.
  // SugarDeploy's Provision / Release / Deploy). Two halves: shell
  // contributions provide labels + icons + sort order; plugin
  // workspace definitions provide createWorkspaceView. We zip them
  // by workspaceKind, render each contribution's view, and pass the
  // sorted result into the Publish productmode hook.
  const pluginPublishWorkspaceItems = useMemo(() => {
    const publishWorkspaceDefinitions = studioPluginWorkspaceDefinitions.filter(
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
    // Skip only if the active plugin view already owns the center panel.
    // Auto-mounted schema-only workspaces have no centerPanel, so design
    // sections still need to render here even when activePluginView exists.
    if (activePluginView?.centerPanel) {
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
              Target language: {sugarlangTargetLanguage || "(not set)"}
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
            activeScene: session ? getActiveScene(session) : null,
            targetLanguage: sugarlangTargetLanguage,
            onCommand: dispatchCommand
          })}
        </Stack>
      ),
      viewportOverlay: null
    };
  }, [
    activeDesignKind,
    activePluginView,
    activeRegion,
    pluginConfigurations,
    pluginShellContributions.designSections,
    regionDocuments,
    renderablePluginWorkspaceItems,
    session?.activeSceneId,
    session?.gameProject,
    sugarlangTargetLanguage
  ]);

  // When activePluginView is an auto-mounted schema-only workspace (leftPanel
  // only, no centerPanel), supplement with genericPluginView's centerPanel so
  // design sections appear alongside the settings panel.
  const activeDesignPanels = (() => {
    const base = activePluginView ?? genericPluginView ?? designView;
    if (
      activePluginView &&
      !activePluginView.centerPanel &&
      genericPluginView?.centerPanel
    ) {
      return {
        ...activePluginView,
        centerPanel: genericPluginView.centerPanel
      };
    }
    return base;
  })();
  const shouldRenderSharedViewport = shouldShowSharedViewport({
    phase,
    activeProductMode,
    activeBuildKind,
    activeDesignKind,
    buildCenterPanelVisible: Boolean(buildView.centerPanel),
    designCenterPanelVisible: Boolean(activeDesignPanels.centerPanel),
    activeStoryKind
  });

  useEffect(() => {
    if (!shouldRenderSharedViewport) {
      return;
    }
    // The Surface Studio mounts its own focused render
    // view for the selected asset; unmount the main scene viewport
    // while it is open so only one render loop runs on the engine.
    if (surfaceStudioTarget) {
      return;
    }
    if (!viewportRef.current) {
      return;
    }
    const viewportContainer = viewportRef.current;
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
            ensureAssetPaintUvs: handleEnsureAssetPaintUvs,
            onRenderablesSettled: () => setBusyToast(null),
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
    viewport.mount(viewportContainer);
    workspaceViewportRef.current = viewport;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        viewport.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(viewportContainer);

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
    shouldRenderSharedViewport,
    // Unmount/remount the main viewport as the Surface Studio opens/closes.
    surfaceStudioTarget
  ]);

  const handleUndo = useCallback(() => {
    const { session: s } = projectStore.getState();
    if (!s) return;
    projectStore.getState().updateSession(undoSession(s));
  }, []);

  const handleRedo = useCallback(() => {
    const { session: s } = projectStore.getState();
    if (!s) return;
    projectStore.getState().updateSession(redoSession(s));
  }, []);

  // Undo and redo from the keyboard, anywhere in Studio.
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const action = historyShortcut(event);
      if (!action) return;
      // The browser would otherwise run its own undo over the top of ours.
      event.preventDefault();
      // A drag in progress is holding the transforms it read at pointer-down.
      // Undoing under it would leave those stale values to be written back on
      // release, so the drag is abandoned first.
      cancelActiveViewportGesture();
      if (action === "undo") handleUndo();
      else handleRedo();
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [handleUndo, handleRedo]);

  /**
   * What the active region has too many of. Null when it is within budget,
   * which is almost always -- this is a warning an author meets once, when
   * they have gone far enough to feel it.
   */
  const lightBudgetWarning = useMemo(() => {
    if (phase !== "active" || !session) return null;
    const contents = getActiveRegionContents(session);
    return contents ? placedLightBudgetWarning(contents.placedLights) : null;
  }, [phase, session]);

  const statusMessage = useMemo(() => {
    if (phase === "no-project") return "No project open";
    if (phase === "error") return "Error loading project";
    // A budget the author has exceeded outranks "ready", which is true but
    // not what they need to know. Whether the project is saved is true either
    // way, so it rides along rather than being displaced.
    const dirty = isDirty ? " (unsaved)" : "";
    const state = lightBudgetWarning ?? `${activeProductMode} workspace ready`;
    return `${state}${dirty}`;
  }, [phase, isDirty, activeProductMode, lightBudgetWarning]);

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
      <WorldFlagRegistryProvider registry={worldFlagRegistry}>
        <ProjectManagerDialog
          opened={phase === "no-project"}
          onOpen={handleOpenProject}
          onCreate={handleCreateProject}
          reopenProjectName={reopenable?.name ?? null}
          onReopen={() => {
            void (async () => {
              if (!reopenable) return;
              // requestPermission only prompts inside a user gesture, which
              // this click is.
              const allowed = await requestProjectDirectoryAccess(
                reopenable.handle
              );
              if (!allowed) return;
              const opened = await reopenRememberedProject(reopenable.handle);
              if (!opened) setReopenable(null);
            })();
          }}
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
          animationLibraryDefinitions={animationLibraryDefinitions}
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
            session
              ? assetDefinitionHasReferences(session, definitionId)
              : false
          }
          assetsPreselectId={assetsLibraryPreselectId}
          onImportAssetDefinition={handleImportAsset}
          onUpdateAssetDefinition={handleUpdateAssetDefinition}
          onRemoveAssetDefinition={handleRemoveAssetDefinition}
          onCorrectAssetOrigin={handleCorrectAssetOrigin}
          onSetAssetColliderShape={handleSetAssetColliderShape}
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
          onImportAnimationLibrary={handleImportAnimationLibrary}
          onUpdateAudioClipDefinition={handleUpdateAudioClipDefinition}
          onUpdateAnimationLibraryDefinition={
            handleUpdateAnimationLibraryDefinition
          }
          onRemoveMaterialDefinition={handleRemoveMaterialDefinition}
          onRemoveAudioClipDefinition={handleRemoveAudioClipDefinition}
          onRemoveAnimationLibraryDefinition={
            handleRemoveAnimationLibraryDefinition
          }
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
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
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
                          <Badge
                            key={capabilityId}
                            variant="light"
                            color="blue"
                          >
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
                          {(plugin.shell.designWorkspaces ?? []).map(
                            (entry) => (
                              <Text
                                key={entry.workspaceKind}
                                size="xs"
                                c="var(--sm-color-subtext)"
                              >
                                Design Workspace: {entry.label}
                              </Text>
                            )
                          )}
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
              <Text
                size="xs"
                fw={600}
                tt="uppercase"
                c="var(--sm-color-subtext)"
              >
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
                            "&:hover": {
                              background: "var(--sm-active-bg-hover)"
                            }
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
                      {/* Studio reopens the last project on its own now, so
                        the welcome dialog no longer appears -- this is the
                        way to switch to a different one. */}
                      <Menu.Item
                        onClick={handleOpenProject}
                        styles={{
                          item: {
                            fontSize: "var(--sm-font-size-lg)",
                            color: "var(--sm-color-text)",
                            padding: "10px 16px",
                            "&:hover": { background: "var(--sm-active-bg)" }
                          }
                        }}
                      >
                        📁 Open Game
                      </Menu.Item>
                      <Menu.Divider />
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
                      <Menu.Item
                        onClick={handleRedo}
                        disabled={redoCount === 0}
                        rightSection={
                          <Text size="xs" c="var(--sm-color-overlay0)">
                            ⇧⌘Z
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
                        ↪ Redo
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
                              shellStore
                                .getState()
                                .setActiveLibrary("materials")
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
                          <Menu.Item
                            onClick={() =>
                              shellStore
                                .getState()
                                .setActiveLibrary("animations")
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
                            Animations
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
                  {/* Scene selector (Ambient Context). Scope narrows
                    left to right: project > version > Scene >
                    workspaces. */}
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
                        🎬 {getActiveScene(session)?.displayName ?? "Scene"}
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
                      {/* One group per Episode, its Scenes in order
                        underneath. The grouping is the containment
                        made visible; authoring Episodes is story 2. */}
                      {getAllEpisodes(session.gameProject.seasons).map(
                        (episode) => (
                          <Fragment key={episode.episodeId}>
                            <Menu.Label>{episode.displayName}</Menu.Label>
                            {episode.scenes.map((scene) => (
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
                                    "&:hover": {
                                      background: "var(--sm-active-bg)"
                                    }
                                  }
                                }}
                              >
                                {scene.sceneId ===
                                getActiveScene(session)?.sceneId
                                  ? "✓ "
                                  : ""}
                                {scene.displayName}
                              </Menu.Item>
                            ))}
                          </Fragment>
                        )
                      )}
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
                  onStartPreview={() => {
                    setPreviewBootError(null);
                    handleStartPreview(
                      assetSources,
                      installedPluginIds,
                      (message, detail) =>
                        setPreviewBootError({ message, detail })
                    );
                  }}
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
                : isStory
                  ? storyView.subHeaderPanel
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
              : isStory
                ? storyView.leftPanel
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
              : isStory
                ? storyView.rightPanel
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
              severity={
                phase === "error"
                  ? "error"
                  : lightBudgetWarning
                    ? "warning"
                    : "info"
              }
              trailing={activeWorkspaceId ?? undefined}
            />
          }
          centerPanel={
            phase === "active" && isBuild && buildView.centerPanel ? (
              buildView.centerPanel
            ) : phase === "active" && isStory && storyView.centerPanel ? (
              storyView.centerPanel
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
        <SurfaceStudioModal
          opened={surfaceStudioTarget !== null}
          onClose={() => {
            // Closing remounts the scene viewport (it was unmounted while
            // the Studio owned the render) -- show progress until it
            // settles so the reload doesn't read as a hang.
            setBusyToast("Updating scene...");
            setSurfaceStudioTarget(null);
          }}
          engine={studioRenderEngine}
          session={session}
          surface={surfaceStudioSurface}
          target={surfaceStudioTarget}
          slotLabel={surfaceStudioTarget?.slotName ?? ""}
          onChangeSurface={handleSurfaceStudioChange}
          brushSettings={{
            radius: surfaceBrushSettings?.radius ?? 2,
            strength: surfaceBrushSettings?.strength ?? 0.6,
            falloff: surfaceBrushSettings?.falloff ?? 0.7,
            mode: surfaceBrushSettings?.mode ?? "paint"
          }}
          onChangeBrushSettings={(next) =>
            viewportStore.getState().setSurfaceBrushSettings({
              surfaceDefinitionId:
                surfaceBrushSettings?.surfaceDefinitionId ?? null,
              radius: next.radius,
              strength: next.strength,
              falloff: next.falloff,
              mode: next.mode
            })
          }
          readMaskTexture={handleReadMaskTexture}
          writeMaskTexture={handleWriteMaskTexture}
          getMaskPreviewCanvas={getPaintedMaskPreviewCanvas}
          maskPreviewVersion={paintedMaskPreviewVersion}
        />
        {busyToast ? <ProgressToast message={busyToast} /> : null}
        {previewBootError ? (
          <ErrorToast
            message={previewBootError.message}
            detail={previewBootError.detail}
            onDismiss={() => setPreviewBootError(null)}
          />
        ) : null}
      </WorldFlagRegistryProvider>
    </SurfaceAuthoringProvider>
  );
}
