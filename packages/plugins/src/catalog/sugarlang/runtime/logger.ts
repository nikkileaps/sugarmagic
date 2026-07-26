/**
 * packages/plugins/src/catalog/sugarlang/runtime/logger.ts
 *
 * Purpose: Single real logger factory for sugarlang runtime diagnostics.
 *
 * Exports:
 *   - SugarlangLoggerLike
 *   - createSugarlangLogger
 *
 * Relationships:
 *   - Consumed by runtime-services, manifest, and middleware factories.
 *
 * Implements: Plan 081 story 081.1 (Epic 13 skeleton replaced)
 *
 * Status: active
 */

export interface SugarlangLoggerLike {
  debug: (message: string, payload?: Record<string, unknown>) => void;
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
}

const SILENT_LOGGER: SugarlangLoggerLike = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export function createSugarlangLogger(options: {
  debugLogging: boolean;
  namespace?: string;
}): SugarlangLoggerLike {
  if (!options.debugLogging) {
    return SILENT_LOGGER;
  }
  const tag = `[${options.namespace ?? "sugarlang"}]`;
  return {
    debug(message, payload) {
      console.debug(tag, message, payload ?? {});
    },
    info(message, payload) {
      console.info(tag, message, payload ?? {});
    },
    warn(message, payload) {
      console.warn(tag, message, payload ?? {});
    },
    error(message, payload) {
      console.error(tag, message, payload ?? {});
    }
  };
}
