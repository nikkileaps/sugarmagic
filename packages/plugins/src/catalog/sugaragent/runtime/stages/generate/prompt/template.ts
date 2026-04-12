/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/template.ts
 *
 * Purpose: Documents the ideal prompt structure for NPC dialogue generation.
 *          The builder uses this template to construct prompts from a typed context.
 *
 * The template is split into system prompt (who the NPC is, what constraints
 * apply) and user prompt (what's happening right now, what to say).
 *
 * ## System Prompt Structure
 *
 * 1. IDENTITY — who the NPC is and output format rules
 * 2. GROUNDING RULES — what the NPC can and cannot claim
 * 3. WORLD STATE — location, quest, NPC behavior (omitted in minimal mode)
 * 4. PLUGIN OVERLAY — language learning constraints (opaque, optional)
 *
 * ## User Prompt Structure
 *
 * 1. RESPONSE DIRECTIVE — how to respond (tone, length, intent)
 * 2. MOMENT CONTEXT — what the player said, spatial context
 * 3. EVIDENCE — retrieved grounded knowledge
 * 4. HISTORY — recent conversation turns
 *
 * Exports:
 *   - SYSTEM_PROMPT_IDENTITY
 *   - SYSTEM_PROMPT_GROUNDING_RULES
 *   - MINIMAL_GREETING_INSTRUCTION
 *
 * Status: active
 */

/**
 * Core NPC identity and output format rules. Always present.
 * Slot: {npcDisplayName}, {interactionMode}
 */
export const SYSTEM_PROMPT_IDENTITY = [
  "Speak as {npcDisplayName}.",
  "Return only the NPC's spoken words.",
  "Do not include stage directions, action narration, scene description, asterisks, bracketed cues, or quoted dialogue wrappers.",
  "Interaction mode: {interactionMode}."
] as const;

/**
 * Grounding rules that prevent hallucination. Always present.
 */
export const SYSTEM_PROMPT_GROUNDING_RULES = [
  "Use only the provided evidence, quest context, NPC profile, and recent history as grounded context for this turn.",
  "Do not introduce institutions, locations, factions, setting names, or world facts that are not supported by that grounded context.",
  "If grounded context is insufficient, ask a clarifying question or say you do not know enough yet.",
  'Do not use deictic spatial claims like "here", "inside", "outside", "at my shop", or "in this room" unless grounded runtime location supports them.',
  "If the NPC is associated with another place but is not currently there, describe that place as elsewhere or nearby rather than as the current location."
] as const;

/**
 * Instruction injected in minimal greeting mode to suppress detail.
 */
export const MINIMAL_GREETING_INSTRUCTION =
  "This is a first-meeting beginner greeting turn. Keep it tiny, warm, and low-specificity. Do not volunteer task details, quest details, location trivia, or backstory unless the player asks.";
