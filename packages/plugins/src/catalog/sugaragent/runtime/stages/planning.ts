import type { ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import type {
  InterpretResult,
  PlanNoveltyState,
  PlanResult,
  SugarAgentSessionHistoryEntry
} from "../types";

export interface PlanDecision {
  responseIntent: PlanResult["responseIntent"];
  /** Present only when the abstain is caused by an unrecognised name (#184). */
  unknownNamedEntities?: string[];
  responseSpecificity: PlanResult["responseSpecificity"];
  responseGoal: string;
  initiativeAction: PlanResult["initiativeAction"];
  replyInputMode: ConversationTurnEnvelope["inputMode"];
  replyPlaceholder: string;
  noveltyState: PlanNoveltyState;
}

function normalizeForComparison(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}

export function computePlanNoveltyState(
  history: SugarAgentSessionHistoryEntry[],
  userText: string | null
): PlanNoveltyState {
  const normalizedUserText = userText ? normalizeForComparison(userText) : "";
  const allUserTurns = history
    .filter((entry) => entry.role === "user")
    .map((entry) => normalizeForComparison(entry.text));
  // The current user turn has already been appended to history before planning,
  // so novelty should compare against only the prior user turns.
  const priorUserTurns = allUserTurns.slice(0, -1);
  const recentUserTurns = priorUserTurns.slice(-3);
  const recentAssistantTurns = history
    .filter((entry) => entry.role === "assistant")
    .slice(-3)
    .map((entry) => normalizeForComparison(entry.text));
  const repeatedUserMessage =
    normalizedUserText.length > 0 &&
    recentUserTurns.some((entry) => entry.length > 0 && entry === normalizedUserText);
  const recentAssistantQuestionCount = recentAssistantTurns.reduce(
    (count, entry) =>
      entry.includes("?") ||
      /\b(what|where|when|why|how|who|which)\b/.test(entry)
        ? count + 1
        : count,
    0
  );
  const repeatedAssistantReplyRisk =
    recentAssistantTurns.length >= 2 &&
    new Set(recentAssistantTurns.filter(Boolean)).size <= 1;

  return {
    repeatedUserMessage,
    repeatedAssistantReplyRisk,
    exhausted: repeatedUserMessage && repeatedAssistantReplyRisk,
    recentAssistantQuestionCount
  };
}


// Articles in both languages the game speaks. A name reduced to one word by
// this is discarded, not kept.
const LEADING_ARTICLES = new Set([
  "the", "a", "an", "el", "la", "los", "las", "un", "una"
]);

// Drops a positional capital. One word left is not enough to be confident, so
// the candidate goes entirely rather than risk refusing something real.
function dropFirstWord(name: string): string | null {
  const rest = name.split(/\s+/).slice(1);
  return rest.length > 1 ? rest.join(" ") : null;
}

function stripLeadingArticle(name: string): string | null {
  const words = name.split(/\s+/);
  if (words.length > 1 && LEADING_ARTICLES.has((words[0] ?? "").toLowerCase())) {
    const rest = words.slice(1);
    return rest.length > 1 ? rest.join(" ") : null;
  }
  return name;
}

/**
 * Names in the player's message that nothing in reality recognises (#184).
 *
 * MULTI-WORD CAPITALISED NAMES ONLY, and that narrowness is the point. A false
 * positive here makes an NPC refuse something it knows, which is the bug this
 * ticket opened for; a false negative just leaves today's behaviour. So this
 * fires only on the shape it is confident about -- "Brindlewick Observatory",
 * "Gilded Teacup", "Rackwick City" -- and deliberately ignores single words,
 * where "Spanish", "Okay" and the player's own name would all be candidates.
 *
 * A capital owed to POSITION is discounted. "Hola Finnick" is a greeting plus
 * the NPC's own name, and reading it as one unknown proper noun made an NPC
 * deny having heard of being greeted -- observed in play. The first word of a
 * sentence is therefore dropped before matching, and a candidate reduced to a
 * single word is discarded.
 *
 * `corpus` is what reality supplied: the NPC's page, the retrieved evidence,
 * the quest context, the NPC's own name, its persisted memory, and names the
 * player has given for THEMSELVES. Not the conversation -- see plan-stage.md.
 */
export function findUnrecognisedNames(
  playerText: string | null,
  corpus: string
): string[] {
  if (!playerText) return [];
  const haystack = corpus.toLowerCase();

  // Where each sentence begins, so a capital owed to POSITION is not mistaken
  // for a capital owed to being a name.
  const sentenceStarts = new Set<number>();
  const boundary = /(^|[.!?¿¡]\s*|\n\s*)/g;
  for (let m = boundary.exec(playerText); m; m = boundary.exec(playerText)) {
    sentenceStarts.add(m.index + m[0].length);
    if (boundary.lastIndex === m.index) boundary.lastIndex++;
  }

  const pattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const unrecognised: string[] = [];
  for (let m = pattern.exec(playerText); m; m = pattern.exec(playerText)) {
    let name: string | null = m[0];
    // "Hola Finnick" -- the greeting is capitalised because it opens the
    // sentence, and the NPC's own name follows. Reading that as one unknown
    // proper noun made an NPC deny having heard of being greeted (#184).
    if (sentenceStarts.has(m.index)) name = dropFirstWord(name);
    // "The Gilded Teacup" and "Gilded Teacup" must be one name, not two.
    if (name) name = stripLeadingArticle(name);
    if (!name) continue;
    if (!haystack.includes(name.toLowerCase())) unrecognised.push(name);
  }
  return [...new Set(unrecognised)];
}

function resolveResponseGoal(
  responseIntent: PlanResult["responseIntent"],
  unknownNamedEntities: string[] = []
): string {
  // Refusing because a name is unrecognised is a different refusal from
  // refusing for want of context, and the reply reads differently: "never heard
  // of it" instead of "tell me more". Naming the thing is what stops the NPC
  // hedging about it and then inventing hearsay anyway.
  if (responseIntent === "abstain" && unknownNamedEntities.length > 0) {
    const names = unknownNamedEntities.join(", ");
    return (
      `You have never heard of ${names}. Say so plainly and in character. ` +
      `Do not describe it, guess at it, place it, or repeat anything you have been told about it -- ` +
      `you know nothing about it at all. Offer what you do know instead if it fits.`
    );
  }
  const responseGoalByIntent: Record<PlanResult["responseIntent"], string> = {
    greet: "Open the conversation naturally while staying in character.",
    chat:
      "Respond socially and in character without inventing unsupported world facts.",
    answer: "Respond as the NPC in a grounded, concise, in-world voice.",
    redirect:
      "Keep the player aligned with the active story context while staying conversational.",
    goodbye: "Close the interaction cleanly and in character.",
    clarify: "Ask a concise clarifying question before committing to a grounded answer.",
    abstain:
      "State clearly that there is not enough grounded information to answer yet and invite the player to provide more context."
  };
  return responseGoalByIntent[responseIntent];
}

function resolveInitiativeAction(
  responseIntent: PlanResult["responseIntent"],
  shouldCloseAfterReply: boolean
): PlanResult["initiativeAction"] {
  if (shouldCloseAfterReply || responseIntent === "goodbye") return "close";
  if (responseIntent === "clarify") return "clarify";
  if (responseIntent === "abstain") return "abstain";
  if (responseIntent === "greet") return "npc_initiate";
  return "player_respond";
}

function resolveReplyInputMode(
  initiativeAction: PlanResult["initiativeAction"]
): ConversationTurnEnvelope["inputMode"] {
  return initiativeAction === "close" ? "advance" : "free_text";
}

function resolveReplyPlaceholder(
  initiativeAction: PlanResult["initiativeAction"],
  npcDisplayName: string | null | undefined
): string {
  if (initiativeAction === "close") return "";
  return `Reply to ${npcDisplayName ?? "the NPC"}...`;
}

export function resolvePlanDecision(input: {
  interpret: InterpretResult;
  hasEvidence: boolean;
  /** Plan 073.3 — a remembered record with a prior meeting exists. Memory
   *  grounds recall answers and repeat-visit greetings (the digest is in the
   *  system prompt), so those turns answer instead of abstaining / staying
   *  generic. */
  hasMemory?: boolean;
  /**
   * #184 -- the NPC's own lore page loaded and has content. Loaded once at
   * session start, in every prompt thereafter, and previously invisible to
   * this decision: it asked only whether retrieval found something and whether
   * there was memory, and an NPC's own life is neither.
   */
  hasPersonaPage?: boolean;
  /**
   * #184 -- names the player used that nothing in reality recognises: not the
   * NPC's page, not the retrieved evidence, not the quest context, not the
   * conversation. The wiki, the quest and the scene ARE reality here, so a name
   * none of them knows is a name for something that does not exist.
   *
   * Kept separate from `hasEvidence` deliberately. That flag answers "did the
   * search return rows", which is a different question from "is the thing the
   * player named real", and collapsing the two is what let an NPC's own page
   * vouch for a building invented in a test.
   */
  unknownNamedEntities?: string[];
  hasActiveQuest: boolean;
  /** Plan 077.1 -- the quest-context middleware (077.2) resolved world-framed
   *  lore for the active objective. When true, quest context is in the user
   *  message and grounds the turn (routes to the LLM), preventing generic-only
   *  fallback. False in 077.1 (middleware not yet wired); 077.2 sets it. */
  hasQuestWorldContext?: boolean;
  hasScriptedFollowup: boolean;
  npcDisplayName: string | null | undefined;
  history: SugarAgentSessionHistoryEntry[];
}): PlanDecision {
  const noveltyState = computePlanNoveltyState(
    input.history,
    input.interpret.userText
  );
  const {
    interpretation,
    pendingExpectation,
    turnRouting,
    shouldCloseAfterReply,
    userText
  } = input.interpret;

  let responseIntent: PlanResult["responseIntent"] = "answer";

  // Plan 073.3 — memory counts as grounding for a recall question ("do you
  // remember me?") and for the opening greeting of a repeat visit (so the NPC
  // greets as an acquaintance rather than a stranger). The digest is already
  // in the system prompt; these turns just need to route to the LLM as
  // grounded rather than abstain / generic-only.
  const memoryGrounds = Boolean(
    input.hasMemory &&
      (!userText || interpretation.intent === "session_recall")
  );

  // #184 -- what the NPC knows about ITSELF and its own world. Retrieval
  // deliberately leaves the NPC's own page out of the evidence pack when the
  // persona loaded (RetrieveStage `excludeOwnPage`), precisely because it is
  // already in the prompt -- so `hasEvidence` can never speak for it, and an
  // empty search read as "knows nothing" while the page said otherwise.
  //
  // Covers questions about the NPC and about the world, not about OTHER
  // characters: a page usually says nothing about them, and refusing is the
  // honest answer there. Recall stays with memory -- a page cannot say whether
  // you have met.
  //
  // The two names below are Interpret's current vocabulary. #187 may replace
  // it; this list moves with it, and an unrecognised name fails here loudly
  // rather than silently defaulting to grounded.
  const namedSomethingUnreal = (input.unknownNamedEntities?.length ?? 0) > 0;

  const personaGrounds = Boolean(
    input.hasPersonaPage &&
      (interpretation.intent === "identity_self" ||
        interpretation.intent === "lore_world")
  );

  // Plan 077.1 (D2/D3) -- when the quest-context middleware (077.2) has
  // resolved world-framed lore for the active objective, that context is in
  // the user message. The turn is grounded so the LLM can naturally voice it;
  // without it, generic-only fallback is unchanged.
  const questGrounds = Boolean(
    input.hasQuestWorldContext && input.hasActiveQuest
  );

  if (!userText) {
    responseIntent = "greet";
  } else if (shouldCloseAfterReply) {
    responseIntent = "goodbye";
  } else if (namedSomethingUnreal) {
    // ABOVE THE LADDER, NOT INSIDE ONE BRANCH.
    //
    // This began as a sub-clause of the knowledge branch, so any turn landing
    // elsewhere skipped it -- and that is not rare. `pendingExpectation` is
    // derived from the NPC's PREVIOUS reply and feeds back into Interpret, so
    // an identical player message reaches a different branch depending on what
    // the NPC happened to say last turn.
    //
    // Observed live 2026-08-16: the same question about a shop that does not
    // exist routed to `clarify` instead, and the NPC answered "that name's
    // ringing a bell, but like, faintly".
    responseIntent = "abstain";
  } else if (interpretation.intent === "quest_guidance") {
    responseIntent =
      input.hasEvidence || input.hasActiveQuest || input.hasScriptedFollowup
        ? "redirect"
        : "clarify";
  } else if (turnRouting.path === "social_fast") {
    responseIntent = "chat";
  } else if (
    interpretation.intent === "unclear" ||
    pendingExpectation.kind === "clarify"
  ) {
    responseIntent = "clarify";
  } else if (
    interpretation.intent === "identity_self" ||
    interpretation.intent === "lore_world" ||
    interpretation.intent === "lore_other" ||
    interpretation.intent === "session_recall"
  ) {
    // Is there anything to answer FROM -- the search, memory, or the NPC's own
    // page? Whether the player named something REAL is settled above the
    // ladder, because it is a fact about the message rather than about which
    // conversational shape this turn happens to take.
    //
    // The first pass of #184 had only this question, so the NPC's page vouched
    // for a building that appears nowhere (measured 2026-08-16: claimed to have
    // visited it in 16 of 20 replies).
    responseIntent =
      input.hasEvidence || memoryGrounds || personaGrounds ? "answer" : "abstain";
  }

  if (
    !input.hasEvidence &&
    noveltyState.exhausted &&
    responseIntent !== "goodbye" &&
    responseIntent !== "redirect"
  ) {
    responseIntent = "clarify";
  }

  // Plan 073.3 / 077.1 -- memoryGrounds and questGrounds are grounding sources
  // alongside evidence. A remembered greeting/recall answer, or a turn where
  // the quest-context middleware surfaced world lore, routes to the LLM as
  // "grounded" rather than the deterministic "generic-only" short-circuit.
  const responseSpecificity: PlanResult["responseSpecificity"] =
    !input.hasEvidence &&
    !memoryGrounds &&
    !questGrounds &&
    (
      responseIntent === "greet" ||
      responseIntent === "chat" ||
      responseIntent === "answer"
    )
      ? "generic-only"
      : "grounded";

  const initiativeAction = resolveInitiativeAction(
    responseIntent,
    shouldCloseAfterReply
  );

  return {
    responseIntent,
    responseSpecificity,
    responseGoal: resolveResponseGoal(responseIntent, input.unknownNamedEntities ?? []),
    ...(namedSomethingUnreal && responseIntent === "abstain"
      ? { unknownNamedEntities: input.unknownNamedEntities ?? [] }
      : {}),
    initiativeAction,
    replyInputMode: resolveReplyInputMode(initiativeAction),
    replyPlaceholder: resolveReplyPlaceholder(
      initiativeAction,
      input.npcDisplayName
    ),
    noveltyState
  };
}
