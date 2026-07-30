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
  placement: SugarLangPlacementConfig;
  chunkExtraction: SugarLangChunkExtractionConfig;
  /** Dev-only: when set, skip placement and boot the learner at this CEFR band.
   *  Applied at conversation start via a synthetic PlacementCompletionEvent.
   *  Set to "" to disable. Never affects production deployments. */
  debugBandOverride: SugarlangDebugBandOverride;
}

export const SUGARLANG_PROXY_BASE_URL_ENV =
  "SUGARMAGIC_SUGARLANG_PROXY_BASE_URL";

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
    // Config is the AUTHORED DEFAULT rung only -- it deliberately does not
    // consult the environment here. Env is a lower-precedence fallback resolved
    // by resolveSugarLangTargetLanguage, and folding it in at normalize time
    // would let a deploy variable masquerade as an authored value and outrank
    // the player. This field is a default, not the answer.
    targetLanguage: normalizeTargetLanguage(config?.targetLanguage),
    supportLanguage: "en",
    debugLogging:
      config?.debugLogging === true ||
      readEnvBoolean(_environment, "SUGARMAGIC_SUGARLANG_DEBUG_LOGGING"),
    verifyEnabled:
      config?.verifyEnabled !== false &&
      !readEnvBoolean(_environment, SUGARLANG_VERIFY_DISABLED_ENV),
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

/**
 * THE single place target language is decided. Do not add a second one.
 *
 * NOT AN ENVIRONMENT VARIABLE, EVER. Target language is a PLAYER's choice, not
 * a property of a deployment: a player picks Spanish or Italian in Settings, and
 * two players of the same build must be able to choose differently. An env var
 * cannot express that -- it is one value per deployment, decided by whoever ran
 * the deploy. `SUGARMAGIC_SUGARLANG_TARGET_LANGUAGE` was removed 2026-07-29 for
 * that reason, and because it had already caused the bug it was always going to:
 * the preview boot payload read env ONLY, so setting the language in Studio left
 * preview silently shipping nothing. The gateway never read it either.
 *
 * Precedence, and the reason for each rung:
 *
 *   1. player   the learner's own choice. Highest because it is the only rung
 *               that belongs to a person. The Settings-menu picker writes here
 *               and nothing else in the system needs to know it exists.
 *   2. config   the authored default for this project (Studio's Language
 *               panel). What a new player gets before choosing.
 *
 * THERE IS NO THIRD RUNG. If neither is set this THROWS, and the caller is
 * expected to let it propagate. A language-learning system with no language is
 * not degraded, it is misconfigured -- every downstream decision (which atlas,
 * which lexicon, which cards, which variants) is meaningless without one.
 * Returning null here is precisely what let a misconfigured preview boot
 * "successfully" with an empty payload and no situations for months.
 *
 * Both rungs are optional so callers pass only what they have: a compile-time
 * caller has no player, a runtime caller has both.
 *
 * @throws SugarlangMissingTargetLanguageError when no rung yields a language.
 */
export function resolveSugarLangTargetLanguage(sources: {
  /** The learner's selection, e.g. LearnerProfile.targetLanguage. */
  player?: string | null | undefined;
  /** The project's authored default, e.g. SugarLangPluginConfig.targetLanguage. */
  config?: string | null | undefined;
}): string {
  const resolved =
    normalizeLanguageValue(sources.player) ??
    normalizeLanguageValue(sources.config);
  if (!resolved) {
    throw new SugarlangMissingTargetLanguageError();
  }
  return resolved;
}

/**
 * Raised when no target language is configured anywhere.
 *
 * Its own type so callers can distinguish "misconfigured" from any other
 * failure, and so a catch-all handler cannot quietly absorb it as a generic
 * error. The message names the two places that can fix it, because the previous
 * failure mode was a blank screen with no clue which knob was missing.
 */
export class SugarlangMissingTargetLanguageError extends Error {
  constructor() {
    super(
      "Sugarlang has no target language. Set it in Studio's Language panel " +
        "(project default), or via the player's language selection. This is a " +
        "configuration error, not a runtime condition: every downstream " +
        "decision -- atlas, lexicon, cards, variants -- requires a language."
    );
    this.name = "SugarlangMissingTargetLanguageError";
  }
}

function normalizeLanguageValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
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
