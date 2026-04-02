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

export function createScopedId(prefix: string): string {
  const current = idCounters.get(prefix) ?? 0;
  const next = current + 1;
  idCounters.set(prefix, next);
  return `${prefix}-${Date.now()}-${next}`;
}
