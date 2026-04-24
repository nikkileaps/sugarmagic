/**
 * Canonical project lifecycle: create, open, save, reload.
 *
 * Routes through File System Access API handles and canonical
 * domain documents. No separate "editor project" abstraction.
 */

import type {
  ContentLibrarySnapshot,
  GameProject,
  RegionDocument,
  Surface,
  SurfaceBinding
} from "@sugarmagic/domain";
import {
  assertReusableSurfaceHasNoPaintedMasks,
  createDefaultGameProject,
  createDefaultRegion,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import {
  deleteFile,
  ensureDirectory,
  pickDirectory,
  readJsonFile,
  readTextFile,
  storeProjectHandle,
  writeTextFile,
  writeJsonFile
} from "../fs-access";
import type { GameRootDescriptor } from "../game-root";

export interface ActiveProject {
  handle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  gameProject: GameProject;
  contentLibrary: ContentLibrarySnapshot;
  regions: RegionDocument[];
}

export interface CreateProjectInput {
  gameName: string;
  slug: string;
}

const PROJECT_FILE = "project.sgrmagic";
const CONTENT_LIBRARY_FILE = "content-library.sgrmagic";
const REGIONS_DIR = "regions";
const DEPLOYMENT_MANIFEST_FILE = [".sugarmagic", "deployment-manifest.sgrmagic"];

export interface ManagedProjectFile {
  relativePath: string;
  content: string;
  contentType: "text" | "json";
}

interface DeploymentManifest {
  files: Array<{
    relativePath: string;
    contentHash: string;
  }>;
}

export interface SaveProjectResult {
  changedManagedFiles: string[];
  driftedManagedFiles: string[];
  writtenManagedFiles: string[];
  reconciledContentLibrary: ContentLibrarySnapshot;
  orphanedMaskPaths: string[];
}

export interface ManagedProjectFileInspectionResult {
  changedManagedFiles: string[];
  driftedManagedFiles: string[];
}

export interface PaintedMaskSaveReconciliationResult {
  contentLibrary: ContentLibrarySnapshot;
  orphanedMaskPaths: string[];
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function makeEmptyProject(
  gameName: string,
  slug: string
): GameProject {
  return createDefaultGameProject(gameName, slug);
}

function collectPaintedMaskTextureIdsFromSurface(
  surface: Surface | null | undefined,
  destination: Set<string>
): void {
  for (const layer of surface?.layers ?? []) {
    if (layer.mask.kind === "painted" && layer.mask.maskTextureId) {
      destination.add(layer.mask.maskTextureId);
    }
  }
}

function collectPaintedMaskTextureIdsFromBinding(
  binding: SurfaceBinding | null | undefined,
  destination: Set<string>
): void {
  if (binding?.kind === "inline") {
    collectPaintedMaskTextureIdsFromSurface(binding.surface, destination);
  }
}

export function reconcilePaintedMaskDefinitionsForSave(
  contentLibrary: ContentLibrarySnapshot,
  regions: RegionDocument[]
): PaintedMaskSaveReconciliationResult {
  for (const definition of contentLibrary.surfaceDefinitions ?? []) {
    assertReusableSurfaceHasNoPaintedMasks(
      definition.surface,
      `SurfaceDefinition "${definition.definitionId}"`
    );
  }

  const referencedMaskTextureIds = new Set<string>();
  for (const assetDefinition of contentLibrary.assetDefinitions) {
    for (const slot of assetDefinition.surfaceSlots) {
      collectPaintedMaskTextureIdsFromBinding(slot.surface, referencedMaskTextureIds);
    }
  }

  for (const region of regions) {
    for (const slot of region.landscape.surfaceSlots) {
      collectPaintedMaskTextureIdsFromBinding(slot.surface, referencedMaskTextureIds);
    }
  }

  const maskTextureDefinitions = contentLibrary.maskTextureDefinitions ?? [];
  const orphanedMaskPaths: string[] = [];
  const keptMaskTextureDefinitions = maskTextureDefinitions.filter((definition) => {
    const keep = referencedMaskTextureIds.has(definition.definitionId);
    if (!keep) {
      orphanedMaskPaths.push(definition.source.relativeAssetPath);
    }
    return keep;
  });

  return {
    contentLibrary:
      keptMaskTextureDefinitions.length === maskTextureDefinitions.length
        ? contentLibrary
        : {
            ...contentLibrary,
            maskTextureDefinitions: keptMaskTextureDefinitions
          },
    orphanedMaskPaths
  };
}

export async function checkDirectoryHasProject(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const existing = await readJsonFile(handle, PROJECT_FILE);
  return existing !== null;
}

export async function createProjectInDirectory(
  handle: FileSystemDirectoryHandle,
  input: CreateProjectInput
): Promise<ActiveProject> {
  const baseProject = makeEmptyProject(input.gameName, input.slug);
  const contentLibrary = createEmptyContentLibrarySnapshot(baseProject.identity.id);

  // Every new project gets a ready-to-use "Default Region" so the authoring
  // viewport opens into a real scene (landscape, environment binding, etc.)
  // rather than a null-region void. The landscape is a first-class part of
  // the region document; the Scene Explorer surfaces it alongside other
  // region content.
  // The region id is used verbatim as the filename (see
  // `${REGIONS_DIR}/${regionId}.json` below and in loadProjectFromHandle),
  // so it must be filesystem-safe. Colons / slashes / etc. get rejected by
  // the File System Access API's getFileHandle.
  const defaultRegion = createDefaultRegion({
    regionId: "default",
    displayName: "Default Region",
    defaultEnvironmentId:
      contentLibrary.environmentDefinitions[0]?.definitionId ?? null
  });
  const project: GameProject = {
    ...baseProject,
    regionRegistry: [{ regionId: defaultRegion.identity.id }]
  };

  await ensureDirectory(handle, REGIONS_DIR);
  await ensureDirectory(handle, "assets");
  await writeJsonFile(handle, [PROJECT_FILE], project);
  await writeJsonFile(handle, [CONTENT_LIBRARY_FILE], contentLibrary);
  await writeJsonFile(
    handle,
    [REGIONS_DIR, `${defaultRegion.identity.id}.json`],
    defaultRegion
  );

  await storeProjectHandle(input.slug, handle);

  return {
    handle,
    descriptor: {
      rootPath: handle.name,
      projectFileName: PROJECT_FILE,
      authoredAssetsPath: "assets",
      exportsPath: "exports",
      publishPath: "publish"
    },
    gameProject: project,
    contentLibrary,
    regions: [defaultRegion]
  };
}

export async function openProject(): Promise<ActiveProject> {
  const handle = await pickDirectory();
  return loadProjectFromHandle(handle);
}

export async function loadProjectFromHandle(
  handle: FileSystemDirectoryHandle
): Promise<ActiveProject> {
  const project = await readJsonFile<GameProject>(handle, PROJECT_FILE);
  if (!project) {
    throw new Error(
      `No ${PROJECT_FILE} found in selected directory. Is this a Sugarmagic game root?`
    );
  }

  const contentLibrary =
    (await readJsonFile<ContentLibrarySnapshot>(handle, CONTENT_LIBRARY_FILE)) ??
    createEmptyContentLibrarySnapshot(project.identity.id);

  const regions: RegionDocument[] = [];
  for (const ref of project.regionRegistry) {
    const region = await readJsonFile<RegionDocument>(
      handle,
      REGIONS_DIR,
      `${ref.regionId}.json`
    );
    if (region) {
      regions.push(region);
    }
  }

  await storeProjectHandle(project.identity.id, handle);

  return {
    handle,
    descriptor: {
      rootPath: handle.name,
      projectFileName: PROJECT_FILE,
      authoredAssetsPath: "assets",
      exportsPath: "exports",
      publishPath: "publish"
    },
    gameProject: project,
    contentLibrary,
    regions
  };
}

export async function saveProject(active: ActiveProject): Promise<void> {
  await saveProjectWithManagedFiles(active);
}

export async function inspectManagedProjectFiles(
  active: Pick<ActiveProject, "handle"> & {
    managedFiles?: ManagedProjectFile[];
  }
): Promise<ManagedProjectFileInspectionResult> {
  const managedFiles = active.managedFiles ?? [];
  if (managedFiles.length === 0) {
    return {
      changedManagedFiles: [],
      driftedManagedFiles: []
    };
  }

  const existingManifest =
    (await readJsonFile<DeploymentManifest>(
      active.handle,
      ...DEPLOYMENT_MANIFEST_FILE
    )) ?? { files: [] };
  const previousHashes = new Map(
    existingManifest.files.map((entry) => [entry.relativePath, entry.contentHash])
  );

  const changedManagedFiles: string[] = [];
  const driftedManagedFiles: string[] = [];
  for (const file of managedFiles) {
    const existingText = await readTextFile(
      active.handle,
      ...file.relativePath.split("/").filter(Boolean)
    );
    if (existingText == null) continue;

    if (existingText !== file.content) {
      changedManagedFiles.push(file.relativePath);
    }

    const previousHash = previousHashes.get(file.relativePath);
    if (!previousHash) continue;
    const existingHash = hashText(existingText);
    const nextHash = hashText(file.content);
    if (existingHash !== previousHash && existingHash !== nextHash) {
      driftedManagedFiles.push(file.relativePath);
    }
  }

  return {
    changedManagedFiles,
    driftedManagedFiles
  };
}

export async function saveProjectWithManagedFiles(
  active: ActiveProject & {
    managedFiles?: ManagedProjectFile[];
    overwriteManagedFiles?: boolean;
  }
): Promise<SaveProjectResult> {
  const reconciliation = reconcilePaintedMaskDefinitionsForSave(
    active.contentLibrary,
    active.regions
  );

  await writeJsonFile(active.handle, [PROJECT_FILE], active.gameProject);
  await writeJsonFile(
    active.handle,
    [CONTENT_LIBRARY_FILE],
    reconciliation.contentLibrary
  );
  for (const region of active.regions) {
    await writeJsonFile(
      active.handle,
      [REGIONS_DIR, `${region.identity.id}.json`],
      region
    );
  }

  const managedFiles = active.managedFiles ?? [];
  if (managedFiles.length === 0) {
    for (const relativePath of reconciliation.orphanedMaskPaths) {
      try {
        await deleteFile(active.handle, relativePath.split("/").filter(Boolean));
      } catch {
        // Missing orphaned files are already effectively reconciled.
      }
    }
    return {
      changedManagedFiles: [],
      driftedManagedFiles: [],
      writtenManagedFiles: [],
      reconciledContentLibrary: reconciliation.contentLibrary,
      orphanedMaskPaths: reconciliation.orphanedMaskPaths
    };
  }

  const inspection = await inspectManagedProjectFiles(active);

  if (
    inspection.driftedManagedFiles.length > 0 &&
    active.overwriteManagedFiles !== true
  ) {
    return {
      changedManagedFiles: inspection.changedManagedFiles,
      driftedManagedFiles: inspection.driftedManagedFiles,
      writtenManagedFiles: [],
      reconciledContentLibrary: reconciliation.contentLibrary,
      orphanedMaskPaths: reconciliation.orphanedMaskPaths
    };
  }

  const writtenManagedFiles: string[] = [];
  for (const file of managedFiles) {
    await writeTextFile(
      active.handle,
      file.relativePath.split("/").filter(Boolean),
      file.content
    );
    writtenManagedFiles.push(file.relativePath);
  }

  await ensureDirectory(active.handle, ".sugarmagic");
  await writeJsonFile(active.handle, DEPLOYMENT_MANIFEST_FILE, {
    files: managedFiles.map((file) => ({
      relativePath: file.relativePath,
      contentHash: hashText(file.content)
    }))
  } satisfies DeploymentManifest);

  for (const relativePath of reconciliation.orphanedMaskPaths) {
    try {
      await deleteFile(active.handle, relativePath.split("/").filter(Boolean));
    } catch {
      // Missing orphaned files are already effectively reconciled.
    }
  }

  return {
    changedManagedFiles: inspection.changedManagedFiles,
    driftedManagedFiles: [],
    writtenManagedFiles,
    reconciledContentLibrary: reconciliation.contentLibrary,
    orphanedMaskPaths: reconciliation.orphanedMaskPaths
  };
}

export async function reloadProject(
  active: ActiveProject
): Promise<ActiveProject> {
  return loadProjectFromHandle(active.handle);
}
