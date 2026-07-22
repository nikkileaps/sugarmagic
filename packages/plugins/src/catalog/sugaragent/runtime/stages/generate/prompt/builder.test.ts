/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/generate/prompt/builder.test.ts
 *
 * Purpose: Plan 072.4 cache-boundary restructure. Guards that the SYSTEM prompt
 * is byte-stable across turns (incl. across the minimal-greeting -> normal
 * boundary) and holds the persona card + core knowledge + voice directive,
 * while all per-turn content (world state, sugarlang overlay, minimal-greeting
 * instruction) lives in the USER message.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { buildGeneratePrompt } from "./builder";
import type { AgentPromptContext } from "./context";

function baseContext(
  overrides: Partial<AgentPromptContext> = {}
): AgentPromptContext {
  return {
    mode: "agent",
    npcDisplayName: "Maren",
    tone: "cozy",
    responseIntent: "chat",
    responseSpecificity: "grounded",
    turnPath: "social_fast",
    responseGoal: "greet warmly",
    interpretIntent: "greeting",
    playerText: "Hello!",
    minimalGreetingMode: false,
    activeQuestDisplayName: "Lost Locket",
    activeQuestStageDisplayName: "Ask around",
    currentLocationDisplayName: "Bakery",
    currentParentAreaDisplayName: "Market Square",
    npcPlayerRelation: { proximityBand: "immediate", sameArea: true },
    npcCurrentTask: { displayName: "Kneading dough", description: "morning batch" },
    npcCurrentActivity: "baking",
    npcCurrentGoal: "finish the spiced loaf",
    npcMovement: { status: "stationary", targetAreaDisplayName: null },
    evidenceSummary: ["Maren runs the bakery."],
    recentHistory: [{ role: "user", text: "hi" }],
    languageLearningOverlay: "Language constraint: keep it simple.",
    persona: {
      personaCard: [
        { heading: "Persona", slug: "persona", content: "Warm, brisk, proud." },
        { heading: "Voice", slug: "voice", content: "Short sentences; says 'love'." }
      ],
      coreKnowledge: [
        { heading: "Work", slug: "work", content: "Runs the bakery on the square." }
      ]
    },
    personaDigest: "Warm, brisk, proud.\nVoice: Short sentences; says 'love'.",
    memoryDigest: "",
    ...overrides
  };
}

