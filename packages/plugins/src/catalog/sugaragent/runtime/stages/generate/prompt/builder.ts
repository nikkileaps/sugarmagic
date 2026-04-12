/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/builder.ts
 *
 * Purpose: Pure function that takes a typed GeneratePromptContext and returns
 *          the system and user prompts for the NPC generation LLM call.
 *          Dispatches to mode-specific builders based on the discriminated union.
 *
 * Exports:
 *   - GeneratePromptResult
 *   - buildGeneratePrompt
 *
 * Status: active
 */

import type {
  GeneratePromptContext,
  AgentPromptContext,
  ScriptedPromptContext,
  BasePromptContext
} from "./context";
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
 * Builds the shared system prompt lines present in all modes:
 * identity, tone, grounding rules, world state, and plugin overlay.
 */
function buildSharedSystemLines(
  context: BasePromptContext,
  interactionMode: string,
  suppressWorldState: boolean
): (string | null)[] {
  const slots = {
    npcDisplayName: context.npcDisplayName,
    interactionMode
  };

  return [
    // 1. Identity
    ...SYSTEM_PROMPT_IDENTITY.map((line) => fillSlot(line, slots)),

    // 1b. Tone
    context.tone
      ? `Tone: ${context.tone}. Let this tone guide word choice, pacing, and warmth — but stay in character.`
      : null,

    // 2. Grounding rules
    ...SYSTEM_PROMPT_GROUNDING_RULES,

    // 3. World state
    context.activeQuestDisplayName && !suppressWorldState
      ? `The player is currently on a quest: "${context.activeQuestDisplayName}"${context.activeQuestStageDisplayName ? ` (stage: ${context.activeQuestStageDisplayName})` : ""}. This is the PLAYER's goal, not yours. Only reference it if the player brings it up or if it's directly relevant to your character.`
      : null,

    context.currentLocationDisplayName
      ? `Current location: ${context.currentLocationDisplayName}.`
      : null,

    context.currentParentAreaDisplayName && !suppressWorldState
      ? `Containing area: ${context.currentParentAreaDisplayName}.`
      : null,

    context.npcPlayerRelation
      ? `Player proximity: ${context.npcPlayerRelation.proximityBand}. Same area: ${context.npcPlayerRelation.sameArea ? "yes" : "no"}.`
      : null,

    context.npcCurrentTask && !suppressWorldState
      ? `Current task: ${context.npcCurrentTask.displayName}.`
      : null,

    context.npcCurrentTask?.description && !suppressWorldState
      ? `Task context: ${context.npcCurrentTask.description}.`
      : null,

    context.npcCurrentActivity && !suppressWorldState
      ? `Current activity: ${context.npcCurrentActivity}.`
      : null,

    context.npcCurrentGoal && !suppressWorldState
      ? `Current goal: ${context.npcCurrentGoal}.`
      : null,

    context.npcMovement && !suppressWorldState
      ? `Movement status: ${context.npcMovement.status}${context.npcMovement.targetAreaDisplayName ? ` toward ${context.npcMovement.targetAreaDisplayName}` : ""}.`
      : null,

    // 4. Plugin overlay (opaque — language learning, etc.)
    context.languageLearningOverlay || null
  ];
}

// ── Agent mode builder ──

function buildAgentPrompt(context: AgentPromptContext): GeneratePromptResult {
  const systemLines: (string | null)[] = [
    ...buildSharedSystemLines(context, "agent", context.minimalGreetingMode),
    context.minimalGreetingMode ? MINIMAL_GREETING_INSTRUCTION : null
  ];

  const userLines: (string | null)[] = [
    context.minimalGreetingMode
      ? "Reply in exactly 1 short sentence. Use at most 2 very short sentences only if absolutely necessary."
      : "Respond to the player naturally, matching the tone and length to the conversation.",

    `Intent: ${context.responseIntent}.`,
    `Turn path: ${context.turnPath}.`,
    `Interpret intent: ${context.interpretIntent}.`,
    `Goal: ${context.responseGoal}`,

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

    context.evidenceSummary.length > 0
      ? `Evidence:\n- ${context.evidenceSummary.join("\n- ")}`
      : "Evidence: none retrieved.",

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

// ── Scripted mode builder ──

function buildScriptedPrompt(context: ScriptedPromptContext): GeneratePromptResult {
  const systemLines: (string | null)[] = [
    ...buildSharedSystemLines(context, "scripted", false),

    "",
    "SCRIPTED LINE ADAPTATION:",
    "You are adapting a pre-authored English dialogue line for a language learner.",
    "You MUST preserve the exact narrative meaning, quest-critical information, and emotional tone of the authored line.",
    "Do NOT add, remove, or change any story content.",
    "Do NOT add parenthetical translations — the UI handles glossing.",
    "Adapt the language mix (target language vs support language) based on the language learning overlay above.",
    "If no language learning overlay is present, deliver the line in English as-is."
  ];

  const userLines: (string | null)[] = [
    "Adapt the following authored dialogue line for the learner's current level.",

    `Speaker: ${context.authoredLineSpeaker}`,
    `Authored line: "${context.authoredLineText}"`,

    context.questContext
      ? `Quest context: ${context.questContext}`
      : null,

    "Preserve the EXACT meaning. Adjust the language mix to match the learner's level as specified in the language learning overlay. Return only the adapted spoken line — no stage directions, no explanations.",

    context.recentHistory.length > 0
      ? `Recent history:\n${context.recentHistory
          .map((entry) => `${entry.role}: ${entry.text}`)
          .join("\n")}`
      : null
  ];

  return {
    systemPrompt: systemLines.filter(Boolean).join("\n"),
    userPrompt: userLines.filter(Boolean).join("\n\n")
  };
}

// ── Main entry point ──

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

  switch (context.mode) {
    case "agent":
      return buildAgentPrompt(context);
    case "scripted":
      return buildScriptedPrompt(context);
  }
}
