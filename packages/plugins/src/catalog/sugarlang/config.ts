/**
 * packages/plugins/src/catalog/sugarlang/config.ts
 *
 * Purpose: Defines the sugarlang plugin configuration shape and normalization entry point.
 *
 * Exports:
 *   - SugarLangPluginConfig
 *   - resolveSugarLangTargetLanguage
 *   - normalizeSugarLangPluginConfig
 *
 * Relationships:
 *   - Is used by ./index to normalize runtime configuration before building the plugin instance.
 *   - Will be extended by later epics as sugarlang grows concrete runtime capabilities.
 *
 * Implements: Proposal 001 §The Substrate (Untouched)
 *
 * Status: skeleton (no implementation yet; see Epic 10)
 */

import type { RuntimePluginEnvironment } from "../../runtime";

export interface SugarLangPluginConfig {
  debugLogging: boolean;
}

export const SUGARLANG_TARGET_LANGUAGE_ENV =
  "SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE";

function readEnvBoolean(
  environment: RuntimePluginEnvironment | undefined,
  key: string
): boolean {
  const value = environment?.[key];
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function normalizeSugarLangPluginConfig(
  _config: Record<string, unknown> | null | undefined,
  _environment?: RuntimePluginEnvironment
): SugarLangPluginConfig {
  return {
    debugLogging: readEnvBoolean(
      _environment,
      "SUGARMAGIC_SUGARLANG_DEBUG_LOGGING"
    )
  };
}

export function resolveSugarLangTargetLanguage(
  environment: RuntimePluginEnvironment | undefined
): string | null {
  const value = environment?.[SUGARLANG_TARGET_LANGUAGE_ENV];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim().toLowerCase();
}
