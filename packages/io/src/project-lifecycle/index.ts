/**
 * Canonical project lifecycle: create, open, save, reload.
 *
 * Routes through File System Access API handles and canonical
 * domain documents. No separate "editor project" abstraction.
 */

import type { GameProject, RegionDocument } from "@sugarmagic/domain";
import {
  ensureDirectory,
  pickDirectory,
  readJsonFile,
  storeProjectHandle,
  writeJsonFile
} from "../fs-access";
import type { GameRootDescriptor } from "../game-root";

export interface ActiveProject {
  handle: FileSystemDirectoryHandle;
  descriptor: GameRootDescriptor;
  gameProject: GameProject;
  regions: RegionDocument[];
}

export interface CreateProjectInput {
  gameName: string;
  slug: string;
}

const PROJECT_FILE = "project.sgrmagic";
const REGIONS_DIR = "regions";

function makeEmptyProject(
  gameName: string,
  slug: string
): GameProject {
  return {
    identity: { id: slug, schema: "GameProject", version: 1 },
    displayName: gameName,
    gameRootPath: ".",
    regionRegistry: [],
    pluginConfigIds: []
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
  const project = makeEmptyProject(input.gameName, input.slug);

  await ensureDirectory(handle, REGIONS_DIR);
  await writeJsonFile(handle, [PROJECT_FILE], project);

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
    regions: []
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
    regions
  };
}

export async function saveProject(active: ActiveProject): Promise<void> {
  await writeJsonFile(active.handle, [PROJECT_FILE], active.gameProject);
  for (const region of active.regions) {
    await writeJsonFile(
      active.handle,
      [REGIONS_DIR, `${region.identity.id}.json`],
      region
    );
  }
}

export async function reloadProject(
  active: ActiveProject
): Promise<ActiveProject> {
  return loadProjectFromHandle(active.handle);
}
