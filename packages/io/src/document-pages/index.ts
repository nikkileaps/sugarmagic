/**
 * Document page-image file IO helpers.
 *
 * Writes managed PNG/JPG page files to a project's
 * `assets/documents/<documentId>/` folder. Page images are owned by their
 * parent document — never library-browsed, never reused across documents
 * — so they live alongside the project file but outside the texture
 * library. Mirrors the mask + item-thumbnail managed-file pattern.
 */

import { writeBlobFile } from "../fs-access";

const DOCUMENT_PAGES_DIR = "assets/documents";

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export async function writeDocumentPageFile(
  handle: FileSystemDirectoryHandle,
  documentDefinitionId: string,
  pageIndex: number,
  blob: Blob
): Promise<string> {
  const folder = sanitizeId(documentDefinitionId);
  const filename = `page-${pageIndex + 1}.png`;
  const segments = [...DOCUMENT_PAGES_DIR.split("/"), folder, filename];
  await writeBlobFile(handle, segments, blob);
  return `${DOCUMENT_PAGES_DIR}/${folder}/${filename}`;
}
