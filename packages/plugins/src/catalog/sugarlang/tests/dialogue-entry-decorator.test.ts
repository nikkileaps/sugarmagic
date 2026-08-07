/**
 * packages/plugins/src/catalog/sugarlang/tests/dialogue-entry-decorator.test.ts
 *
 * Purpose: Covers the player-turn half of the highlight contract -- celebrate
 *   when the player produces a taught word, and what a hover reports.
 *
 * Relationships:
 *   - Exercises runtime/dialogue-entry-decorator.ts, which had no tests at all
 *     despite writing to PERSISTED learner state through the hover path.
 *
 * Status: active
 */

import { PLAYER_SPEAKER } from "@sugarmagic/domain";
import type { ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSugarlangDialogueContribution,
  drainPendingHover
} from "../runtime/dialogue-entry-decorator";

function npcTurn(
  text: string,
  highlight: Record<string, unknown>
): ConversationTurnEnvelope {
  return {
    speakerId: "npc-1",
    text,
    annotations: { dialogueHighlight: highlight }
  } as unknown as ConversationTurnEnvelope;
}

function playerTurn(text: string): ConversationTurnEnvelope {
  return {
    speakerId: PLAYER_SPEAKER.speakerId,
    text,
    annotations: {}
  } as unknown as ConversationTurnEnvelope;
}

/** What the NPC turn carries once a slated verb contributes its forms. */
const HABLAR_HIGHLIGHT = {
  focusTerms: ["hablar", "hablo", "hablas", "habla", "hablé"],
  introduceTerms: ["hablar", "hablo", "hablas", "habla", "hablé"],
  celebrateTerms: [],
  glosses: { hablo: "speak, talk", hablas: "speak, talk" },
  creditByTerm: {
    hablar: "hablar",
    hablo: "hablar",
    hablas: "hablar",
    habla: "hablar",
    hablé: "hablar"
  }
};

describe("celebrate fires across a conjugation", () => {
  let contribution: ReturnType<typeof createSugarlangDialogueContribution>;

  beforeEach(() => {
    drainPendingHover();
    contribution = createSugarlangDialogueContribution();
  });

  it("celebrates when the player uses a DIFFERENT form than the NPC did", () => {
    // THE CASE THIS EXISTS FOR. The NPC said `hablo`; the player answers with
    // `hablas`. Two realizations of one slated word -- and matching used to be
    // a suffix guess that could not cross a stem change.
    contribution.decorate(npcTurn("Yo hablo espanol.", HABLAR_HIGHLIGHT));
    const turn = contribution.decorate(playerTurn("Tu hablas bien!"));

    const highlight = turn.annotations?.dialogueHighlight as {
      celebrateTerms: string[];
    };
    expect(highlight.celebrateTerms).toContain("hablas");
  });

  it("celebrates the citation form too", () => {
    contribution.decorate(npcTurn("Yo hablo espanol.", HABLAR_HIGHLIGHT));
    const turn = contribution.decorate(playerTurn("Quiero hablar contigo."));
    const highlight = turn.annotations?.dialogueHighlight as {
      celebrateTerms: string[];
    };
    expect(highlight.celebrateTerms).toContain("hablar");
  });

  it("does not celebrate a word that was never slated", () => {
    contribution.decorate(npcTurn("Yo hablo espanol.", HABLAR_HIGHLIGHT));
    const turn = contribution.decorate(playerTurn("Quiero queso."));
    expect(turn.annotations?.dialogueHighlight).toBeUndefined();
  });

  it("carries creditByTerm onto the PLAYER turn it rebuilds", () => {
    // The decorator writes a fresh annotation here, so a field it forgets is
    // gone for the one turn celebrate runs on.
    contribution.decorate(npcTurn("Yo hablo espanol.", HABLAR_HIGHLIGHT));
    const turn = contribution.decorate(playerTurn("Tu hablas bien!"));
    const highlight = turn.annotations?.dialogueHighlight as {
      creditByTerm: Record<string, string>;
    };
    expect(highlight.creditByTerm.hablas).toBe("hablar");
  });
});

describe("a hover reports what the term teaches", () => {
  beforeEach(() => {
    drainPendingHover();
  });

  it("reports the LEMMA when the player hovers an inflected form", () => {
    // A card is keyed by the thing taught. Hovering `hablo` must credit
    // `hablar`, or observe rejects it as a word the dictionary does not know.
    const contribution = createSugarlangDialogueContribution();
    contribution.decorate(npcTurn("Yo hablo espanol.", HABLAR_HIGHLIGHT));
    contribution.onTermHover({ term: "hablo", lang: "es", dwellMs: 800 });

    expect(drainPendingHover()?.lemmaId).toBe("hablar");
  });

  it("falls back to the term when nothing recorded a credit", () => {
    const contribution = createSugarlangDialogueContribution();
    contribution.onTermHover({ term: "queso", lang: "es", dwellMs: 800 });
    expect(drainPendingHover()?.lemmaId).toBe("queso");
  });
});
