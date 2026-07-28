/**
 * packages/plugins/src/catalog/sugaragent/runtime/contributions.ts
 *
 * Purpose: Defines the lifecycle contribution contract and collects per-turn
 *   plugin contributions from the annotation bus.
 *
 * How to participate (from any plugin, without importing sugaragent):
 *   Write `execution.annotations["sugaragent.contrib/<your-plugin-id>"]` at
 *   prepare time with an object matching SugaragentContribution. Sugaragent
 *   collects, validates, and merges all contributions once per stage. Unknown
 *   fields and unknown plugin IDs are silently ignored. Zero contributions
 *   produces byte-identical behavior to today.
 *
 * Merge semantics (deterministic, documented):
 *   - Overlay / reminder strings: blank-line joined, in pluginId sort order.
 *   - Directive arrays: concatenated, in pluginId sort order.
 *   - Boolean flags (preserveActionTags): OR across all contributors.
 *   - Lexicon maps: union per category (dedup not guaranteed; callers deduplicate if needed).
 *
 * Exports:
 *   - SUGARAGENT_CONTRIB_PREFIX
 *   - SugaragentContribution
 *   - MergedContributions
 *   - collectContributions
 *
 * Status: active (Plan 084.1)
 */

export const SUGARAGENT_CONTRIB_PREFIX = "sugaragent.contrib/" as const;

/**
 * Data-only contribution any plugin may write to the annotation bus at prepare
 * time. All fields are optional; absent fields degrade to today's behavior.
 * schemaVersion 1 is required for validation.
 *
 * Surfaces DEFINED here but consumed by later stories:
 *   generateReminder  -- 083.5 (terminal drift-reminder splice; plan 072.8 slot)
 *   judgeDirectives   -- 084.2
 *   regenDirectives   -- 084.3
 *   textConventions   -- 084.4
 *   interpretLexicon  -- 084.5
 *   retrieveBiasTerms -- 087.6 (teachable-biased retrieval)
 */
export interface SugaragentContribution {
  schemaVersion: 1;
  /** Extra overlay text spliced into the generator user-message (per-turn, uncached). */
  generateOverlay?: string;
  /** Reminder text re-injected near the end of the generator user-message (terminal slot). */
  generateReminder?: string;
  /** Directive strings for the judge -- behavior directed by these is never an IN-CHARACTER violation. */
  judgeDirectives?: string[];
  /** Directive strings spliced into the regen user-message to preserve constraints after a judge-fail. */
  regenDirectives?: string[];
  /** Text-convention flags for output hygiene stages. */
  textConventions?: {
    /** When true, asterisk-delimited action-tag spans (*waves*) survive normalizeNpcSpeech and audit. */
    preserveActionTags?: boolean;
  };
  /**
   * Target-language surface forms keyed by intent category.
   * Example: { farewell: ["adios", "hasta luego"], greeting: ["hola", "buenas"] }
   * Categories must match the intent groups in interpretation.ts; unknown categories ignored.
   */
  interpretLexicon?: Record<string, string[]>;
  /**
   * Lemma ids the outer-loop scheduler wants the retrieval query to be biased toward.
   * Consumed by RetrieveStage to append "Vocabulary in focus: ..." to the search query.
   * Concatenated across contributors (same semantics as judgeDirectives).
   * Published by sugarlang when the schedule has active (non-fluency) lemma teachables.
   */
  retrieveBiasTerms?: string[];
}

/** Merged view of all contributions for a given turn. */
export interface MergedContributions {
  /** Overlay strings joined with a blank line. Empty string when no contributions. */
  mergedOverlay: string;
  /** Reminder strings joined with a blank line. Empty string when no contributions. */
  mergedReminder: string;
  judgeDirectives: string[];
  regenDirectives: string[];
  /** OR of all preserveActionTags flags. */
  preserveActionTags: boolean;
  /** Union of surface forms per category. */
  interpretLexicon: Record<string, string[]>;
  /** Lemma ids to bias the retrieval query toward; concatenated across contributors. */
  retrieveBiasTerms: string[];
}

