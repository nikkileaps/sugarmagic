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
  /**
   * What the judge is given to score against: the same text the writer got,
   * from the same build.
   *
   * The judge is asked whether a reply is grounded, so it needs the grounding.
   * It used to be handed a separate, smaller reconstruction -- four lines of
   * persona and the retrieved evidence, with no core knowledge, no memory and
   * no conversation -- and failed true statements as inventions because it had
   * never been told they were true (#185).
   *
   * Composed here rather than by the caller so there is one assembly of this
   * text, not two that can drift apart.
   */
  judgeContext: string;
}

function fillSlot(line: string, slots: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? `{${key}}`);
}

type PersonaSection = { heading: string; slug: string; content: string };

/**
 * One line of the user half, and what kind of line it is.
 *
 * `fact` states something true of the world, the NPC or the conversation.
 * `instruction` tells the writer how to reply this turn.
 *
 * The writer gets both. The judge gets only the facts: a judge shown the brief
 * has been reported to excuse a bad reply because it was told to be brief, and
 * the brief is not evidence of anything anyway. Classification is declared at
 * the point each line is written, so a line added later is classified once and
 * both callers stay correct without a second list to maintain.
 */
type PromptPart = { text: string; kind: "fact" | "instruction" };

const fact = (text: string | null): PromptPart | null =>
  text === null ? null : { text, kind: "fact" };

const instruction = (text: string | null): PromptPart | null =>
  text === null ? null : { text, kind: "instruction" };

function renderParts(parts: (PromptPart | null)[], separator: string): string {
  return parts
    .filter((part): part is PromptPart => part !== null)
    .map((part) => part.text)
    .join(separator);
}

function renderFacts(parts: (PromptPart | null)[], separator: string): string {
  return renderParts(
    parts.filter((part) => part?.kind === "fact"),
    separator
  );
}

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
): (PromptPart | null)[] {
  const slots = {
    npcDisplayName: context.npcDisplayName,
    interactionMode
  };

  const personaSections =
    context.persona?.personaCard.filter((s) => s.slug === "persona") ?? [];
  const voiceSections =
    context.persona?.personaCard.filter((s) => s.slug === "voice") ?? [];
  const coreSections = context.persona?.coreKnowledge ?? [];
  const recoverySections = context.persona?.recoverySections ?? [];

  // Voice directive prefers an authored `## Voice` section (D5); the plugin-wide
  // `tone` config is the game-level fallback.
  const voiceText = voiceSections.length > 0
    ? renderSections(voiceSections)
    : null;

  return [
    // 1. Identity. WHO is speaking is a fact; how the reply must be FORMATTED
    // is not. `SPOKEN_WORDS_ONLY_RULES` is spliced into this block, so the two
    // are separated here rather than in the template.
    fact(fillSlot(SYSTEM_PROMPT_IDENTITY[0] as string, slots)),
    ...SYSTEM_PROMPT_IDENTITY.slice(1).map((line) =>
      instruction(fillSlot(line, slots))
    ),

    // 2. Grounding rules -- a brief for the writer, not facts about the world.
    // WITHHELD FROM THE JUDGE, and this is the pointed case: one of them is
    // "If grounded context is insufficient, ask a clarifying question or say
    // you do not know enough yet", which is an excuse for exactly the refusal
    // recorded in #184. A judge holding that line can wave the refusal through.
    ...SYSTEM_PROMPT_GROUNDING_RULES.map((line) => instruction(line)),

    // 3. Persona card (## Persona) -- who you are
    fact(
      personaSections.length > 0
        ? `Who you are (persona):\n${renderSections(personaSections)}`
        : null
    ),

    // 4. Core knowledge (rest of your page) -- what you always know
    fact(
      coreSections.length > 0
        ? `What you know (your life and immediate world):\n${renderSections(coreSections)}`
        : null
    ),

    // 4a. No-lore fallback: when no persona page is loaded, ground the NPC in
    // their display name and description so the model cannot adopt retrieved
    // world-context (e.g. another character's lore page) as its own identity.
    fact(
      personaSections.length === 0 && coreSections.length === 0 && context.npcDescription
        ? `Who you are: ${context.npcDescription}`
        : null
    ),

    // 4b. Memory (Plan 073.3, D4) -- what you remember about THIS player from
    // earlier conversations. Byte-stable within a session (the record is
    // loaded once); empty on a first meeting. Slots after core knowledge and
    // before the voice directive so the cached-half stays stable.
    fact(context.memoryDigest ? context.memoryDigest : null),

    // 4c. Recovery brief (## Recovery) -- what this character does when it
    // cannot understand the player. An INSTRUCTION, not a fact: it is a brief
    // for the writer, and as a fact the judge would be handed the character's
    // list of moves as though it were something true about the world. Session
    // stable, so it belongs in the cached half.
    instruction(
      recoverySections.length > 0
        ? `When you cannot understand the player:\n${renderSections(recoverySections)}`
        : null
    ),

    // 5. Voice directive -- authored ## Voice wins, else game tone. HOW the
    // character speaks is a fact the judge needs to score IN-CHARACTER; the
    // trailing sentence telling the writer to be guided by it is not, but it
    // rides along rather than splitting one authored block in two.
    fact(
      voiceText
        ? `Voice: ${voiceText}\nLet this guide word choice, pacing, and warmth — but stay in character.`
        : context.tone
          ? `Tone: ${context.tone}. Let this tone guide word choice, pacing, and warmth — but stay in character.`
          : null
    )
  ];
}

