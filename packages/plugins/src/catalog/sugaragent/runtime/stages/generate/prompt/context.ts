/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/context.ts
 *
 * Purpose: Defines the typed structure that the GenerateStage compiles from
 *          interpret/retrieve/plan outputs and runtime context. The prompt
 *          builder expects this shape and nothing else.
 *
 * Exports:
 *   - GeneratePromptContext
 *
 * Status: active
 */

/**
 * Everything the prompt builder needs to construct the system and user prompts.
 * GenerateStage is responsible for compiling this from stage inputs.
 * The prompt builder is a pure function: context in, prompts out.
 */
export interface GeneratePromptContext {
  /** NPC display name — used as the speaker identity in the system prompt. */
  npcDisplayName: string;

  /** Overall tone for NPC dialogue (e.g. "cozy", "gritty", "whimsical"). Null means no tone directive. */
  tone: string | null;

  /** Interaction mode: "agent" for AI-driven, "scripted" for authored dialogue. */
  interactionMode: string;

  /** The intent classification from the plan stage (greet, answer, chat, clarify, abstain). */
  responseIntent: string;

  /** How specific the response should be (grounded vs generic-only). */
  responseSpecificity: string;

  /** The turn path from the plan stage (e.g. "grounded", "fallback"). */
  turnPath: string;

  /** The response goal from the plan stage. */
  responseGoal: string;

  /** The interpreted intent from the interpret stage. */
  interpretIntent: string;

  /** What the player said, or null for the opening turn. */
  playerText: string | null;

  /** Whether the generator should use minimal first-meeting greeting mode. */
  minimalGreetingMode: boolean;

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

  /** Evidence summary lines from the retrieve stage. */
  evidenceSummary: string[];

  /** Recent conversation history (last N entries). */
  recentHistory: Array<{ role: string; text: string }>;

  /**
   * Opaque prompt overlay from a language-learning plugin (e.g. sugarlang).
   * The builder splices this into the system prompt without interpreting it.
   * Empty string or null means no overlay.
   */
  languageLearningOverlay: string | null;
}