describe("buildGeneratePrompt — cache-boundary restructure (072.4)", () => {
  it("puts persona card, core knowledge, and voice directive in the system prompt", () => {
    const { systemPrompt } = buildGeneratePrompt(baseContext());
    expect(systemPrompt).toContain("Speak as Maren.");
    expect(systemPrompt).toContain("Warm, brisk, proud."); // persona
    expect(systemPrompt).toContain("Runs the bakery on the square."); // core
    // Voice directive comes from the ## Voice section, not the tone fallback.
    expect(systemPrompt).toContain("Short sentences; says 'love'.");
    expect(systemPrompt).not.toContain("Tone: cozy");
  });

  it("falls back to the tone directive when no ## Voice section is authored", () => {
    const ctx = baseContext({
      persona: {
        personaCard: [
          { heading: "Persona", slug: "persona", content: "Warm." }
        ],
        coreKnowledge: []
      }
    });
    const { systemPrompt } = buildGeneratePrompt(ctx);
    expect(systemPrompt).toContain("Tone: cozy.");
  });

  it("degrades to identity + tone only when persona is null (D3)", () => {
    const { systemPrompt } = buildGeneratePrompt(
      baseContext({ persona: null })
    );
    expect(systemPrompt).toContain("Speak as Maren.");
    expect(systemPrompt).toContain("Tone: cozy.");
    expect(systemPrompt).not.toContain("Who you are");
    expect(systemPrompt).not.toContain("What you know");
  });

  it("keeps world state, overlay, and minimal-greeting instruction OUT of the system prompt", () => {
    const { systemPrompt } = buildGeneratePrompt(baseContext());
    expect(systemPrompt).not.toContain("Lost Locket"); // quest
    expect(systemPrompt).not.toContain("Bakery"); // location
    expect(systemPrompt).not.toContain("proximity band");
    expect(systemPrompt).not.toContain("Language constraint"); // overlay
    expect(systemPrompt).not.toContain("Kneading dough"); // task
  });

  it("puts world state and overlay IN the user message", () => {
    const { userPrompt } = buildGeneratePrompt(baseContext());
    expect(userPrompt).toContain("Lost Locket"); // quest line relocated here
    expect(userPrompt).toContain("Current runtime location: Bakery.");
    expect(userPrompt).toContain("Player/NPC proximity band: immediate.");
    expect(userPrompt).toContain("NPC current task: Kneading dough.");
    expect(userPrompt).toContain("Language constraint: keep it simple."); // overlay
  });

  it("relocates the minimal-greeting instruction to the user message", () => {
    const { systemPrompt, userPrompt } = buildGeneratePrompt(
      baseContext({ minimalGreetingMode: true })
    );
    expect(userPrompt).toContain("first-meeting beginner greeting turn");
    expect(systemPrompt).not.toContain("first-meeting beginner greeting turn");
  });

  it("keeps the SYSTEM prompt byte-stable across the minimal-greeting -> normal boundary", () => {
    // The cache write must survive the first-meeting turn flipping to turn 2.
    const greeting = buildGeneratePrompt(
      baseContext({ minimalGreetingMode: true, playerText: null })
    ).systemPrompt;
    const normal = buildGeneratePrompt(
      baseContext({ minimalGreetingMode: false, playerText: "Tell me about the bread." })
    ).systemPrompt;
    expect(greeting).toBe(normal);
  });

  it("keeps the SYSTEM prompt byte-stable when only world state changes", () => {
    const a = buildGeneratePrompt(
      baseContext({ currentLocationDisplayName: "Bakery", npcCurrentActivity: "baking" })
    ).systemPrompt;
    const b = buildGeneratePrompt(
      baseContext({ currentLocationDisplayName: "Market Square", npcCurrentActivity: "sweeping" })
    ).systemPrompt;
    expect(a).toBe(b);
  });

  // Plan 072.8 — persona drift re-injection.
  it("re-injects the persona digest as the LAST user-message block (after history)", () => {
    const { userPrompt, systemPrompt } = buildGeneratePrompt(baseContext());
    expect(userPrompt).toContain("Remember who you are:");
    expect(userPrompt).toContain("Short sentences; says 'love'.");
    // It comes after the recent-history block.
    const historyIdx = userPrompt.indexOf("Recent history:");
    const digestIdx = userPrompt.indexOf("Remember who you are:");
    expect(historyIdx).toBeGreaterThanOrEqual(0);
    expect(digestIdx).toBeGreaterThan(historyIdx);
    // The digest lives in the user half only — never the (cached) system half.
    expect(systemPrompt).not.toContain("Remember who you are:");
  });

  it("omits the digest block when there is no persona digest", () => {
    const { userPrompt } = buildGeneratePrompt(baseContext({ personaDigest: "" }));
    expect(userPrompt).not.toContain("Remember who you are:");
  });

  // Plan 073.3 — memory digest in the cached system half.
  it("slots the memory digest into the system prompt between core knowledge and voice", () => {
    const memoryDigest =
      "What you remember about this player (from earlier conversations):\nYou have spoken with them twice before.";
    const { systemPrompt, userPrompt } = buildGeneratePrompt(
      baseContext({ memoryDigest })
    );
    expect(systemPrompt).toContain(memoryDigest);
    // After core knowledge, before the voice directive.
    const coreIdx = systemPrompt.indexOf("What you know");
    const memIdx = systemPrompt.indexOf("What you remember about this player");
    const voiceIdx = systemPrompt.indexOf("Short sentences; says 'love'.");
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(coreIdx);
    expect(voiceIdx).toBeGreaterThan(memIdx);
    // Memory is session-stable, so it lives in the cached system half only.
    expect(userPrompt).not.toContain("What you remember about this player");
  });

  it("omits the memory block on a first meeting (empty digest)", () => {
    const { systemPrompt } = buildGeneratePrompt(baseContext({ memoryDigest: "" }));
    expect(systemPrompt).not.toContain("What you remember about this player");
  });

  it("keeps the SYSTEM prompt byte-stable across turns with a constant memory digest", () => {
    const memoryDigest =
      "What you remember about this player (from earlier conversations):\nYou have spoken with them twice before.";
    const a = buildGeneratePrompt(
      baseContext({ memoryDigest, minimalGreetingMode: true, playerText: null })
    ).systemPrompt;
    const b = buildGeneratePrompt(
      baseContext({ memoryDigest, minimalGreetingMode: false, playerText: "hi again" })
    ).systemPrompt;
    expect(a).toBe(b);
  });
});
