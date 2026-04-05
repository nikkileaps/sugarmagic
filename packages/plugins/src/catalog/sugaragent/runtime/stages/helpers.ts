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

export function summarizeEvidence(
  evidencePack: RetrieveResult["evidencePack"]
): string[] {
  return evidencePack.slice(0, 3).map((item) => item.text.slice(0, 180));
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

export function findRawEvidenceFormatViolations(text: string): string[] {
  const violations: string[] = [];
  if (/\bPage ID:\s+/i.test(text)) {
    violations.push("contains-page-id-metadata");
  }
  if (/\bTitle:\s+/i.test(text)) {
    violations.push("contains-title-metadata");
  }
  if (/\bSection:\s+/i.test(text)) {
    violations.push("contains-section-metadata");
  }
  return violations;
}

export function findGenericOnlyViolations(text: string): string[] {
  const violations: string[] = [];
  const normalized = text.trim();
  if (!normalized) return violations;

  if (normalized.length > 220) {
    violations.push("generic-only-too-long");
  }

  const sentenceCount =
    normalized.split(/[.!?]+/).map((segment) => segment.trim()).filter(Boolean).length;
  if (sentenceCount > 3) {
    violations.push("generic-only-too-many-sentences");
  }

  // Placeholder heuristic for the current test world. This should eventually
  // become data-driven from authored lore vocabulary instead of hardcoding
  // game-specific nouns in runtime code.
  const unsupportedSpecificDetailPattern =
    /\b(station|cargo|freighter|dock|docking|bay|uniform|report|reports|tablet|tablets|datapad|datapads|schedule|schedules|maintenance|comm|pressure doors|holographic|transit|hub|regulars|office|terminal)\b/i;
  if (unsupportedSpecificDetailPattern.test(normalized)) {
    violations.push("generic-only-unsupported-specific-detail");
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
  evidenceSummary: string[];
  activeQuestDisplayName: string | null;
}): string {
  const {
    interpret,
    responseIntent,
    evidenceSummary,
    activeQuestDisplayName
  } = input;
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
  if (evidenceSummary.length > 0) {
    return `From what I know: ${evidenceSummary[0]}.`;
  }
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
