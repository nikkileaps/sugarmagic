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
 * Status: active
 */

import type { RuntimePluginEnvironment } from "../../runtime";

export interface SugarLangPlacementConfig {
  enabled: boolean;
  minAnswersForValid: number | "use-bank-default";
  confidenceFloor: number;
  openingDialogTurns: number;
  closingDialogTurns: number;
}

export interface SugarLangPluginConfig {
  debugLogging: boolean;
  placement: SugarLangPlacementConfig;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeConfidenceFloor(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(0.95, Math.max(0.05, value));
}

export function normalizeSugarLangPluginConfig(
  config: Record<string, unknown> | null | undefined,
  _environment?: RuntimePluginEnvironment
): SugarLangPluginConfig {
  const placementConfig = isRecord(config?.placement) ? config.placement : null;

  return {
    debugLogging: readEnvBoolean(
      _environment,
      "SUGARMAGIC_SUGARLANG_DEBUG_LOGGING"
    ),
    placement: {
      enabled:
        typeof placementConfig?.enabled === "boolean"
          ? placementConfig.enabled
          : true,
      minAnswersForValid:
        typeof placementConfig?.minAnswersForValid === "number" &&
        Number.isFinite(placementConfig.minAnswersForValid)
          ? normalizePositiveInteger(placementConfig.minAnswersForValid, 1)
          : "use-bank-default",
      confidenceFloor: normalizeConfidenceFloor(
        placementConfig?.confidenceFloor,
        0.3
      ),
      openingDialogTurns: normalizePositiveInteger(
        placementConfig?.openingDialogTurns,
        2
      ),
      closingDialogTurns: normalizePositiveInteger(
        placementConfig?.closingDialogTurns,
        2
      )
    }
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
