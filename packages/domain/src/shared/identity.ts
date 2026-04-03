export type DocumentId = string;
export type TimestampIso = string;

export interface DocumentIdentity {
  id: DocumentId;
  schema: string;
  version: number;
}

export interface RegionReference {
  regionId: DocumentId;
}

export interface SubjectReference {
  subjectKind: string;
  subjectId: DocumentId;
}

const idCounters = new Map<string, number>();

function createUuidFallback(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createScopedId(prefix: string): string {
  const current = idCounters.get(prefix) ?? 0;
  const next = current + 1;
  idCounters.set(prefix, next);
  return `${prefix}-${Date.now()}-${next}`;
}

export function createUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? createUuidFallback();
}
