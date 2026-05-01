/**
 * Item thumbnail file IO helpers.
 *
 * Writes generated PNG thumbnails to the project's `assets/thumbnails/`
 * folder and returns the relative path to be stored on the item definition.
 * The PNG itself is a managed file — produced by the "Generate Thumbnail"
 * inspector button, never authored externally.
 */

import { writeBlobFile } from "../fs-access";

const THUMBNAIL_DIR = "assets/thumbnails";

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export async function writeItemThumbnailFile(
  handle: FileSystemDirectoryHandle,
  itemDefinitionId: string,
  blob: Blob
): Promise<string> {
  const filename = `${sanitizeFilename(itemDefinitionId)}.png`;
  const segments = [...THUMBNAIL_DIR.split("/"), filename];
  await writeBlobFile(handle, segments, blob);
  return `${THUMBNAIL_DIR}/${filename}`;
}
