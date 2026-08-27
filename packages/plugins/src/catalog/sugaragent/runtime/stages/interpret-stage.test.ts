/**
 * Plan 084.5 -- InterpretStage + interpretPlayerTurn + nfdStrip/buildLexiconPattern
 *
 * Pins:
 *  - Without contributions, classification is byte-identical to today.
 *  - With Spanish lexicon: "adios" routes to farewell, "gracias" to acknowledgement.
 *  - Mixed utterance ("gracias, see you later") does not double-fire.
 *  - nfdStrip: "adios" matches "adiós"-sourced pattern.
 *  - buildLexiconPattern: null on empty, word-boundary match.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { InterpretStage } from "./InterpretStage";
import { interpretPlayerTurn, nfdStrip, buildLexiconPattern } from "./interpretation";

// ---------------------------------------------------------------------------
// nfdStrip unit
// ---------------------------------------------------------------------------
describe("nfdStrip", () => {
  it("strips combining diacritics so adios matches adiós", () => {
    expect(nfdStrip("adiós")).toBe("adios");
    expect(nfdStrip("graciás")).toBe("gracias");
  });

  it("leaves plain ASCII unchanged", () => {
    expect(nfdStrip("hello")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// buildLexiconPattern unit
// ---------------------------------------------------------------------------
describe("buildLexiconPattern", () => {
  it("returns null for empty forms list", () => {
    expect(buildLexiconPattern([])).toBeNull();
  });

  it("matches a contributed form (case-insensitive, word boundary)", () => {
    const p = buildLexiconPattern(["adios"]);
    expect(p).not.toBeNull();
    expect(p!.test("adios")).toBe(true);
    expect(p!.test("hasta la vista")).toBe(false);
  });

  it("matches adiós-sourced form against stripped input", () => {
    const p = buildLexiconPattern(["adiós"]);
    expect(p!.test(nfdStrip("adios"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// interpretPlayerTurn -- baseline pins (no lexicon)
// ---------------------------------------------------------------------------
describe("interpretPlayerTurn -- baseline (no lexicon)", () => {
  it("bye routes to farewell", () => {
    const result = interpretPlayerTurn({
      userText: "Bye!",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" }
    });
    expect(result.interpretation.socialMove).toBe("farewell");
  });

  it("hello routes to greeting", () => {
    const result = interpretPlayerTurn({
      userText: "Hello there.",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" }
    });
    expect(result.interpretation.socialMove).toBe("greeting");
  });

  it("thanks routes to acknowledgement", () => {
    const result = interpretPlayerTurn({
      userText: "Thanks a lot.",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" }
    });
    expect(result.interpretation.socialMove).toBe("acknowledgement");
  });

  it("unknown text routes to none", () => {
    const result = interpretPlayerTurn({
      userText: "What is the largest fish?",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" }
    });
    expect(result.interpretation.socialMove).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// interpretPlayerTurn -- with Spanish lexicon (084.5 the fix)
// ---------------------------------------------------------------------------
const SPANISH_LEXICON = {
  farewell: ["adiós", "adios", "hasta luego", "hasta pronto"],
  greeting: ["hola", "buenos dias"],
  gratitude: ["gracias", "muchas gracias"],
  acknowledgement: ["si", "claro", "vale"]
};

describe("interpretPlayerTurn -- with interpretLexicon", () => {
  it("adios routes to farewell via lexicon", () => {
    const result = interpretPlayerTurn({
      userText: "adios",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" },
      interpretLexicon: SPANISH_LEXICON
    });
    expect(result.interpretation.socialMove).toBe("farewell");
    expect(result.shouldCloseAfterReply).toBe(true);
  });

  it("adiós (with accent) routes to farewell via lexicon when typed without accent (adios)", () => {
    // User types "adios" (no accent); lexicon was contributed with "adiós". nfdStrip both.
    const result = interpretPlayerTurn({
      userText: "adios",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" },
      interpretLexicon: { farewell: ["adiós"] }
    });
    expect(result.interpretation.socialMove).toBe("farewell");
  });

  it("hola routes to greeting via lexicon", () => {
    const result = interpretPlayerTurn({
      userText: "hola",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" },
      interpretLexicon: SPANISH_LEXICON
    });
    expect(result.interpretation.socialMove).toBe("greeting");
  });

  it("gracias routes to acknowledgement via lexicon", () => {
    const result = interpretPlayerTurn({
      userText: "gracias",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" },
      interpretLexicon: SPANISH_LEXICON
    });
    expect(result.interpretation.socialMove).toBe("acknowledgement");
  });

  it("mixed utterance 'gracias, see you later' routes to farewell (no double-fire)", () => {
    // "see you later" matches FAREWELL_PATTERN (see you / later); farewell checked first.
    const result = interpretPlayerTurn({
      userText: "gracias, see you later",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" },
      interpretLexicon: SPANISH_LEXICON
    });
    // Only farewell fires -- acknowledgement branch is skipped because farewell matched first.
    expect(result.interpretation.socialMove).toBe("farewell");
  });

  it("without lexicon, adios does NOT route to farewell (byte-identical baseline)", () => {
    const result = interpretPlayerTurn({
      userText: "adios",
      npcDefinitionId: null,
      npcDisplayName: null,
      pendingExpectation: { kind: "none" }
      // no interpretLexicon
    });
    expect(result.interpretation.socialMove).not.toBe("farewell");
  });
});

// ---------------------------------------------------------------------------
// InterpretStage -- lexicon threaded from annotation bus
// ---------------------------------------------------------------------------
describe("InterpretStage -- lexicon from contributions", () => {
  it("adios routes to farewell when the annotation bus carries the Spanish lexicon", async () => {
    const stage = new InterpretStage();
    const result = await stage.execute({
      execution: {
        selection: {
          conversationKind: "free-form" as const,
          npcDefinitionId: "npc-1",
          npcDisplayName: "Finnick",
          interactionMode: "agent" as const
        },
        input: { kind: "free_text" as const, text: "adios" },
        state: {},
        annotations: {
          "sugaragent.contrib/sugarlang": {
            schemaVersion: 1,
            generateOverlay: "",
            interpretLexicon: { farewell: ["adiós", "adios"] }
          }
        },
        runtimeContext: {
          here: null, playerLocation: null, playerPosition: null, playerArea: null,
          npcLocation: null, npcPosition: null, npcArea: null, npcPlayerRelation: null,
          npcBehavior: null, trackedQuest: null, activeQuestStage: null, activeQuestObjectives: null
        }
      },
      state: {
        sessionId: "s1", turnCount: 1, consecutiveFallbackTurns: 0,
        consecutiveJudgeFailures: 0, closeRequested: false, history: [], lastTurnDiagnostics: {}
      }
    } as never);

    expect(result.output.interpretation.socialMove).toBe("farewell");
    expect(result.output.shouldCloseAfterReply).toBe(true);
  });
});
