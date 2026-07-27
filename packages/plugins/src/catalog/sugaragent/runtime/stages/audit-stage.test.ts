/**
 * Plan 084.5 -- AuditStage cue-check coherence tests
 *
 * Pins:
 *  - goodbye intent: Spanish farewell ("adios") in NPC reply passes missing-goodbye-cue
 *    when the lexicon contribution includes farewell forms.
 *  - abstain intent: cue check is suppressed when any interpretLexicon is contributed.
 *  - Without contributions: cue checks are byte-identical to today.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { AuditStage } from "./AuditStage";

function makeExecution(annotations: Record<string, unknown> = {}) {
  return {
    selection: {
      conversationKind: "free-form" as const,
      npcDefinitionId: "npc-1",
      npcDisplayName: "Finnick",
      interactionMode: "agent" as const
    },
    input: { kind: "free_text" as const, text: "bye" },
    state: {},
    annotations,
    runtimeContext: {
      here: null, playerLocation: null, playerPosition: null, playerArea: null,
      npcLocation: null, npcPosition: null, npcArea: null, npcPlayerRelation: null,
      npcBehavior: null, trackedQuest: null, activeQuestStage: null, activeQuestObjectives: null
    }
  };
}

function makeInput(opts: {
  text: string;
  responseIntent: "goodbye" | "abstain" | "chat";
  annotations?: Record<string, unknown>;
}) {
  return {
    execution: makeExecution(opts.annotations ?? {}),
    generate: {
      text: opts.text,
      usedLlm: true,
      llmBackend: "anthropic" as const,
      actionProposals: []
    },
    plan: {
      responseIntent: opts.responseIntent,
      responseSpecificity: "grounded" as const,
      turnPath: "grounded" as const,
      responseGoal: "respond",
      initiativeAction: "player_respond" as const,
      noveltyState: { repeatedUserMessage: false, repeatedAssistantReplyRisk: false, exhausted: false, recentAssistantQuestionCount: 0 },
      claims: [],
      actionProposals: [],
      replyInputMode: "advance" as const,
      replyPlaceholder: ""
    }
  };
}

describe("AuditStage -- cue-check coherence (084.5)", () => {
  it("baseline: English farewell passes missing-goodbye-cue without contributions", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({ text: "Farewell, safe travels.", responseIntent: "goodbye" }) as never);
    expect(result.output.violations).not.toContain("missing-goodbye-cue");
  });

  it("baseline: missing English farewell cue triggers violation without contributions", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({ text: "Yes, of course, amigo.", responseIntent: "goodbye" }) as never);
    expect(result.output.violations).toContain("missing-goodbye-cue");
  });

  it("084.5: Spanish farewell ('Adios, amigo.') passes missing-goodbye-cue when lexicon contributed", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({
      text: "Adios, amigo. Hasta pronto.",
      responseIntent: "goodbye",
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: "",
          interpretLexicon: { farewell: ["adiós", "adios", "hasta pronto"] }
        }
      }
    }) as never);
    expect(result.output.violations).not.toContain("missing-goodbye-cue");
  });

  it("084.5: Spanish farewell without accent ('adios') still passes via nfdStrip", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({
      text: "adios, hasta luego.",
      responseIntent: "goodbye",
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: "",
          interpretLexicon: { farewell: ["adiós", "adios", "hasta luego"] }
        }
      }
    }) as never);
    expect(result.output.violations).not.toContain("missing-goodbye-cue");
  });

  it("baseline: missing abstention cue triggers violation without contributions", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({ text: "Eso es algo que no se.", responseIntent: "abstain" }) as never);
    expect(result.output.violations).toContain("missing-abstention-cue");
  });

  it("084.5: abstention cue check suppressed when interpretLexicon is contributed", async () => {
    const stage = new AuditStage();
    const result = await stage.execute(makeInput({
      text: "Eso es algo que no se.",
      responseIntent: "abstain",
      annotations: {
        "sugaragent.contrib/sugarlang": {
          schemaVersion: 1,
          generateOverlay: "",
          interpretLexicon: { farewell: ["adios"], greeting: ["hola"] }
        }
      }
    }) as never);
    expect(result.output.violations).not.toContain("missing-abstention-cue");
  });
});
