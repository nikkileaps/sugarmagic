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
 *   - ScriptedPromptContext
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
   * The builder splices this into the system prompt without interpreting it.
   * Empty string or null means no overlay.
   */
  languageLearningOverlay: string | null;
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

/**
 * Scripted mode: LLM adapts authored English text to the learner's language
 * level while preserving the exact narrative meaning.
 */
export interface ScriptedPromptContext extends BasePromptContext {
  mode: "scripted";

  /** The original authored English dialogue line to adapt. */
  authoredLineText: string;

  /** The speaker of this line (NPC name). */
  authoredLineSpeaker: string;

  /** Quest context string for grounding (e.g. "Find the lost suitcase"), or null. */
  questContext: string | null;

  /** Recent conversation history for continuity. */
  recentHistory: Array<{ role: string; text: string }>;
}

/**
 * Discriminated union — the builder switches on `context.mode`.
 * Adding a new mode someday just adds another variant here and a builder function.
 */
export type GeneratePromptContext = AgentPromptContext | ScriptedPromptContext;
