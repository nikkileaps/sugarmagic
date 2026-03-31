import type { TimestampIso } from "@sugarmagic/domain";

export type RuntimeSessionBoundary = "isolated-runtime-session";
export type RuntimeSessionKind = "preview" | "playtest" | "published";

export interface RuntimeSessionSnapshot {
  workspaceId: string;
  cameraId: string;
}

export interface RuntimeSessionRecord {
  sessionId: string;
  sessionKind: RuntimeSessionKind;
  boundary: RuntimeSessionBoundary;
  createdAt: TimestampIso;
}
