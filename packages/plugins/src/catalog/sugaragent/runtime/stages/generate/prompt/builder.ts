/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/builder.ts
 *
 * Purpose: Pure function that takes a typed GeneratePromptContext and returns
 *          the system and user prompts for the NPC generation LLM call.
 *
 * Plan 072.4 (cache-boundary restructure): the SYSTEM prompt holds only
 * session-stable content (identity, grounding rules, persona card, core
 * knowledge, voice directive) so it is byte-stable across turns and
 * prompt-caches. EVERYTHING per-turn (world state, sugarlang overlay, minimal-
 * greeting instruction, directives, evidence, history, player text) lives in
 * the USER message.
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

type PersonaSection = { heading: string; slug: string; content: string };

function renderSections(sections: PersonaSection[]): string {
  return sections
    .map((section) => `## ${section.heading}\n${section.content}`)
    .join("\n\n");
}

/**
 * The byte-stable half. Identity + grounding rules + persona card + core
 * knowledge + voice directive. NOTHING per-turn — every field read here is
 * session-stable (npcDisplayName, interactionMode, tone/config, persona loaded
 * once at session start). This is what prompt-caches.
 */
function buildStableSystemLines(
  context: BasePromptContext,
  interactionMode: string
): (string | null)[] {
  const slots = {
    npcDisplayName: context.npcDisplayName,
    interactionMode
  };

  const personaSections =
    context.persona?.personaCard.filter((s) => s.slug === "persona") ?? [];
  const voiceSections =
    context.persona?.personaCard.filter((s) => s.slug === "voice") ?? [];
  const coreSections = context.persona?.coreKnowledge ?? [];

  // Voice directive prefers an authored `## Voice` section (D5); the plugin-wide
  // `tone` config is the game-level fallback.
  const voiceText = voiceSections.length > 0
    ? renderSections(voiceSections)
    : null;

  return [
    // 1. Identity
    ...SYSTEM_PROMPT_IDENTITY.map((line) => fillSlot(line, slots)),

    // 2. Grounding rules (the "NPC profile" they cite now refers to the card below)
    ...SYSTEM_PROMPT_GROUNDING_RULES,

    // 3. Persona card (## Persona) — who you are
    personaSections.length > 0
      ? `Who you are (persona):\n${renderSections(personaSections)}`
      : null,

    // 4. Core knowledge (rest of your page) — what you always know
    coreSections.length > 0
      ? `What you know (your life and immediate world):\n${renderSections(coreSections)}`
      : null,

    // 4b. Memory (Plan 073.3, D4) — what you remember about THIS player from
    // earlier conversations. Byte-stable within a session (the record is
    // loaded once); empty on a first meeting. Slots after core knowledge and
    // before the voice directive so the cached-half stays stable.
    context.memoryDigest ? context.memoryDigest : null,

    // 5. Voice directive — authored ## Voice wins, else game tone
    voiceText
      ? `Voice: ${voiceText}\nLet this guide word choice, pacing, and warmth — but stay in character.`
      : context.tone
        ? `Tone: ${context.tone}. Let this tone guide word choice, pacing, and warmth — but stay in character.`
        : null
  ];
}

/**
 * The per-turn world-state block, relocated from the system prompt to the user
 * message (Plan 072.4). Phrasings + minimal-greeting gating preserved from the
 * prior user-message block; the quest line (previously only in the system half)
 * is folded in here so nothing is lost.
 */
function buildWorldStateUserLines(
  context: AgentPromptContext
): (string | null)[] {
  const suppress = context.minimalGreetingMode;
  return [
    // Plan 077.1 (D2): world-framed quest context -- NEVER the raw objective
    // title/description (that is the player's private business). Null until
    // the quest-context middleware (077.2) resolves world lore. If present and
    // not in minimal-greeting mode, surface the world fact + the NPC guidance
    // block. The raw activeQuestDisplayName is kept for search seeding only
    // (RetrieveStage) and must never appear here.
    context.questWorldContext && !suppress
      ? `World context right now: ${context.questWorldContext}\nIf this is something you could naturally help with, offer what you would plausibly know in character. Do not act as though you know the player's private business. Do not repeat what has already been said.`
      : null,

    context.currentLocationDisplayName
      ? `Current runtime location: ${context.currentLocationDisplayName}.`
      : null,

    context.currentParentAreaDisplayName && !suppress
      ? `Current containing area: ${context.currentParentAreaDisplayName}.`
      : null,

    context.npcPlayerRelation
      ? `Player/NPC proximity band: ${context.npcPlayerRelation.proximityBand}.`
      : null,

    context.npcCurrentTask && !suppress
      ? `NPC current task: ${context.npcCurrentTask.displayName}.`
      : null,

    context.npcCurrentTask?.description && !suppress
      ? `NPC task context: ${context.npcCurrentTask.description}.`
      : null,

    context.npcCurrentActivity && !suppress
      ? `NPC current activity: ${context.npcCurrentActivity}.`
      : null,

    context.npcCurrentGoal && !suppress
      ? `NPC current goal: ${context.npcCurrentGoal}.`
      : null,

    context.npcMovement && !suppress
      ? `NPC movement status: ${context.npcMovement.status}${context.npcMovement.targetAreaDisplayName ? ` toward ${context.npcMovement.targetAreaDisplayName}` : ""}.`
      : null
  ];
}

// ── Agent mode builder ──

function buildAgentPrompt(context: AgentPromptContext): GeneratePromptResult {
  const systemLines = buildStableSystemLines(context, "agent");

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
      ? "Keep this greeting brief, warm, and simple for a beginner learner. Do not volunteer what the NPC is doing unless asked."
      : null,

    // Relocated from the system prompt (Plan 072.4).
    context.minimalGreetingMode ? MINIMAL_GREETING_INSTRUCTION : null,

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

    // World state (relocated from the system prompt, Plan 072.4).
    ...buildWorldStateUserLines(context),

    // Sugarlang (or other) overlay — opaque, per-turn (relocated from system).
    context.languageLearningOverlay || null,

    context.evidenceSummary.length > 0
      ? `Evidence:\n- ${context.evidenceSummary.join("\n- ")}`
      : "Evidence: none retrieved.",

    context.recentHistory.length > 0
      ? `Recent history:\n${context.recentHistory
          .map((entry) => `${entry.role}: ${entry.text}`)
          .join("\n")}`
      : "Recent history: none.",

    // Plan 072.8 — persona drift reminder, LAST block (after history). Lives in
    // the uncached user half, so it doesn't disturb 072.4 system byte-stability.
    context.personaDigest
      ? `Before you reply, stay in character. Remember who you are:\n${context.personaDigest}`
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
 * Pure function: no side effects, no LLM calls, no annotation reads. The
 * GenerateStage compiles the context; this function just formats it.
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

  return buildAgentPrompt(context);
}
