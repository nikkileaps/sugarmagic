/**
 * Document page-image managed-file IO tests.
 *
 * Verifies document page images write into the document-owned managed-file
 * folder and return the project-relative path stored in DocumentDefinition.
 */

import { describe, expect, it } from "vitest";
import { writeDocumentPageFile } from "@sugarmagic/io";

class MemoryFileHandle {
  blob: Blob | null = null;

  async createWritable() {
    return {
      write: async (blob: Blob) => {
        this.blob = blob;
      },
      close: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  directories = new Map<string, MemoryDirectoryHandle>();
  files = new Map<string, MemoryFileHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing directory ${name}`);
    const next = new MemoryDirectoryHandle();
    this.directories.set(name, next);
    return next;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing file ${name}`);
    const next = new MemoryFileHandle();
    this.files.set(name, next);
    return next;
  }
}

describe("document page IO", () => {
  it("writes pages below assets/documents/<sanitized-document-id>", async () => {
    const root = new MemoryDirectoryHandle();
    const blob = new Blob(["png"], { type: "image/png" });

    const relativePath = await writeDocumentPageFile(
      root as unknown as FileSystemDirectoryHandle,
      "doc:Map/One",
      2,
      blob
    );

    expect(relativePath).toBe("assets/documents/doc-Map-One/page-3.png");
    const assets = root.directories.get("assets");
    const documents = assets?.directories.get("documents");
    const documentFolder = documents?.directories.get("doc-Map-One");
    expect(documentFolder?.files.get("page-3.png")?.blob).toBe(blob);
  });
});