/**
 * The line that introduces the quest world-context block.
 *
 * It names the lore page the text was quoted from and, when that page is
 * somebody else's, says so. Without this the block reads as an unattributed
 * statement about the present world, and an NPC handed a page written about
 * another character speaks as that character (#171).
 */
function worldContextHeading(context: AgentPromptContext): string {
  const title = context.questWorldContextTitle;
  if (context.questWorldContextIsOwnPage) {
    return title
      ? `Background about the world, from your own lore page "${title}":`
      : "Background about the world, from your own lore page:";
  }
  const source = title ? `the lore page "${title}"` : "a lore page";
  return `Background about the world, from ${source}. This page is not about you -- do not speak as its subject or take its details as your own:`;
}

/**
 * The per-turn world-state block, relocated from the system prompt to the user
 * message (Plan 072.4). Phrasings + minimal-greeting gating preserved from the
 * prior user-message block; the quest line (previously only in the system half)
 * is folded in here so nothing is lost.
 */
function buildWorldStateUserLines(
  context: AgentPromptContext
): (PromptPart | null)[] {
  const suppress = context.minimalGreetingMode;
  return [
    // Plan 077.1 (D2): world-framed quest context -- NEVER the raw objective
    // title/description (that is the player's private business). Null until
    // the quest-context middleware (077.2) resolves world lore. If present and
    // not in minimal-greeting mode, surface the world fact + the NPC guidance
    // block. The raw activeQuestDisplayName is kept for search seeding only
    // (RetrieveStage) and must never appear here.
    fact(
      context.questWorldContext && !suppress
        ? `${worldContextHeading(context)}\n${context.questWorldContext}\nIf this is something you could naturally help with, offer what you would plausibly know in character. Do not act as though you know the player's private business. Do not repeat what has already been said.`
        : null
    ),

    // Plan 077.3 (D4): coarse ease-off hint. goalSurfacedCount counts PROMPTING
    // (not saying), so > 0 means at least one NPC turn already steered toward
    // this topic. The player has had a chance to find it; be more subtle.
    instruction(
      context.questWorldContext && !suppress &&
      typeof context.goalSurfacedCount === "number" &&
      context.goalSurfacedCount > 0
        ? `This topic has been brought up in conversation ${context.goalSurfacedCount} time(s) already. If another character has already offered guidance on this, let the player discover it without repeating the nudge. You can acknowledge the topic if the player raises it, but do not volunteer the same information again.`
        : null
    ),

    fact(
      context.timeOfDay
        ? `Time of day: ${context.timeOfDay}.`
        : null
    ),

    fact(
      context.knownFacts && context.knownFacts.length > 0
        ? `The player already knows:\n${context.knownFacts.map((f) => `- ${f}`).join("\n")}`
        : null
    ),

    fact(
      context.recentWorldEvents && context.recentWorldEvents.length > 0
        ? `Recent world events:\n${context.recentWorldEvents.map((e) => `- ${e}`).join("\n")}`
        : null
    ),

    fact(
      context.currentLocationDisplayName
        ? `Current runtime location: ${context.currentLocationDisplayName}.`
        : null
    ),

    fact(
      context.currentParentAreaDisplayName && !suppress
        ? `Current containing area: ${context.currentParentAreaDisplayName}.`
        : null
    ),

    fact(
      context.npcPlayerRelation
        ? `Player/NPC proximity band: ${context.npcPlayerRelation.proximityBand}.`
        : null
    ),

    fact(
      context.npcCurrentTask && !suppress
        ? `NPC current task: ${context.npcCurrentTask.displayName}.`
        : null
    ),

    fact(
      context.npcCurrentTask?.description && !suppress
        ? `NPC task context: ${context.npcCurrentTask.description}.`
        : null
    ),

    fact(
      context.npcCurrentActivity && !suppress
        ? `NPC current activity: ${context.npcCurrentActivity}.`
        : null
    ),

    fact(
      context.npcCurrentGoal && !suppress
        ? `NPC current goal: ${context.npcCurrentGoal}.`
        : null
    ),

    fact(
      context.npcMovement && !suppress
        ? `NPC movement status: ${context.npcMovement.status}${context.npcMovement.targetAreaDisplayName ? ` toward ${context.npcMovement.targetAreaDisplayName}` : ""}.`
        : null
    )
  ];
}

// ── Agent mode builder ──

