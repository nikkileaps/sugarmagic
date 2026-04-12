/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/builder.ts
 *
 * Purpose: Pure function that takes a typed GeneratePromptContext and returns
 *          the system and user prompts for the NPC generation LLM call.
 *
 * Exports:
 *   - GeneratePromptResult
 *   - buildGeneratePrompt
 *
 * Status: active
 */

import type { GeneratePromptContext } from "./context";
import {
  SYSTEM_PROMPT_IDENTITY,
  SYSTEM_PROMPT_GROUNDING_RULES,
  MINIMAL_GREETING_INSTRUCTION
} from "./template";

export interface GeneratePromptResult {
  systemPrompt: string;
  userPrompt: string;
}

function fillSlot(line: string, slots: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? `{${key}}`);
}

/**
 * Builds the system and user prompts from a typed context.
 *
 * This is a pure function with no side effects. It does not call any LLM,
 * access any external state, or read from annotations. The GenerateStage
 * is responsible for compiling the context; this function just formats it.
 *
 * @throws Error if npcDisplayName is empty
 */
export function buildGeneratePrompt(
  context: GeneratePromptContext
): GeneratePromptResult {
  if (!context.npcDisplayName.trim()) {
    throw new Error(
      "buildGeneratePrompt: npcDisplayName is required but was empty."
    );
  }

  const slots = {
    npcDisplayName: context.npcDisplayName,
    interactionMode: context.interactionMode
  };

  // ── System prompt ──

  const systemLines: (string | null)[] = [
    // 1. Identity
    ...SYSTEM_PROMPT_IDENTITY.map((line) => fillSlot(line, slots)),

    // 1b. Tone
    context.tone
      ? `Tone: ${context.tone}. Let this tone guide word choice, pacing, and warmth — but stay in character.`
      : null,

    // 2. Grounding rules
    ...SYSTEM_PROMPT_GROUNDING_RULES,

    // 3. World state (suppressed in minimal greeting mode)
    context.activeQuestDisplayName && !context.minimalGreetingMode
      ? `Active quest: ${context.activeQuestDisplayName}${context.activeQuestStageDisplayName ? ` / ${context.activeQuestStageDisplayName}` : ""}`
      : null,

    context.currentLocationDisplayName
      ? `Current location: ${context.currentLocationDisplayName}.`
      : null,

    context.currentParentAreaDisplayName && !context.minimalGreetingMode
      ? `Containing area: ${context.currentParentAreaDisplayName}.`
      : null,

    context.npcPlayerRelation
      ? `Player proximity: ${context.npcPlayerRelation.proximityBand}. Same area: ${context.npcPlayerRelation.sameArea ? "yes" : "no"}.`
      : null,

    context.npcCurrentTask && !context.minimalGreetingMode
      ? `Current task: ${context.npcCurrentTask.displayName}.`
      : null,

    context.npcCurrentTask?.description && !context.minimalGreetingMode
      ? `Task context: ${context.npcCurrentTask.description}.`
      : null,

    context.npcCurrentActivity && !context.minimalGreetingMode
      ? `Current activity: ${context.npcCurrentActivity}.`
      : null,

    context.npcCurrentGoal && !context.minimalGreetingMode
      ? `Current goal: ${context.npcCurrentGoal}.`
      : null,

    context.npcMovement && !context.minimalGreetingMode
      ? `Movement status: ${context.npcMovement.status}${context.npcMovement.targetAreaDisplayName ? ` toward ${context.npcMovement.targetAreaDisplayName}` : ""}.`
      : null,

    context.minimalGreetingMode ? MINIMAL_GREETING_INSTRUCTION : null,

    // 4. Plugin overlay (opaque — language learning, etc.)
    context.languageLearningOverlay || null
  ];

  // ── User prompt ──

  const userLines: (string | null)[] = [
    // 1. Response directive
    context.minimalGreetingMode
      ? "Reply in exactly 1 short sentence. Use at most 2 very short sentences only if absolutely necessary."
      : "Respond to the player naturally, matching the tone and length to the conversation.",

    `Intent: ${context.responseIntent}.`,
    `Turn path: ${context.turnPath}.`,
    `Interpret intent: ${context.interpretIntent}.`,
    `Goal: ${context.responseGoal}`,

    // 2. Moment context
    context.playerText
      ? `Player said: ${context.playerText}`
      : "This is the opening turn. Start the conversation naturally.",

    context.minimalGreetingMode
      ? "This is a first-meeting greeting for a beginner learner. Keep it brief, warm, and generic. Do not volunteer what the NPC is doing unless asked."
      : null,

    context.responseIntent === "clarify"
      ? "Ask one concise clarifying question. Do not answer beyond what is grounded."
      : null,

    context.responseIntent === "abstain"
      ? "State clearly that you do not know enough grounded information to answer yet. Invite the player to provide more context. Do not fabricate."
      : null,

    context.responseIntent === "chat"
      ? "Respond as natural in-character social speech. Warmth is allowed. Do not turn a social reply into a factual worldbuilding answer."
      : null,

    context.responseSpecificity === "grounded"
      ? "Use grounded evidence when present, but do not add unsupported specifics."
      : "Keep the reply generic, in-character, and low-specificity.",

    context.currentLocationDisplayName
      ? `Current runtime location: ${context.currentLocationDisplayName}.`
      : null,

    context.currentParentAreaDisplayName && !context.minimalGreetingMode
      ? `Current containing area: ${context.currentParentAreaDisplayName}.`
      : null,

    context.npcPlayerRelation
      ? `Player/NPC proximity band: ${context.npcPlayerRelation.proximityBand}.`
      : null,

    context.npcCurrentTask && !context.minimalGreetingMode
      ? `NPC current task: ${context.npcCurrentTask.displayName}.`
      : null,

    context.npcCurrentTask?.description && !context.minimalGreetingMode
      ? `NPC task context: ${context.npcCurrentTask.description}.`
      : null,

    context.npcCurrentActivity && !context.minimalGreetingMode
      ? `NPC current activity: ${context.npcCurrentActivity}.`
      : null,

    context.npcCurrentGoal && !context.minimalGreetingMode
      ? `NPC current goal: ${context.npcCurrentGoal}.`
      : null,

    context.npcMovement && !context.minimalGreetingMode
      ? `NPC movement status: ${context.npcMovement.status}${context.npcMovement.targetAreaDisplayName ? ` toward ${context.npcMovement.targetAreaDisplayName}` : ""}.`
      : null,

    // 3. Evidence
    context.evidenceSummary.length > 0
      ? `Evidence:\n- ${context.evidenceSummary.join("\n- ")}`
      : "Evidence: none retrieved.",

    // 4. History
    context.recentHistory.length > 0
      ? `Recent history:\n${context.recentHistory
          .map((entry) => `${entry.role}: ${entry.text}`)
          .join("\n")}`
      : "Recent history: none."
  ];

  return {
    systemPrompt: systemLines.filter(Boolean).join("\n"),
    userPrompt: userLines.filter(Boolean).join("\n\n")
  };
}
