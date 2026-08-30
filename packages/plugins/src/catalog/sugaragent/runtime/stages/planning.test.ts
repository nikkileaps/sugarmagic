/**
 * packages/plugins/src/catalog/sugaragent/runtime/stages/planning.test.ts
 *
 * Purpose: Guards resolvePlanDecision grounding signals -- memoryGrounds
 * (Plan 073.3) and questGrounds (Plan 077.1).
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { resolvePlanDecision, findUnrecognisedNames } from "./planning";
import type { InterpretResult } from "../types";

function baseInterpret(overrides: Partial<InterpretResult> = {}): InterpretResult {
  return {
    userText: "hello",
    queryType: "conversation",
    interpretation: {
      intent: "social_chat",
      lane: "social",
      target: "self",
      facet: "identity",
      timeframe: "current",
      socialMove: "greeting",
      contextAnchor: "none",
      declaredIdentityName: null,
      focusText: "",
      confidence: 0.9,
      margin: 0.4,
      ambiguous: false
    },
    turnRouting: {
      path: "social_fast",
      socialFastPathEligible: true,
      factualRiskSignals: []
    },
    pendingExpectation: { kind: "none" },
    searchQuery: "hello",
    shouldCloseAfterReply: false,
    ...overrides
  };
}

describe("resolvePlanDecision -- questGrounds (077.1)", () => {
  it("routes to grounded specificity when quest world context is present", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("grounded");
  });

  it("stays generic-only when quest is active but no world context was resolved", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    // social_fast path -> "chat" intent, no evidence, no grounding -> generic-only
    expect(decision.responseSpecificity).toBe("generic-only");
  });

  it("stays generic-only when questWorldContext is absent (undefined)", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret(),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("generic-only");
  });

  it("is grounded by evidence even without quest world context", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret({ userText: "where is the cheese?", turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] } }),
      hasEvidence: true,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseSpecificity).toBe("grounded");
  });

  it("quest grounding does not override redirect intent for quest_guidance", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret({
        userText: "where do I go?",
        interpretation: {
          intent: "quest_guidance",
          lane: "knowledge",
          target: "world",
          facet: "location",
          timeframe: "current",
          socialMove: "none",
          contextAnchor: "none",
          declaredIdentityName: null,
          focusText: "where do I go",
          confidence: 0.9,
          margin: 0.4,
          ambiguous: false
        },
        turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] }
      }),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: true,
      hasQuestWorldContext: true,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseIntent).toBe("redirect");
    expect(decision.responseSpecificity).toBe("grounded");
  });
});

/**
 * #184 -- an NPC refused a question its own lore page answers.
 *
 * OBSERVED in play: the player asked Finnick Thorn "Tu tienes un tienda de
 * queso?" and he was instructed to say he did not know enough, while
 * "He owns a Cheese Shop in Wordlark Hollow" sat in the same prompt.
 *
 * The decision asked two questions -- did retrieval find anything, is there
 * memory -- and the NPC's own page is neither. It is loaded once at session
 * start and is in every prompt.
 */
