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
