/**
 * File System Access API adapter for canonical game-root IO.
 *
 * Browser-first: uses showDirectoryPicker for project open/create,
 * FileSystemDirectoryHandle for read/write, and IndexedDB for
 * persisting handles across sessions.
 */

export interface FsAccessHandle {
  directoryHandle: FileSystemDirectoryHandle;
  rootPath: string;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export async function pickFile(options?: {
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}): Promise<FileSystemFileHandle> {
  const [fileHandle] = await window.showOpenFilePicker({
    multiple: false,
    excludeAcceptAllOption: false,
    ...options
  });
  return fileHandle;
}

export async function listFilesInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  options: {
    extensions?: string[];
  } = {}
): Promise<File[]> {
  const extensions = new Set(
    (options.extensions ?? []).map((extension) => extension.toLowerCase())
  );
  const files: File[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") {
      continue;
    }
    const file = await (entry as FileSystemFileHandle).getFile();
    if (extensions.size > 0) {
      const lowerName = file.name.toLowerCase();
      const matchesExtension = [...extensions].some((extension) =>
        lowerName.endsWith(extension)
      );
      if (!matchesExtension) {
        continue;
      }
    }
    files.push(file);
  }

  return files;
}

export async function readJsonFile<T>(
  dirHandle: FileSystemDirectoryHandle,
  ...pathSegments: string[]
): Promise<T | null> {
  try {
    let current = dirHandle;
    for (const segment of pathSegments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }
    const fileName = pathSegments[pathSegments.length - 1];
    const fileHandle = await current.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(
  dirHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
  data: unknown
): Promise<void> {
  return writeTextFile(dirHandle, pathSegments, JSON.stringify(data, null, 2));
}

export async function writeTextFile(
  dirHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
  data: string
): Promise<void> {
  let current = dirHandle;
  for (const segment of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  const fileName = pathSegments[pathSegments.length - 1];
  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function writeBlobFile(
  dirHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
  data: Blob
): Promise<void> {
  let current = dirHandle;
  for (const segment of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  const fileName = pathSegments[pathSegments.length - 1];
  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function readBlobFile(
  dirHandle: FileSystemDirectoryHandle,
  ...pathSegments: string[]
): Promise<Blob | null> {
  try {
    let current = dirHandle;
    for (const segment of pathSegments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }
    const fileName = pathSegments[pathSegments.length - 1];
    const fileHandle = await current.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null;
  }
}

export async function readTextFile(
  dirHandle: FileSystemDirectoryHandle,
  ...pathSegments: string[]
): Promise<string | null> {
  try {
    let current = dirHandle;
    for (const segment of pathSegments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }
    const fileName = pathSegments[pathSegments.length - 1];
    const fileHandle = await current.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return file.text();
  } catch {
    return null;
  }
}

export async function ensureDirectory(
  dirHandle: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  return dirHandle.getDirectoryHandle(name, { create: true });
}

const DB_NAME = "sugarmagic-project-handles";
const STORE_NAME = "handles";

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeProjectHandle(
  key: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProjectHandle(
  key: string
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function listStoredProjectKeys(): Promise<string[]> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
  });
}
