/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/context.ts
 *
 * Purpose: Defines the typed structure that the GenerateStage compiles from
 *          stage inputs and runtime context. The prompt builder expects this
 *          discriminated union and nothing else.
 *
 * Exports:
 *   - BasePromptContext
 *   - AgentPromptContext
 *   - GeneratePromptContext
 *
 * Status: active
 */

/**
 * Shared fields present in all prompt context modes.
 */
export interface BasePromptContext {
  /** NPC display name — used as the speaker identity in the system prompt. */
  npcDisplayName: string;

  /** NPC description from the NPC definition. Fallback identity anchor when no lore page is loaded. */
  npcDescription: string | null;

  /** Overall tone for NPC dialogue (e.g. "cozy", "gritty", "whimsical"). Null means no tone directive. */
  tone: string | null;

  /** Active quest display name, if any. */
  activeQuestDisplayName: string | null;

  /** Active quest stage display name, if any. */
  activeQuestStageDisplayName: string | null;

  /** Current runtime location display name. */
  currentLocationDisplayName: string | null;

  /** Parent area display name (e.g. "Station" containing "Courtyard"). */
  currentParentAreaDisplayName: string | null;

  /** Player-NPC spatial relationship. */
  npcPlayerRelation: {
    proximityBand: string;
    sameArea: boolean;
  } | null;

  /** NPC's current task from the behavior system. */
  npcCurrentTask: {
    displayName: string;
    description: string;
  } | null;

  /** NPC's current activity. */
  npcCurrentActivity: string | null;

  /** NPC's current goal. */
  npcCurrentGoal: string | null;

  /** NPC's movement status and target. */
  npcMovement: {
    status: string;
    targetAreaDisplayName?: string | null;
  } | null;

  /**
   * Opaque prompt overlay from a language-learning plugin (e.g. sugarlang).
   * Plan 072.4 relocates this to the USER message (per-turn, uncached).
   * Empty string or null means no overlay.
   */
  languageLearningOverlay: string | null;

  /**
   * Plan 072.4 — the NPC's persona card + core knowledge, loaded once at
   * session start (072.3). Rendered into the byte-stable system prompt.
   * Null (or empty layers) = degraded: system falls back to name + tone.
   * Structural (not the runtime LoadedPersona type) to keep the builder pure.
   */
  persona: {
    personaCard: Array<{ heading: string; slug: string; content: string }>;
    coreKnowledge: Array<{ heading: string; slug: string; content: string }>;
  } | null;

  /**
   * Plan 073.3 — the NPC's memory of this player, digested from the
   * record loaded once per conversation (D4). Slots into the byte-stable
   * system prompt after core knowledge. Empty string = first meeting (no
   * memory block). Must be byte-stable within a session — a mid-session
   * summarizer completion does NOT change it (the record is frozen at
   * load).
   */
  memoryDigest: string;

  /**
   * Plan 077.1 -- World-framed quest context (D2 prompt invariant). Phrased
   * as "what would be helpful in the world right now" -- NEVER the player's
   * private objective displayName/description. Goes into the UNCACHED user
   * half (per 072.4 / D7) so the byte-stable cached system prefix is never
   * busted. Null until the quest-context middleware (077.2) has resolved
   * world lore; GenerateStage keeps it null in 077.1.
   */
  questWorldContext: string | null;

  /**
   * Plan 077.3 (D4) -- how many times the active quest objective has been
   * raised to the player via NPC dialogue this session (coarse proxy: counts
   * PROMPTING, not saying). Goes into the UNCACHED user half alongside
   * questWorldContext. Zero/null -> omit the ease-off hint (first NPC to
   * offer help should do so naturally). > 0 -> the NPC knows others have
   * already nudged the player and can be more subtle.
   */
  goalSurfacedCount: number | null;

  /**
   * Plan 074 §074.3 -- world clock band read from the blackboard each turn.
   * Injected into the uncached user message (per-turn, not cache-busting).
   * Null or absent -> omit the line (default morning is an uninteresting
   * default that doesn't need explicit mention).
   */
  timeOfDay: string | null;
  /**
   * Plan 074 §074.5 -- player-known-facts display texts, capped + ordered
   * most-recent-last. Injected into the uncached user message so the NPC
   * can reference what the player already knows. Empty/null -> omit.
   */
  knownFacts: string[] | null;

  /**
   * Plan 072.8 — compact persona drift-reminder, re-injected at the END of the
   * user message (after history). Empty string = nothing to re-inject.
   */
  personaDigest: string;
}

/**
 * Agent mode: LLM generates NPC dialogue freely, guided by intent/plan/evidence.
 */
export interface AgentPromptContext extends BasePromptContext {
  mode: "agent";

  /** The intent classification from the plan stage. */
  responseIntent: string;

  /** How specific the response should be (grounded vs generic-only). */
  responseSpecificity: string;

  /** The turn path from the plan stage. */
  turnPath: string;

  /** The response goal from the plan stage. */
  responseGoal: string;

  /** The interpreted intent from the interpret stage. */
  interpretIntent: string;

  /** What the player said, or null for the opening turn. */
  playerText: string | null;

  /** Whether the generator should use minimal first-meeting greeting mode. */
  minimalGreetingMode: boolean;

  /** Evidence summary lines from the retrieve stage. */
  evidenceSummary: string[];

  /** Recent conversation history (last N entries). */
  recentHistory: Array<{ role: string; text: string }>;
}

export type GeneratePromptContext = AgentPromptContext;
