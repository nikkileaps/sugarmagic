import { markTurnPhase } from "@sugarmagic/runtime-core";

export interface SugarAgentLogger {
  logPluginEvent: (event: string, payload?: Record<string, unknown>) => void;
  logStageStart: (stageId: string, payload: Record<string, unknown>) => void;
  logStageEnd: (payload: Record<string, unknown>) => void;
}

function emit(enabled: boolean, scope: string, payload?: Record<string, unknown>) {
  if (!enabled) return;
  console.debug(`[sugaragent] ${scope}`, payload ?? {});
}

export function createSugarAgentLogger(enabled: boolean): SugarAgentLogger {
  return {
    logPluginEvent(event, payload) {
      emit(enabled, `plugin:${event}`, payload);
    },
    logStageStart(stageId, payload) {
      emit(enabled, `stage:${stageId}:start`, payload);
    },
    logStageEnd(payload) {
      emit(enabled, `stage:${String(payload.stageId)}:end`, payload);
      // Spike (sugarmagic-latency-cex): the stage already knows how long it
      // took, so the timeline reads that rather than timing it a second time.
      // Deliberately outside the `enabled` gate -- the timeline is the
      // measurement, and gating it behind debug logging is how a spike ends up
      // with an empty dataset.
      if (typeof payload.durationMs === "number") {
        markTurnPhase(String(payload.stageId), payload.durationMs);
      }
    }
  };
}
