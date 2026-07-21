import type { ConversationExecutionContext } from "@sugarmagic/runtime-core";
import type { InterpretResult, PlanResult, RetrieveResult } from "../types";

const META_LEAK_PATTERNS: Array<{ violation: string; pattern: RegExp }> = [
  { violation: "mentions-sugarmagic", pattern: /\bsugarmagic\b/i },
  { violation: "mentions-openai", pattern: /\bopenai\b/i },
  { violation: "mentions-anthropic", pattern: /\banthropic\b/i },
  { violation: "mentions-api", pattern: /\bapi\b/i },
  { violation: "mentions-model", pattern: /\bmodel\b/i },
  { violation: "mentions-prompt", pattern: /\bprompt\b/i },
  { violation: "mentions-roleplaying", pattern: /\broleplay(?:ing)?\b/i },
  { violation: "mentions-ai", pattern: /\bai\b/i }
];

const STAGE_DIRECTION_PATTERNS: Array<{ violation: string; pattern: RegExp }> = [
  { violation: "contains-asterisk-stage-direction", pattern: /\*[^*]+\*/ },
  { violation: "contains-bracket-stage-direction", pattern: /\[[^\]]+\]/ },
  { violation: "contains-parenthetical-stage-direction", pattern: /^\s*\([^)]{2,}\)\s*/m }
];

export interface EvidenceBudget {
  /** Max number of evidence items to forward. */
  maxItems: number;
  /** Per-item character cap. */
  perItemChars: number;
}

/**
 * Plan 072.6 — forward up to `maxItems` evidence items, each capped at
 * `perItemChars`. Replaces the old hard 3x180 truncation so the wiki's
 * richness actually reaches the model. Total budget is bounded by
 * maxItems x perItemChars.
 */
export function summarizeEvidence(
  evidencePack: RetrieveResult["evidencePack"],
  budget: EvidenceBudget
): string[] {
  const maxItems = Math.max(1, Math.floor(budget.maxItems));
  const perItemChars = Math.max(1, Math.floor(budget.perItemChars));
  return evidencePack
    .slice(0, maxItems)
    .map((item) =>
      item.text.length > perItemChars ? item.text.slice(0, perItemChars) : item.text
    );
}

export function normalizeRetrievedEvidenceText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  let index = 0;
  while (
    index < lines.length &&
    /^(Page ID:|Title:|Section:)\s+/i.test(lines[index]?.trim() ?? "")
  ) {
    index += 1;
  }

  const content = lines.slice(index).join("\n").trim();
  return content || normalized;
}

export function findMetaLeakViolations(text: string): string[] {
  return META_LEAK_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.violation);
}

export function findStageDirectionViolations(text: string): string[] {
  return STAGE_DIRECTION_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.violation);
}

export function findGenericOnlyViolations(text: string): string[] {
  const violations: string[] = [];
  const normalized = text.trim();
  if (!normalized) return violations;

  if (normalized.length > 440) {
    violations.push("generic-only-too-long");
  }

  const sentenceCount =
    normalized.split(/[.!?]+/).map((segment) => segment.trim()).filter(Boolean).length;
  if (sentenceCount > 7) {
    violations.push("generic-only-too-many-sentences");
  }

  // Rationale for the missing noun-list heuristic: a hardcoded list acts like
  // a fake world model and rejects good replies for mentioning ordinary scene
  // details. Real claim-vs-evidence auditing belongs in the judge stage (071.E).
  return violations;
}

export function findSpatialGroundingViolations(
  text: string,
  execution: ConversationExecutionContext
): string[] {
  const violations: string[] = [];
  const normalized = text.trim();
  if (!normalized) {
    return violations;
  }

  const currentAreaKind =
    execution.runtimeContext?.here?.area?.kind ??
    execution.runtimeContext?.npcArea?.area?.kind ??
    null;

  if (
    currentAreaKind === "exterior" &&
    /\b(inside|indoors|in this room|in the room|inside the station)\b/i.test(normalized)
  ) {
    violations.push("spatial-contradiction-inside-vs-exterior");
  }

  if (
    currentAreaKind &&
    currentAreaKind !== "shop" &&
    currentAreaKind !== "stall" &&
    /\b(?:right here at|here at|in|inside)\s+my\s+(?:shop|store|stall|kiosk)\b|\bmy\s+(?:shop|store|stall|kiosk)\s+here\b/i.test(
      normalized
    )
  ) {
    violations.push("spatial-contradiction-deictic-shop-claim");
  }

  return violations;
}

