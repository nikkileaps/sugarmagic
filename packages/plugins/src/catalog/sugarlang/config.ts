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

export interface SugarLangChunkExtractionConfig {
  /** When false, the tier-2 chunk extraction scheduler never fires and the
   *  classifier runs lemma-only. Chunks already in the cache are still used —
   *  this only prevents NEW extractions (and therefore new Claude calls).
   *  Default: true. Set to false during heavy authoring iteration to keep
   *  Claude costs at zero for chunks. */
  enabled: boolean;
}

export type SugarlangTargetLanguage = "es" | "it" | "";
export type SugarlangSupportLanguage = "en";
export type SugarlangDebugBandOverride = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "";

export interface SugarLangPluginConfig {
  /** The target language the player is learning. Required — if empty and the
   *  plugin is enabled, an error is surfaced at init. */
  targetLanguage: SugarlangTargetLanguage;
  /** The player's native / support language. Defaults to "en". */
  supportLanguage: SugarlangSupportLanguage;
  debugLogging: boolean;
  /** When false, Sugarlang verify is bypassed. Default is true; set to false or
   *  use SUGARMAGIC_SUGARLANG_VERIFY_DISABLED=1 only to inspect raw Director +
   *  Generate behavior without the post-generation enforcement pass. */
  verifyEnabled: boolean;
  /** Model to use for scripted dialogue adaptation. Defaults to Haiku for speed/cost. */
  scriptedAdaptationModel: string;
  placement: SugarLangPlacementConfig;
  chunkExtraction: SugarLangChunkExtractionConfig;
  /** Dev-only: when set, skip placement and boot the learner at this CEFR band.
   *  Applied at conversation start via a synthetic PlacementCompletionEvent.
   *  Set to "" to disable. Never affects production deployments. */
  debugBandOverride: SugarlangDebugBandOverride;
}

export const SUGARLANG_TARGET_LANGUAGE_ENV =
  "SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE";

export const SUGARLANG_PROXY_BASE_URL_ENV =
  "SUGARMAGIC_SUGARLANG_PROXY_BASE_URL";

export const SUGARLANG_VERIFY_ENABLED_ENV =
  "SUGARMAGIC_SUGARLANG_VERIFY_ENABLED";

export const SUGARLANG_VERIFY_DISABLED_ENV =
  "SUGARMAGIC_SUGARLANG_VERIFY_DISABLED";

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

const VALID_TARGET_LANGUAGES = new Set<SugarlangTargetLanguage>(["es", "it"]);
const VALID_DEBUG_BANDS = new Set<SugarlangDebugBandOverride>(["A1", "A2", "B1", "B2", "C1", "C2"]);

function normalizeTargetLanguage(value: unknown): SugarlangTargetLanguage {
  if (typeof value === "string" && VALID_TARGET_LANGUAGES.has(value as SugarlangTargetLanguage)) {
    return value as SugarlangTargetLanguage;
  }
  return "";
}

function normalizeDebugBandOverride(value: unknown): SugarlangDebugBandOverride {
  if (typeof value === "string" && VALID_DEBUG_BANDS.has(value as SugarlangDebugBandOverride)) {
    return value as SugarlangDebugBandOverride;
  }
  return "";
}

export function normalizeSugarLangPluginConfig(
  config: Record<string, unknown> | null | undefined,
  _environment?: RuntimePluginEnvironment
): SugarLangPluginConfig {
  const placementConfig = isRecord(config?.placement) ? config.placement : null;
  const chunkConfig = isRecord(config?.chunkExtraction) ? config.chunkExtraction : null;

  return {
    targetLanguage: normalizeTargetLanguage(config?.targetLanguage),
    supportLanguage: "en",
    debugLogging:
      config?.debugLogging === true ||
      readEnvBoolean(_environment, "SUGARMAGIC_SUGARLANG_DEBUG_LOGGING"),
    verifyEnabled:
      config?.verifyEnabled !== false &&
      !readEnvBoolean(_environment, SUGARLANG_VERIFY_DISABLED_ENV),
    scriptedAdaptationModel:
      typeof config?.scriptedAdaptationModel === "string" && config.scriptedAdaptationModel.trim()
        ? config.scriptedAdaptationModel.trim()
        : "claude-haiku-4-5-20251001",
    chunkExtraction: {
      enabled:
        typeof chunkConfig?.enabled === "boolean"
          ? chunkConfig.enabled
          : true
    },
    debugBandOverride: normalizeDebugBandOverride(config?.debugBandOverride),
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

/**
 * Single resolver for the sugarlang gateway proxy base URL: the
 * sugarlang-scoped env var wins, falling back to sugaragent's (the two
 * plugins share one gateway). Returns "" when neither is set.
 * lore-resolution.ts layers a host-global fallback on top of this for
 * compile-time contexts; all other call sites use this directly.
 */
export function resolveSugarlangProxyBaseUrl(
  environment: RuntimePluginEnvironment | undefined
): string {
  return (
    environment?.[SUGARLANG_PROXY_BASE_URL_ENV]?.trim() ||
    environment?.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL?.trim() ||
    ""
  );
}
