export interface SugarAgentLogger {
  logPluginEvent: (event: string, payload?: Record<string, unknown>) => void;
  logStageStart: (stageId: string, payload: Record<string, unknown>) => void;
  logStageEnd: (payload: Record<string, unknown>) => void;
  logFallback: (event: string, payload: Record<string, unknown>) => void;
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
    },
    logFallback(event, payload) {
      emit(true, `fallback:${event}`, payload);
    }
  };
}