function buildAgentPrompt(context: AgentPromptContext): GeneratePromptResult {
  const systemParts = buildStableSystemLines(context, "agent");

  const userParts: (PromptPart | null)[] = [
    instruction(
      context.minimalGreetingMode
        ? "Reply in exactly 1 short sentence. Use at most 2 very short sentences only if absolutely necessary."
        : "Respond to the player naturally, matching the tone and length to the conversation."
    ),

    instruction(`Intent: ${context.responseIntent}.`),
    instruction(`Turn path: ${context.turnPath}.`),
    instruction(`Interpret intent: ${context.interpretIntent}.`),
    instruction(`Goal: ${context.responseGoal}`),

    // The one slot whose kind depends on which branch is taken: what the player
    // said is the central fact of the turn, while its absence is an instruction
    // about how to open.
    context.playerText
      ? fact(`Player said: ${context.playerText}`)
      : instruction(
          "This is the opening turn. Open with a brief, warm greeting -- 1 to 2 sentences. Leave room for the player to respond before you elaborate."
        ),

    instruction(
      context.minimalGreetingMode
        ? "Keep this greeting brief, warm, and simple for a beginner learner. Do not volunteer what the NPC is doing unless asked."
        : null
    ),

    // Relocated from the system prompt (Plan 072.4).
    instruction(context.minimalGreetingMode ? MINIMAL_GREETING_INSTRUCTION : null),

    instruction(
      context.responseIntent === "clarify"
        ? "Ask one concise clarifying question. Do not answer beyond what is grounded."
        : null
    ),

    // TWO DIFFERENT REFUSALS, and the wording is not interchangeable.
    //
    // "I need more context" invites the player to explain. "I have never heard
    // of it" closes the subject. Sending the first when the NPC has simply
    // never heard of the thing produced a flat, canned-sounding reply that
    // contradicted the goal line directly above it (#184).
    instruction(
      context.responseIntent !== "abstain"
        ? null
        : (context.unknownNamedEntities?.length ?? 0) > 0
          ? "Say plainly, in your own voice, that this is not something you have ever heard of. Do not describe it, guess at it, place it, or invent anything you have heard about it. Do not ask the player to explain it to you. You may offer what you do know instead."
          : "State clearly that you do not know enough grounded information to answer yet. Invite the player to provide more context. Do not fabricate."
    ),

    instruction(
      context.responseIntent === "chat"
        ? "Respond as natural in-character social speech. Warmth is allowed. Do not turn a social reply into a factual worldbuilding answer."
        : null
    ),

    // The character has already asked once and got nowhere. `Goal:` above says
    // what this particular move is; this says what all of them have in common,
    // which is that asking again is off the table.
    instruction(
      context.responseIntent === "recover"
        ? "You have already asked once what they meant and it did not land. Do not ask again, and do not say you did not understand. Make the move above, in your own voice, and carry the conversation yourself."
        : null
    ),

    instruction(
      context.responseSpecificity === "grounded"
        ? "Use grounded evidence when present, but do not add unsupported specifics."
        : "Keep the reply generic, in-character, and low-specificity."
    ),

    // World state (relocated from the system prompt, Plan 072.4).
    ...buildWorldStateUserLines(context),

    // Sugarlang (or other) overlay -- opaque, per-turn (relocated from system).
    // A directive to the writer about how to phrase the reply, not a fact about
    // the world. A language plugin tells the judge what it needs to know
    // separately, through judgeDirectives on the contribution bus.
    instruction(context.languageLearningOverlay || null),

    fact(
      context.loreContextSummary.length > 0
        ? `Evidence:\n- ${context.loreContextSummary.join("\n- ")}`
        : "Evidence: none retrieved."
    ),

    fact(
      context.recentHistory.length > 0
        ? `Recent history:\n${context.recentHistory
            .map((entry) => `${entry.role}: ${entry.text}`)
            .join("\n")}`
        : "Recent history: none."
    ),

    // 083.5 -- constraint reminder, terminal slot (before personaDigest).
    instruction(context.constraintReminder || null),

    // Plan 072.8 -- persona drift reminder, LAST block (after history). Lives in
    // the uncached user half, so it doesn't disturb 072.4 system byte-stability.
    // An instruction: it re-states persona the judge already holds in the system
    // half, wrapped in a "stay in character" nudge meant for the writer.
    instruction(
      context.personaDigest
        ? `Before you reply, stay in character. Remember who you are:\n${context.personaDigest}`
        : null
    )
  ];

  const systemPrompt = renderParts(systemParts, "\n");
  const userPrompt = renderParts(userParts, "\n\n");

  return {
    systemPrompt,
    userPrompt,
    // FACTS ONLY, FROM BOTH HALVES. The system half is not all facts: it
    // carries the formatting rules and the five grounding rules, which are a
    // brief for the writer. Passing it through whole was the first version of
    // this and it leaked about ten instruction lines to the judge.
    //
    // A judge shown the brief can excuse a bad reply on the grounds that it was
    // told to be brief, or generic, or to abstain, and the brief is not
    // evidence the reply could be checked against.
    judgeContext: `${renderFacts(systemParts, "\n")}\n\n${renderFacts(userParts, "\n\n")}`
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