export function normalizeNpcSpeech(text: string): string {
  let normalized = text.replace(/\*[^*]+\*/g, " ");
  normalized = normalized.replace(/\[[^\]]+\]/g, " ");
  normalized = normalized.replace(/^\s*\(([^)]{2,})\)\s*/gm, "");

  while (/"([^"\n]+)"\s*"([^"\n]+)"/.test(normalized)) {
    normalized = normalized.replace(/"([^"\n]+)"\s*"([^"\n]+)"/g, "$1 $2");
  }

  normalized = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const quoteWrapped = paragraph.match(/^["“](.*)["”]$/s);
      if (quoteWrapped) {
        return quoteWrapped[1]!.trim();
      }
      return paragraph;
    })
    .join("\n\n");

  normalized = normalized.replace(/[ \t]+/g, " ");
  normalized = normalized.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n");
  return normalized.trim();
}

export function buildFallbackReply(input: {
  interpret: InterpretResult;
  responseIntent: PlanResult["responseIntent"];
  activeQuestDisplayName: string | null;
}): string {
  const { interpret, responseIntent, activeQuestDisplayName } = input;
  if (responseIntent === "greet") {
    return "Hello. What can I help you with today?";
  }
  if (responseIntent === "chat") {
    return buildGenericOnlyReply({
      responseIntent,
      interpret
    });
  }
  if (responseIntent === "goodbye" || interpret.shouldCloseAfterReply) {
    return "All right. We'll speak again.";
  }
  if (responseIntent === "clarify") {
    if (activeQuestDisplayName) {
      return `Do you need help with ${activeQuestDisplayName}, or are you asking about something else?`;
    }
    return "I can help, but I need a clearer question before I point you in the wrong direction.";
  }
  if (responseIntent === "abstain") {
    return "I don't know enough to answer that yet. Give me a little more context or ask someone closer to it.";
  }
  if (responseIntent === "redirect" && activeQuestDisplayName) {
    return `Stay with the thread of ${activeQuestDisplayName}. That's where the answers are.`;
  }
  // A deterministic fallback must NEVER recite raw retrieved evidence — that
  // dumps vector-store chunks (headers, other pages' scripts) verbatim at the
  // player. Fall back to a generic, in-character, content-free deflection.
  return "I can talk this through, but I need a little more to go on.";
}

export function buildTransientUpstreamExitReply(): string {
  return "Sorry, I need a moment to think. Let's chat later.";
}

export function buildGenericOnlyReply(input: {
  responseIntent: "greet" | "chat" | "answer";
  interpret: InterpretResult;
}): string {
  if (input.responseIntent === "greet" || !input.interpret.userText) {
    return "Hello. What can I help you with today?";
  }

  const {
    declaredIdentityName,
    socialMove
  } = input.interpret.interpretation;

  if (input.responseIntent === "chat") {
    if (socialMove === "introduction" && declaredIdentityName) {
      return `Hello, ${declaredIdentityName}. Nice to meet you. What can I help you with today?`;
    }
    if (socialMove === "introduction") {
      return "Nice to meet you. What can I help you with today?";
    }
    if (socialMove === "acknowledgement") {
      return "All right. What do you need?";
    }
    if (socialMove === "smalltalk") {
      return "Hello. What can I help you with today?";
    }
    return "I'm listening.";
  }

  return "I can help if you tell me a little more about what you need.";
}

export function buildTerminalFallbackReply(input: {
  interpret: InterpretResult;
  activeQuestDisplayName: string | null;
}): string {
  if (
    input.interpret.interpretation.intent === "quest_guidance" &&
    input.activeQuestDisplayName
  ) {
    return `Sorry, I need to get back to my work. Come back later, or try someone closer to ${input.activeQuestDisplayName}.`;
  }
  return "Sorry, I need to get back to my work. Let's chat later.";
}