const EMPTY: MergedContributions = {
  mergedOverlay: "",
  mergedReminder: "",
  judgeDirectives: [],
  regenDirectives: [],
  preserveActionTags: false,
  interpretLexicon: {},
  retrieveBiasTerms: []
};

function isValidContribution(raw: unknown): raw is SugaragentContribution {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return false;
  if (obj.generateOverlay !== undefined && typeof obj.generateOverlay !== "string") return false;
  if (obj.generateReminder !== undefined && typeof obj.generateReminder !== "string") return false;
  if (obj.judgeDirectives !== undefined && !Array.isArray(obj.judgeDirectives)) return false;
  if (obj.regenDirectives !== undefined && !Array.isArray(obj.regenDirectives)) return false;
  if (
    obj.textConventions !== undefined &&
    (typeof obj.textConventions !== "object" || obj.textConventions === null)
  ) return false;
  if (
    obj.interpretLexicon !== undefined &&
    (typeof obj.interpretLexicon !== "object" || obj.interpretLexicon === null)
  ) return false;
  if (obj.retrieveBiasTerms !== undefined && !Array.isArray(obj.retrieveBiasTerms)) return false;
  return true;
}

/**
 * Scan execution annotations for contribution keys, validate structurally,
 * sort by pluginId, and return the merged view. Never throws; malformed
 * entries are dropped with a logged warning.
 */
export function collectContributions(
  annotations: Record<string, unknown>,
  logger?: { warn: (msg: string, data?: unknown) => void }
): MergedContributions {
  const entries: Array<{ pluginId: string; contrib: SugaragentContribution }> = [];

  for (const key of Object.keys(annotations)) {
    if (!key.startsWith(SUGARAGENT_CONTRIB_PREFIX)) continue;
    const pluginId = key.slice(SUGARAGENT_CONTRIB_PREFIX.length);
    if (!pluginId) continue;
    const raw = annotations[key];
    if (!isValidContribution(raw)) {
      logger?.warn(`[sugaragent] Dropping malformed contribution from plugin "${pluginId}"`, { key });
      continue;
    }
    entries.push({ pluginId, contrib: raw });
  }

  if (entries.length === 0) return EMPTY;

  entries.sort((a, b) => a.pluginId.localeCompare(b.pluginId));

  const overlayParts: string[] = [];
  const reminderParts: string[] = [];
  const judgeDirectives: string[] = [];
  const regenDirectives: string[] = [];
  let preserveActionTags = false;
  const interpretLexicon: Record<string, string[]> = {};
  const retrieveBiasTerms: string[] = [];

  for (const { contrib } of entries) {
    if (contrib.generateOverlay) overlayParts.push(contrib.generateOverlay);
    if (contrib.generateReminder) reminderParts.push(contrib.generateReminder);
    if (contrib.judgeDirectives?.length) judgeDirectives.push(...contrib.judgeDirectives);
    if (contrib.regenDirectives?.length) regenDirectives.push(...contrib.regenDirectives);
    if (contrib.textConventions?.preserveActionTags) preserveActionTags = true;
    if (contrib.interpretLexicon) {
      for (const [category, forms] of Object.entries(contrib.interpretLexicon)) {
        if (!Array.isArray(forms)) continue;
        const existing = interpretLexicon[category];
        if (existing) {
          existing.push(...forms);
        } else {
          interpretLexicon[category] = [...forms];
        }
      }
    }
    if (contrib.retrieveBiasTerms?.length) retrieveBiasTerms.push(...contrib.retrieveBiasTerms);
  }

  return {
    mergedOverlay: overlayParts.join("\n\n"),
    mergedReminder: reminderParts.join("\n\n"),
    judgeDirectives,
    regenDirectives,
    preserveActionTags,
    interpretLexicon,
    retrieveBiasTerms
  };
}
