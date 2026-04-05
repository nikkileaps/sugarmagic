import type {
  InterpretResult,
  PendingExpectation,
  QueryFacet,
  SocialMove,
  SugarAgentProviderState,
  TurnInterpretation,
  TurnRoutingDecision
} from "../types";

const GREETING_PATTERNS = [
  /^(hi|hello|hey|howdy)\b/i,
  /^(good morning|good afternoon|good evening)\b/i
];
const GRATITUDE_PATTERN = /\b(thanks|thank you|appreciate it)\b/i;
const ACKNOWLEDGEMENT_PATTERN = /^(yeah|yep|yup|okay|ok|sure|alright|all right|nice|cool|sweet|awesome|got it|makes sense|fair enough)\b/i;
const SMALLTALK_PATTERN =
  /\b(how are you|how's it going|how is it going|how have you been|what's up|what is up|you doing okay|are you okay)\b/i;
const INTRODUCTION_PATTERNS = [
  /\bmy name is\s+([a-z\u00c0-\u024f' -]{2,40})\b/i,
  /^(?:i am|i'm)\s+([a-z\u00c0-\u024f' -]{2,40})(?:[,.!?;:]|$)/i
];
const FAREWELL_PATTERN = /\b(bye|goodbye|farewell|see you|later|talk later|until next time)\b/i;
const QUEST_PATTERN =
  /\b(quest|objective|what should i do|what am i supposed to do|what now|help me with this quest|help with this quest)\b/i;
const RECALL_PATTERN =
  /\b(remember me|have we met|did we meet|last time|before|earlier|you said|you told me)\b/i;
const KNOWLEDGE_PATTERN =
  /\b(who|what|when|where|why|how|tell me about|know about|know anything about|looking for|find|where can i find|where is|who is|what is)\b/i;
const SELF_PATTERN =
  /\b(who are you|what(?:'s| is) your name|your name|what do you do|what(?:'s| is) your job|where do you work|what are you doing|what are you up to|where are you|where are you from|tell me about yourself|about yourself|your background|your past|do you remember me|have we met|did we meet)\b/i;
const LOCATION_PATTERN =
  /\b(where are we|where am i|where are you|where is this|this place|that place|cargo bay|station|office|terminal|dock|gate|room)\b/i;
const BACKGROUND_PATTERN = /\b(background|past|family|where are you from|about yourself)\b/i;
const PREFERENCE_PATTERN =
  /\b(favorite|like|love|hate|prefer|do you like|do you love|do you hate|do you prefer|what do you like|what do you prefer)\b/i;
const OCCUPATION_PATTERN =
  /\b(what do you do|what(?:'s| is) your job|job|work|occupation|for a living|where do you work)\b/i;
const CURRENT_ACTIVITY_PATTERN =
  /\b(what are you doing|what are you up to|doing right now|up to right now)\b/i;
const GENERAL_LORE_PATTERN =
  /\b(tell me about|know about|know anything about|history|origin|founded|founder|founding|established|culture)\b/i;

function normalizeMessage(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLower(text: unknown): string {
  return normalizeMessage(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s'!?-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDeclaredName(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z\u00c0-\u024f' -]+/gi, "")
    .trim();
}

function capitalizeName(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function hasQuestGuidanceCue(inputText: string | null): boolean {
  if (!inputText) return false;
  return QUEST_PATTERN.test(inputText);
}

export function hasLikelyQuestionForm(inputText: string | null): boolean {
  if (!inputText) return false;
  if (inputText.includes("?")) return true;
  return /^(what|when|where|who|why|how|do|did|can|could|would|will|have|has|is|are)\b/i.test(
    inputText.trim()
  );
}

export function extractDeclaredIdentityName(inputText: string | null): string | null {
  if (!inputText) return null;
  for (const pattern of INTRODUCTION_PATTERNS) {
    const match = inputText.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeDeclaredName(match[1]);
    if (!normalized) continue;
    return capitalizeName(normalized);
  }
  return null;
}

function detectSocialMove(inputText: string | null): SocialMove {
  if (!inputText) return "greeting";
  if (FAREWELL_PATTERN.test(inputText)) return "farewell";
  if (extractDeclaredIdentityName(inputText)) return "introduction";
  if (GREETING_PATTERNS.some((pattern) => pattern.test(inputText))) return "greeting";
  if (GRATITUDE_PATTERN.test(inputText) || ACKNOWLEDGEMENT_PATTERN.test(inputText)) {
    return "acknowledgement";
  }
  if (SMALLTALK_PATTERN.test(inputText)) return "smalltalk";
  return "none";
}

function inferFacet(inputText: string | null): QueryFacet {
  if (!inputText) return "unknown";
  if (SELF_PATTERN.test(inputText)) {
    if (OCCUPATION_PATTERN.test(inputText)) return "occupation";
    if (CURRENT_ACTIVITY_PATTERN.test(inputText)) return "current_activity";
    if (LOCATION_PATTERN.test(inputText)) return "location";
    if (BACKGROUND_PATTERN.test(inputText)) return "background";
    if (PREFERENCE_PATTERN.test(inputText)) return "preference";
    if (RECALL_PATTERN.test(inputText)) return "relationship";
    return "identity";
  }
  if (OCCUPATION_PATTERN.test(inputText)) return "occupation";
  if (CURRENT_ACTIVITY_PATTERN.test(inputText)) return "current_activity";
  if (LOCATION_PATTERN.test(inputText) || /\b(looking for|find|where can i find)\b/i.test(inputText)) {
    return "location";
  }
  if (BACKGROUND_PATTERN.test(inputText)) return "background";
  if (PREFERENCE_PATTERN.test(inputText)) return "preference";
  if (RECALL_PATTERN.test(inputText)) return "relationship";
  if (GENERAL_LORE_PATTERN.test(inputText)) return "general_lore";
  return "unknown";
}

function inferTimeframe(inputText: string | null) {
  if (!inputText) return "unknown" as const;
  const normalized = normalizeLower(inputText);
  if (/\b(yesterday|before|earlier|last time|used to|was|were|did)\b/.test(normalized)) {
    return "past" as const;
  }
  if (/\b(right now|currently|now)\b/.test(normalized)) {
    return "current" as const;
  }
  if (/\b(will|going to|later|tomorrow|next)\b/.test(normalized)) {
    return "future" as const;
  }
  if (/\b(always|usually|normally|tend to|often)\b/.test(normalized)) {
    return "habitual" as const;
  }
  return "unknown" as const;
}

export function detectPendingExpectation(
  state: SugarAgentProviderState
): PendingExpectation {
  const lastAssistantTurn = [...state.history]
    .reverse()
    .find((entry) => entry.role === "assistant");
  if (!lastAssistantTurn) {
    return { kind: "none" };
  }

  const normalized = normalizeLower(lastAssistantTurn.text);
  if (!normalized.includes("?")) {
    return { kind: "none" };
  }
  if (/\b(your name|what(?:'s| is) your name|who are you)\b/.test(normalized)) {
    return { kind: "answer_name" };
  }
  if (/^(is|are|do|did|can|could|would|will|have|has)\b/.test(normalized)) {
    return { kind: "confirm" };
  }
  if (/\b(what do you mean|clarify|which one|which|what exactly)\b/.test(normalized)) {
    return { kind: "clarify" };
  }
  return { kind: "answer_question" };
}

export function interpretPlayerTurn(input: {
  userText: string | null;
  npcDefinitionId: string | null | undefined;
  npcDisplayName: string | null | undefined;
  pendingExpectation: PendingExpectation;
}): Omit<InterpretResult, "pendingExpectation"> {
  const userText = input.userText;
  const focusText =
    normalizeMessage(userText) ||
    `${input.npcDisplayName ?? "NPC"} conversation context`;
  const socialMove = detectSocialMove(userText);
  const declaredIdentityName = extractDeclaredIdentityName(userText);
  const hasFarewellCue = socialMove === "farewell";
  const hasQuestCue = hasQuestGuidanceCue(userText);
  const hasQuestionCue = hasLikelyQuestionForm(userText);
  const hasKnowledgeCue = Boolean(userText && KNOWLEDGE_PATTERN.test(userText));
  const hasRecallCue = Boolean(userText && RECALL_PATTERN.test(userText));
  const hasSelfCue = Boolean(userText && SELF_PATTERN.test(userText));
  const hasSocialCue = socialMove !== "none";
  const facet = inferFacet(userText);
  const timeframe = inferTimeframe(userText);

  let interpretation: TurnInterpretation;
  if (!userText) {
    interpretation = {
      intent: "social_chat",
      lane: "social",
      target: "unknown",
      facet: "unknown",
      timeframe: "unknown",
      socialMove: "greeting",
      declaredIdentityName: null,
      focusText,
      confidence: 1,
      margin: 1,
      ambiguous: false
    };
  } else if (hasFarewellCue) {
    interpretation = {
      intent: "farewell",
      lane: "social",
      target: "unknown",
      facet: "unknown",
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.96,
      margin: 0.6,
      ambiguous: false
    };
  } else if (hasQuestCue) {
    interpretation = {
      intent: "quest_guidance",
      lane: "knowledge",
      target: "mixed",
      facet: "general_lore",
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.88,
      margin: 0.4,
      ambiguous: false
    };
  } else if (
    input.pendingExpectation.kind === "answer_name" &&
    userText.length <= 48 &&
    !hasQuestionCue
  ) {
    interpretation = {
      intent: "social_chat",
      lane: "social",
      target: "unknown",
      facet: "identity",
      timeframe: "current",
      socialMove: declaredIdentityName ? "introduction" : "acknowledgement",
      declaredIdentityName,
      focusText,
      confidence: 0.84,
      margin: 0.3,
      ambiguous: false
    };
  } else if (hasSocialCue && !hasKnowledgeCue && !hasRecallCue) {
    interpretation = {
      intent: "social_chat",
      lane: "social",
      target: "unknown",
      facet: socialMove === "introduction" ? "relationship" : "unknown",
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.82,
      margin: 0.26,
      ambiguous: false
    };
  } else if (hasRecallCue) {
    interpretation = {
      intent: "session_recall",
      lane: "memory",
      target: "self",
      facet: "relationship",
      timeframe: "past",
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.78,
      margin: 0.24,
      ambiguous: false,
      primaryReferent: input.npcDefinitionId
        ? {
            id: input.npcDefinitionId,
            text: input.npcDisplayName ?? "NPC",
            kind: "npc",
            confidence: 0.82
          }
        : undefined
    };
  } else if (hasSelfCue) {
    interpretation = {
      intent: "identity_self",
      lane: "knowledge",
      target: "self",
      facet,
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.8,
      margin: 0.22,
      ambiguous: false,
      primaryReferent: input.npcDefinitionId
        ? {
            id: input.npcDefinitionId,
            text: input.npcDisplayName ?? "NPC",
            kind: "npc",
            confidence: 0.88
          }
        : undefined
    };
  } else if (hasQuestionCue || hasKnowledgeCue) {
    interpretation = {
      intent: facet === "identity" ? "lore_other" : "lore_world",
      lane: "knowledge",
      target: facet === "identity" ? "other" : "world",
      facet,
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.72,
      margin: 0.16,
      ambiguous: facet === "unknown"
    };
  } else {
    interpretation = {
      intent: "unclear",
      lane: "knowledge",
      target: "unknown",
      facet: facet === "unknown" ? "general_lore" : facet,
      timeframe,
      socialMove,
      declaredIdentityName,
      focusText,
      confidence: 0.38,
      margin: 0.08,
      ambiguous: true
    };
  }

  const riskSignals: string[] = [];
  if (hasQuestionCue) riskSignals.push("knowledge_wh_cue");
  if (hasRecallCue) riskSignals.push("recall_cue");
  if (hasKnowledgeCue && !hasQuestionCue) riskSignals.push("factual_clause_pattern");
  if (hasQuestCue) riskSignals.push("quest_cue");
  if (interpretation.ambiguous) riskSignals.push("route_conflict");

  const semanticSocialProtected =
    interpretation.intent === "social_chat" &&
    interpretation.lane === "social" &&
    !interpretation.ambiguous &&
    interpretation.confidence >= 0.64 &&
    interpretation.margin >= 0.12;
  const socialFastPathEligible =
    interpretation.intent === "social_chat" &&
    !hasKnowledgeCue &&
    !hasRecallCue &&
    !hasQuestCue &&
    !interpretation.ambiguous;
  const heuristicFallbackUsed =
    interpretation.intent === "social_chat" &&
    !socialFastPathEligible &&
    !semanticSocialProtected;

  const turnRouting: TurnRoutingDecision = {
    path:
      !userText || hasFarewellCue || socialFastPathEligible ? "social_fast" : "grounded",
    socialFastPathEligible: !userText || hasFarewellCue || socialFastPathEligible,
    factualRiskSignals: riskSignals,
    semanticSocialProtected,
    heuristicFallbackUsed,
    heuristicFallbackReason: heuristicFallbackUsed
      ? `grounded path forced by risk signals: ${riskSignals.join(", ")}`
      : undefined,
    suppressedRiskSignals: semanticSocialProtected
      ? riskSignals.filter((signal) => signal === "knowledge_wh_cue")
      : []
  };

  let queryType: InterpretResult["queryType"] = "conversation";
  if (interpretation.intent === "quest_guidance") {
    queryType = "quest_query";
  } else if (interpretation.lane === "knowledge") {
    if (interpretation.target === "self") queryType = "self_query";
    else if (interpretation.target === "other") queryType = "other_query";
    else if (interpretation.target === "mixed") queryType = "mixed_query";
    else if (interpretation.target === "world") queryType = "world_query";
  }

  return {
    userText,
    queryType,
    interpretation,
    turnRouting,
    searchQuery: userText && turnRouting.path === "grounded" ? interpretation.focusText : focusText,
    shouldCloseAfterReply: hasFarewellCue
  };
}
