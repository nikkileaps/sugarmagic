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
    npcDescription: null,
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
    questWorldContext: "Travelers with lost luggage are directed to baggage claim.",
    goalSurfacedCount: null,
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
    knownFacts: null,
    recentWorldEvents: null,
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
    // Plan 077.1: raw quest title MUST NOT appear -- world-framed context replaces it (D2).
    expect(userPrompt).not.toContain("Lost Locket");
    expect(userPrompt).toContain("baggage claim"); // world-framed context IS present
    expect(userPrompt).toContain("Current runtime location: Bakery.");
    expect(userPrompt).toContain("Player/NPC proximity band: immediate.");
    expect(userPrompt).toContain("NPC current task: Kneading dough.");
    expect(userPrompt).toContain("Language constraint: keep it simple."); // overlay
  });

  it("relocates the minimal-greeting instruction to the user message", () => {
    const { systemPrompt, userPrompt } = buildGeneratePrompt(
      baseContext({ minimalGreetingMode: true })
    );
    expect(userPrompt).toContain("beginner-learner greeting turn");
    expect(systemPrompt).not.toContain("beginner-learner greeting turn");
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

// Plan 077.1 -- D2 prompt firewall: world-framed quest context replaces the
// omniscient "player is on a quest" line. The raw objective title must never
// appear in ANY part of the prompt.
describe("buildGeneratePrompt -- D2 quest-context firewall (077.1)", () => {
  it("emits world-framed context in user message and keeps the raw title out", () => {
    const worldContext = "Travelers with lost luggage are directed to baggage claim.";
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: worldContext, activeQuestDisplayName: "Lost Locket" })
    );
    expect(userPrompt).toContain(worldContext);
    expect(userPrompt).not.toContain("Lost Locket");
  });

  it("emits the NPC guidance block alongside the world context", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({
        questWorldContext: "Travelers with lost luggage are directed to baggage claim."
      })
    );
    expect(userPrompt).toContain("World context right now:");
    expect(userPrompt).toContain("offer what you would plausibly know in character");
    expect(userPrompt).toContain("Do not act as though you know the player's private business");
  });

  it("omits the quest block entirely when questWorldContext is null", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: null, activeQuestDisplayName: "Lost Locket" })
    );
    expect(userPrompt).not.toContain("Lost Locket");
    expect(userPrompt).not.toContain("World context right now:");
  });

  it("omits the quest block during minimal-greeting mode even when context is set", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({
        questWorldContext: "Travelers with lost luggage are directed to baggage claim.",
        minimalGreetingMode: true
      })
    );
    expect(userPrompt).not.toContain("World context right now:");
  });

  it("keeps the raw quest title out of the system prompt regardless of world context", () => {
    const { systemPrompt } = buildGeneratePrompt(
      baseContext({
        questWorldContext: "Travelers with lost luggage are directed to baggage claim.",
        activeQuestDisplayName: "Lost Locket"
      })
    );
    expect(systemPrompt).not.toContain("Lost Locket");
    expect(systemPrompt).not.toContain("World context right now:");
  });

  it("keeps the SYSTEM prompt byte-stable whether or not world context is set", () => {
    const withContext = buildGeneratePrompt(
      baseContext({ questWorldContext: "Travelers with lost luggage are directed to baggage claim." })
    ).systemPrompt;
    const withoutContext = buildGeneratePrompt(
      baseContext({ questWorldContext: null })
    ).systemPrompt;
    expect(withContext).toBe(withoutContext);
  });
});

describe("buildGeneratePrompt -- goal-surfaced ease-off hint (077.3)", () => {
  it("omits the ease-off hint when goalSurfacedCount is null (first NPC to offer)", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: "Baggage claim info.", goalSurfacedCount: null })
    );
    expect(userPrompt).not.toContain("has been brought up");
    expect(userPrompt).not.toContain("ease off");
  });

  it("omits the ease-off hint when goalSurfacedCount is 0", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: "Baggage claim info.", goalSurfacedCount: 0 })
    );
    expect(userPrompt).not.toContain("has been brought up");
  });

  it("emits the ease-off hint when goalSurfacedCount is > 0", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: "Baggage claim info.", goalSurfacedCount: 2 })
    );
    expect(userPrompt).toContain("2 time(s)");
    expect(userPrompt).toContain("without repeating the nudge");
  });

  it("omits the ease-off hint even with count > 0 when questWorldContext is null", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({ questWorldContext: null, goalSurfacedCount: 3 })
    );
    expect(userPrompt).not.toContain("time(s)");
    expect(userPrompt).not.toContain("without repeating");
  });

  it("omits the ease-off hint in minimal-greeting mode even with count > 0", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({
        questWorldContext: "Baggage claim info.",
        goalSurfacedCount: 5,
        minimalGreetingMode: true,
        playerText: null
      })
    );
    expect(userPrompt).not.toContain("time(s)");
  });
});

describe("buildGeneratePrompt — no-lore description fallback", () => {
  it("injects npcDescription as identity anchor when persona card and core knowledge are empty", () => {
    const { systemPrompt } = buildGeneratePrompt(
      baseContext({
        persona: { personaCard: [], coreKnowledge: [] },
        npcDescription: "A stressed passenger worried about lost luggage."
      })
    );
    expect(systemPrompt).toContain("Who you are: A stressed passenger worried about lost luggage.");
  });

  it("does not inject npcDescription when persona card is present", () => {
    const { systemPrompt } = buildGeneratePrompt(
      baseContext({
        npcDescription: "Should not appear."
      })
    );
    expect(systemPrompt).not.toContain("Should not appear.");
  });

  it("does not inject npcDescription when npcDescription is null", () => {
    const { systemPrompt } = buildGeneratePrompt(
      baseContext({
        persona: { personaCard: [], coreKnowledge: [] },
        npcDescription: null
      })
    );
    expect(systemPrompt).not.toContain("Who you are:");
  });
});

describe("buildGeneratePrompt -- recent-events block (074.6')", () => {
  it("renders recentWorldEvents as bullet list in the user message", () => {
    const { userPrompt } = buildGeneratePrompt(
      baseContext({
        recentWorldEvents: [
          "Day advanced to 2.",
          "Quest 'The Lost Cargo' completed."
        ]
      })
    );
    expect(userPrompt).toContain("Recent world events:");
    expect(userPrompt).toContain("- Day advanced to 2.");
    expect(userPrompt).toContain("- Quest 'The Lost Cargo' completed.");
  });

  it("omits the block when recentWorldEvents is null", () => {
    const { userPrompt } = buildGeneratePrompt(baseContext({ recentWorldEvents: null }));
    expect(userPrompt).not.toContain("Recent world events:");
  });

  it("omits the block when recentWorldEvents is empty", () => {
    const { userPrompt } = buildGeneratePrompt(baseContext({ recentWorldEvents: [] }));
    expect(userPrompt).not.toContain("Recent world events:");
  });
});
