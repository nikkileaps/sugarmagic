import type { ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import type {
  InterpretResult,
  PlanNoveltyState,
  PlanResult,
  SugarAgentSessionHistoryEntry
} from "../types";

export interface PlanDecision {
  responseIntent: PlanResult["responseIntent"];
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

function resolveResponseGoal(
  responseIntent: PlanResult["responseIntent"]
): string {
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
    responseIntent = input.hasEvidence || memoryGrounds ? "answer" : "abstain";
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
    responseGoal: resolveResponseGoal(responseIntent),
    initiativeAction,
    replyInputMode: resolveReplyInputMode(initiativeAction),
    replyPlaceholder: resolveReplyPlaceholder(
      initiativeAction,
      input.npcDisplayName
    ),
    noveltyState
  };
}
