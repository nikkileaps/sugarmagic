/**
 * packages/io/src/fs-access/remembered-project.ts
 *
 * Purpose: reopen the project Studio last had open, so reloading the page
 * does not send the author back to the file picker.
 *
 * The handles themselves are already stored: `loadProjectFromHandle` puts
 * one away under the project's id on every load. Two things were missing,
 * and only those live here.
 *
 * WHICH one to reopen. The handle store is keyed by project id and holds
 * every project ever opened, with no notion of order, so the last-opened id
 * is recorded alongside it. It is a preference, not content, so it lives in
 * localStorage rather than in the project files.
 *
 * WHETHER it can be used. A stored handle is not the same as permission to
 * read it. `queryPermission` answers without a user gesture:
 *   - "granted" -- open it, no interaction at all. The common case after a
 *     page reload within the same browsing session.
 *   - "prompt"  -- the handle is good but the browser wants a gesture, so
 *     the author clicks once to bring it back.
 *   - "denied"  -- offer nothing; a button that cannot work is worse than
 *     no button.
 *
 * Exports:
 *   - rememberLastOpenedProject
 *   - recallLastOpenedProject
 *   - forgetLastOpenedProject
 *   - requestProjectDirectoryAccess
 *
 * Status: active
 */

import { loadProjectHandle } from "./index";

const LAST_OPENED_KEY = "sugarmagic:last-opened-project-id";

export type RememberedProjectAccess = "granted" | "prompt";

export interface RememberedProject {
  handle: FileSystemDirectoryHandle;
  /** Whether it can be read right now, or needs a click first. */
  access: RememberedProjectAccess;
}

/** Called once a project is open. Failing to remember must not fail the
 *  open, so this reports and carries on. */
export function rememberLastOpenedProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_OPENED_KEY, projectId);
  } catch (error) {
    console.warn(
      "[io/fs-access] could not record the open project; reopening Studio " +
        "will ask for the folder again.",
      error
    );
  }
}

export function forgetLastOpenedProject(): void {
  try {
    localStorage.removeItem(LAST_OPENED_KEY);
  } catch {
    // Nothing to do: the next boot simply offers the picker.
  }
}

/**
 * The project Studio last had open, when there is one and the browser has
 * not refused it. Null means offer the picker.
 */
export async function recallLastOpenedProject(): Promise<RememberedProject | null> {
  let projectId: string | null = null;
  try {
    projectId = localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
  if (!projectId) return null;

  let handle: FileSystemDirectoryHandle | null = null;
  try {
    handle = await loadProjectHandle(projectId);
  } catch (error) {
    console.warn("[io/fs-access] could not read the stored handle.", error);
    return null;
  }
  if (!handle) {
    // A last-opened id with no handle behind it is a dead pointer.
    forgetLastOpenedProject();
    return null;
  }

  const access = await handle.queryPermission({ mode: "readwrite" });
  if (access === "denied") {
    forgetLastOpenedProject();
    return null;
  }
  return { handle, access: access === "granted" ? "granted" : "prompt" };
}

/**
 * Ask the browser for access to a remembered directory. MUST be called
 * from a user gesture -- `requestPermission` only prompts inside one.
 */
export async function requestProjectDirectoryAccess(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}
