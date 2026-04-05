import type { TurnStageDiagnostics, TurnStageResult } from "../types";

export function createDiagnostics(
  stageId: string,
  startedAt: number,
  status: TurnStageResult<unknown>["status"],
  payload: Record<string, unknown>,
  fallbackReason?: string | null
): TurnStageDiagnostics {
  const completedAt = Date.now();
  return {
    stageId,
    status,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt,
    payload,
    fallbackReason
  };
}
