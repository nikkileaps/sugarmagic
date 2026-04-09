/**
 * packages/plugins/src/catalog/sugarlang/runtime/logger.ts
 *
 * Purpose: Reserves the namespaced logger surface for sugarlang runtime diagnostics.
 *
 * Exports:
 *   - SugarlangLogger
 *   - createSugarlangLogger
 *
 * Relationships:
 *   - Will be consumed by runtime subsystems that need consistent debug logging.
 *   - Will feed the telemetry and debug-panel work in later epics.
 *
 * Implements: Proposal 001 §Verification, Failure Modes, and Guardrails
 *
 * Status: skeleton (no implementation yet; see Epic 13)
 */

export interface SugarlangLogger {
  debug: (message: string, payload?: Record<string, unknown>) => void;
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
}

export function createSugarlangLogger(_namespace = "sugarlang"): SugarlangLogger {
  throw new Error("TODO: Epic 13");
}