describe("resolvePlanDecision -- the NPC's own page grounds a turn (#184)", () => {
  function askAbout(
    intent: "identity_self" | "lore_world" | "lore_other" | "session_recall"
  ): InterpretResult {
    return baseInterpret({
      userText: "Do you have a cheese shop?",
      interpretation: {
        ...baseInterpret().interpretation,
        intent,
        lane: "knowledge",
        target:
          intent === "identity_self"
            ? "self"
            : intent === "lore_other"
              ? "other"
              : "world"
      },
      turnRouting: {
        path: "grounded",
        socialFastPathEligible: false,
        factualRiskSignals: []
      }
    });
  }

  function decide(
    intent: Parameters<typeof askAbout>[0],
    hasPersonaPage: boolean
  ) {
    return resolvePlanDecision({
      interpret: askAbout(intent),
      hasEvidence: false, // the search found nothing -- the reported turn
      hasMemory: false,
      hasPersonaPage,
      hasActiveQuest: false,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
  }

  it("THE REPORTED TURN: answers a question about the world when it has a page", () => {
    // Tagged lore_world, not identity_self -- SELF_PATTERN does not match
    // "do you have a cheese shop?" in any language. The fix cannot depend on
    // that tagging being right.
    expect(decide("lore_world", true).responseIntent).toBe("answer");
  });

  it("answers a question about itself when it has a page", () => {
    expect(decide("identity_self", true).responseIntent).toBe("answer");
  });

  it("still refuses a question about ANOTHER character", () => {
    // His page usually says nothing about them, so "I don't know" is honest.
    expect(decide("lore_other", true).responseIntent).toBe("abstain");
  });

  it("still refuses when no page is loaded, because it genuinely knows nothing", () => {
    expect(decide("lore_world", false).responseIntent).toBe("abstain");
    expect(decide("identity_self", false).responseIntent).toBe("abstain");
  });

  it("leaves recall to memory -- a page does not tell it whether it met you", () => {
    expect(decide("session_recall", true).responseIntent).toBe("abstain");
  });
});

/**
 * #184 (second pass) -- self-knowledge and world-knowledge are two questions.
 *
 * The first pass counted the NPC's own page as grounding for `lore_world`, and
 * `lore_world` is where BOTH of these live:
 *
 *   "Do you have a cheese shop?"              -> his page answers it
 *   "Have you been to the Brindlewick..."     -> nothing in the wiki knows it
 *
 * Same intent, same target, same empty search. Measured 2026-08-16: the first
 * pass flipped all of them from abstain to answer, so an NPC would claim to
 * have visited a building invented for the test.
 *
 * The wiki, the quest and the scene are reality. If the player names something
 * and nothing in reality matches it, it does not exist, and the NPC says so.
 */
describe("resolvePlanDecision -- naming something reality does not know (#184)", () => {
  function ask(userText: string, unknownNamedEntities: string[]) {
    return resolvePlanDecision({
      interpret: baseInterpret({
        userText,
        interpretation: {
          ...baseInterpret().interpretation,
          intent: "lore_world",
          lane: "knowledge",
          target: "world"
        },
        turnRouting: {
          path: "grounded",
          socialFastPathEligible: false,
          factualRiskSignals: []
        }
      }),
      hasEvidence: false,
      hasMemory: false,
      hasPersonaPage: true,
      unknownNamedEntities,
      hasActiveQuest: false,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
  }

  it("THE REGRESSION: refuses a place nothing in the wiki has heard of", () => {
    const decision = ask(
      "Have you been to the Brindlewick Observatory?",
      ["Brindlewick Observatory"]
    );
    expect(decision.responseIntent).toBe("abstain");
  });

  it("says WHAT it has not heard of, rather than asking for more context", () => {
    const decision = ask("Have you been to the Brindlewick Observatory?", [
      "Brindlewick Observatory"
    ]);
    expect(decision.responseGoal).toContain("Brindlewick Observatory");
    expect(decision.responseGoal).not.toContain("not enough grounded information");
  });

  it("STILL ANSWERS its own life -- the bug this ticket opened for", () => {
    // No name reality failed to recognise, so his page grounds the turn.
    expect(ask("Do you have a cheese shop?", []).responseIntent).toBe("answer");
    expect(ask("Where is your tienda?", []).responseIntent).toBe("answer");
  });

  it("a name reality DOES know does not trigger a refusal", () => {
    // Recognised names never reach the unknown list, so nothing here fires.
    expect(ask("How is Marigold Thorn?", []).responseIntent).toBe("answer");
  });

  it("an unrecognised name wins even when the search returned something", () => {
    const decision = resolvePlanDecision({
      interpret: baseInterpret({
        userText: "Tell me about cheese and the Gilded Teacup",
        interpretation: {
          ...baseInterpret().interpretation,
          intent: "lore_world",
          lane: "knowledge",
          target: "world"
        },
        turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] }
      }),
      hasEvidence: true,
      hasMemory: false,
      hasPersonaPage: true,
      unknownNamedEntities: ["Gilded Teacup"],
      hasActiveQuest: false,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: []
    });
    expect(decision.responseIntent).toBe("abstain");
  });
});

describe("findUnrecognisedNames (#184)", () => {
  const CORPUS =
    "Finnick Thorn owns a Cheese Shop in Wordlark Hollow. His wife is Marigold Thorn. He grew up on Earendale.";

  it("finds a name reality has never seen", () => {
    expect(
      findUnrecognisedNames("Have you been to the Brindlewick Observatory?", CORPUS)
    ).toEqual(["Brindlewick Observatory"]);
  });

  it("ignores names reality knows", () => {
    expect(findUnrecognisedNames("How is Marigold Thorn?", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Is your shop in Wordlark Hollow?", CORPUS)).toEqual([]);
  });

  it("IGNORES SINGLE WORDS -- a false fire here is the bug this ticket opened for", () => {
    // "Spanish", "Mim", "Okay" and every sentence-initial word are single
    // capitals. Refusing on those would refuse half the conversation.
    expect(findUnrecognisedNames("Do you speak Spanish?", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Hola! I'm Mim.", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Where is your tienda?", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Do you have a cheese shop?", CORPUS)).toEqual([]);
  });

  it("does not fire on a capitalised sentence opening alone", () => {
    expect(findUnrecognisedNames("Have you eaten today?", CORPUS)).toEqual([]);
  });

  it("returns each name once", () => {
    expect(
      findUnrecognisedNames("The Gilded Teacup? I love the Gilded Teacup.", CORPUS)
    ).toEqual(["Gilded Teacup"]);
  });

  it("handles no player text", () => {
    expect(findUnrecognisedNames(null, CORPUS)).toEqual([]);
  });
});

describe("resolvePlanDecision -- the name check is not a sub-clause (#184)", () => {
  function askInBranch(
    overrides: Partial<Parameters<typeof resolvePlanDecision>[0]>,
    interpretOverrides: Partial<InterpretResult> = {}
  ) {
    return resolvePlanDecision({
      interpret: baseInterpret({
        userText: "Do you know Brindlebear's Book Emporium?",
        ...interpretOverrides
      }),
      hasEvidence: false,
      hasMemory: false,
      hasPersonaPage: true,
      unknownNamedEntities: ["Brindlebear's Book Emporium"],
      hasActiveQuest: false,
      hasQuestWorldContext: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: [],
      ...overrides
    });
  }

  it("refuses even when the turn would otherwise be small talk", () => {
    // social_fast is the default routing for a chatty turn, and it used to run
    // before the name check.
    const decision = askInBranch({}, {
      turnRouting: { path: "social_fast", socialFastPathEligible: true, factualRiskSignals: [] }
    });
    expect(decision.responseIntent).toBe("abstain");
  });

  it("refuses even when the NPC's last reply left a clarify expectation", () => {
    // THE OBSERVED CASE: pendingExpectation comes from the NPC's PREVIOUS reply,
    // so this branch fired on a message identical to one that abstained before.
    const decision = askInBranch({}, {
      pendingExpectation: { kind: "clarify" },
      turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] }
    });
    expect(decision.responseIntent).toBe("abstain");
  });

  it("refuses even when the message reads as unclear", () => {
    const decision = askInBranch({}, {
      interpretation: { ...baseInterpret().interpretation, intent: "unclear" },
      turnRouting: { path: "grounded", socialFastPathEligible: false, factualRiskSignals: [] }
    });
    expect(decision.responseIntent).toBe("abstain");
  });

  it("still lets a goodbye close the conversation", () => {
    // Leaving is not the moment to argue about a name.
    const decision = askInBranch({}, { shouldCloseAfterReply: true });
    expect(decision.responseIntent).toBe("goodbye");
  });
});

describe("findUnrecognisedNames -- a capital owed to position is not a name (#184)", () => {
  const CORPUS =
    "Finnick Thorn owns a cheese shop called Say Cheese in Wordlark Hollow. His wife is Marigold Thorn. He grew up on Earendale.";

  it("THE REGRESSION: greeting the NPC by name is not an unknown place", () => {
    // Observed in play: "Hola Finnick!" produced
    // "You have never heard of Hola Finnick."
    expect(findUnrecognisedNames("Hola Finnick! Me llamo Mim.", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Hey Finnick, how are you?", CORPUS)).toEqual([]);
    expect(findUnrecognisedNames("Oh Finnick, that's funny!", CORPUS)).toEqual([]);
  });

  it("still catches a name that opens a sentence, when enough of it remains", () => {
    expect(
      findUnrecognisedNames("Brindlebear's Book Emporium is closed today.", CORPUS)
    ).toEqual(["Book Emporium"]);
  });

  it("still catches names mid-sentence, which is where they usually are", () => {
    expect(
      findUnrecognisedNames(
        "Do you know anything about a place called Brindlebear's Book Emporium?",
        CORPUS
      )
    ).toEqual(["Book Emporium"]);
    expect(
      findUnrecognisedNames("Have you been to the Brindlewick Observatory?", CORPUS)
    ).toEqual(["Brindlewick Observatory"]);
  });

  it("handles a sentence opening after punctuation, not just at the start", () => {
    expect(findUnrecognisedNames("Buenas tardes! Hola Finnick!", CORPUS)).toEqual([]);
  });
});

describe("resolvePlanDecision -- going in circles (#242)", () => {
  // `exhausted` needs BOTH halves: the player repeating themselves verbatim,
  // and two of the NPC's last three replies collapsing to one string. Measured
  // live: only the deterministic canned path produces the second half.
  const circling = [
    { role: "assistant" as const, text: "I'm listening." },
    { role: "user" as const, text: "wakka wakka" },
    { role: "assistant" as const, text: "I'm listening." },
    { role: "user" as const, text: "wakka wakka" }
  ];

  type PlanInput = Parameters<typeof resolvePlanDecision>[0];

  function circlingTurn(overrides: Partial<PlanInput> = {}) {
    return resolvePlanDecision({
      interpret: baseInterpret({ userText: "wakka wakka" }),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Nobody",
      history: circling,
      ...overrides
    });
  }

  it("talks about itself instead of asking what the player meant", () => {
    const decision = circlingTurn();
    expect(decision.noveltyState.exhausted).toBe(true);
    expect(decision.responseIntent).toBe("recover");
    expect(decision.recoveryStrategy).toBe("self-disclosure");
  });

  it("still reaches the writer rather than the canned short-circuit", () => {
    // Guards a property this change must not lose, NOT one it adds: the
    // outgoing `clarify` was already grounded, because only greet, chat and
    // answer can be generic-only. Passes before and after by design.
    expect(circlingTurn().responseSpecificity).toBe("grounded");
  });

  it("uses the character's own move when one is authored", () => {
    const decision = circlingTurn({
      recoveryStrategies: ["change-subject", "joke"],
      recoveryTurnCount: 1
    });
    expect(decision.recoveryStrategy).toBe("joke");
  });

  it("never converts a refusal -- 'I have never heard of it' survives", () => {
    const decision = circlingTurn({
      interpret: baseInterpret({
        userText: "wakka wakka",
        interpretation: {
          ...baseInterpret().interpretation,
          intent: "lore_world"
        },
        turnRouting: {
          path: "grounded",
          socialFastPathEligible: false,
          factualRiskSignals: []
        }
      }),
      unknownNamedEntities: ["Brindlebear's Book Emporium"]
    });
    expect(decision.noveltyState.exhausted).toBe(true);
    expect(decision.responseIntent).toBe("abstain");
    expect(decision.recoveryStrategy).toBeUndefined();
  });

  it("leaves goodbye and redirect alone", () => {
    const goodbye = circlingTurn({
      interpret: baseInterpret({ userText: "wakka wakka", shouldCloseAfterReply: true })
    });
    expect(goodbye.responseIntent).toBe("goodbye");
  });
});

describe("resolvePlanDecision -- gossip (#249)", () => {
  type PlanInput = Parameters<typeof resolvePlanDecision>[0];
  const circling = [
    { role: "assistant" as const, text: "I'm listening." },
    { role: "user" as const, text: "wakka wakka" },
    { role: "assistant" as const, text: "I'm listening." },
    { role: "user" as const, text: "wakka wakka" }
  ];
  function turn(overrides: Partial<PlanInput> = {}) {
    return resolvePlanDecision({
      interpret: baseInterpret({ userText: "wakka wakka" }),
      hasEvidence: false,
      hasMemory: false,
      hasActiveQuest: false,
      hasScriptedFollowup: false,
      npcDisplayName: "Finnick",
      history: circling,
      ...overrides
    });
  }

  it("gossips when the NPC has been told who the player is", () => {
    const decision = turn({
      recoveryStrategies: ["gossip"],
      knowsWhoThePlayerIs: true
    });
    expect(decision.recoveryStrategy).toBe("gossip");
    expect(decision.responseGoal).toContain("person you are talking to");
    expect(decision.responseGoal).toContain("Do not invent");
  });

  it("drops gossip from the menu when it would have to invent a person", () => {
    const decision = turn({
      recoveryStrategies: ["gossip", "change-subject"],
      knowsWhoThePlayerIs: false
    });
    expect(decision.recoveryStrategy).toBe("change-subject");
  });

  it("falls back to self-disclosure when gossip was the only move", () => {
    const decision = turn({
      recoveryStrategies: ["gossip"],
      knowsWhoThePlayerIs: false
    });
    expect(decision.recoveryStrategy).toBe("self-disclosure");
  });

  it("keeps rotating over the moves that remain", () => {
    const list: ("gossip" | "change-subject" | "joke")[] = [
      "gossip",
      "change-subject",
      "joke"
    ];
    const picks = [0, 1, 2].map(
      (n) =>
        turn({
          recoveryStrategies: list,
          knowsWhoThePlayerIs: false,
          recoveryTurnCount: n
        }).recoveryStrategy
    );
    expect(picks).toEqual(["change-subject", "joke", "change-subject"]);
  });
});
