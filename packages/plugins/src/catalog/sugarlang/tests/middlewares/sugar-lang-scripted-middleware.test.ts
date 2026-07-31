/**
 * packages/plugins/src/catalog/sugarlang/tests/middlewares/sugar-lang-scripted-middleware.test.ts
 *
 * Purpose: Pins the cost of rendering a scripted line: ZERO gateway calls.
 *
 * WHY THIS FILE DID NOT EXIST UNTIL NOW
 *   It didn't. The middleware that renders every scripted dialogue line had no
 *   tests at all, which is how a per-line LLM call (087.5) shipped to production
 *   and stayed there unobserved -- 087's own outstanding list recorded that no
 *   test ever fired its trigger. 090.8c deleted that call; this is the guard
 *   that stops it, or anything like it, coming back.
 *
 * WHY A CALL COUNT AND NOT AN OUTPUT ASSERTION
 *   Any assertion about rendered TEXT can pass while a gateway call happens
 *   behind it -- that is exactly the state we were in. A client whose `generate`
 *   throws is the only assertion that cannot be satisfied by accident, because
 *   the failure is the call itself rather than anything about the result.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises runtime/middlewares/sugar-lang-scripted-middleware.
 *
 * Implements: Plan 090 story 090.8c
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import { createSugarLangScriptedMiddleware } from "../../runtime/middlewares/sugar-lang-scripted-middleware";
import { CefrLexAtlasProvider } from "../../runtime/providers/impls/cefr-lex-atlas-provider";
import { SUGARLANG_CONSTRAINT_ANNOTATION } from "../../runtime/middlewares/shared";
import { createTestExecution } from "./test-helpers";

/**
 * A gateway that makes any call a test failure. Not a spy we assert on
 * afterwards -- a trap, so the failure names the call site in its stack.
 */
function forbiddenGateway() {
  return {
    generate: vi.fn(() => {
      throw new Error(
        "Rendering a scripted line must cost ZERO gateway calls (Plan 090.8c)."
      );
    })
  };
}

/**
 * `posture` is load-bearing here, and getting it wrong is how the first version
 * of this test proved nothing: the deleted live-render path lived in the
 * TARGET-DOMINANT branch. Anchored/supported returns before ever reaching it, so
 * an A1 fixture cannot exercise the thing being guarded.
 */
function scriptedConstraint(
  posture: "anchored" | "target-dominant" = "anchored"
) {
  const anchored = posture === "anchored";
  return {
    generatorPromptOverlay: "",
    minimalGreetingMode: false,
    targetVocab: { introduce: [], reinforce: [], avoid: [] },
    supportPosture: posture,
    targetLanguageRatio: anchored ? 0.3 : 0.85,
    interactionStyle: "listening_first" as const,
    glossingStrategy: anchored ? ("hover-only" as const) : ("none" as const),
    sentenceComplexityCap: "single-clause" as const,
    targetLanguage: "es",
    supportLanguage: "en",
    learnerCefr: anchored ? "A1" : "B1"
  };
}

/**
 * Services shaped to satisfy the DELETED trigger's every precondition.
 *
 * This matters more than it looks. A stub without an `intentCache` makes the
 * zero-call assertion pass trivially -- it passed against the pre-deletion code
 * too, which is how I caught that the first version of this test proved nothing.
 * The trigger needed: a nodeId, a schedule that is not strain-suppressed, an
 * intent cache, a cached artifact with `mustConveyFacts`, and a DUE teachable
 * whose id appears in those facts. All five are supplied here, so if the path
 * comes back, this test reaches it.
 */
function scriptedServices(llmClient: { generate: unknown }) {
  const resolved = {
    atlas: new CefrLexAtlasProvider(),
    llmClient,
    dialogueDefinitions: [],
    intentCache: {
      get: async () => ({
        artifact: { mustConveyFacts: ["queso"] }
      }),
      set: async () => undefined
    },
    liveRenderCache: undefined,
    variantCache: undefined
  };
  return {
    ...resolved,
    resolveForExecution: async () => resolved
  };
}

function scriptedExecution(
  posture: "anchored" | "target-dominant" = "anchored"
) {
  const execution = createTestExecution({
    selection: {
      conversationKind: "scripted-dialogue",
      npcDefinitionId: "npc-orrin",
      npcDisplayName: "Orrin",
      targetLanguage: "es",
      supportLanguage: "en",
      dialogueDefinitionId: "dialogue-1",
      metadata: {}
    }
  });
  execution.annotations[SUGARLANG_CONSTRAINT_ANNOTATION] = scriptedConstraint(posture);
  return execution;
}

/** The schedule shape the deleted trigger required: a DUE teachable. */
function dueSchedule() {
  return {
    teachables: [
      { id: "queso", kind: "vocabulary", teachReason: "due", affinityNpcIds: [] }
    ],
    isColdStart: false,
    sceneId: "scene-dock",
    conversationId: "c1",
    sceneComprehensionRate: 1,
    stretchAllowanceActive: false
  };
}

describe("scripted rendering costs nothing", () => {
  it("renders an authored line without calling the gateway", async () => {
    const llmClient = forbiddenGateway();
    const middleware = createSugarLangScriptedMiddleware({
      services: scriptedServices(llmClient) as never
    });
    const execution = scriptedExecution();

    const turn = await middleware.finalize?.(execution, {
      speakerId: "npc-orrin",
      text: "Good morning. Would you like some cheese?",
      metadata: { nodeId: "node-1" }
    } as never);

    expect(turn).toBeDefined();
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("costs nothing on a B1 line with a due teachable -- the exact deleted trigger", async () => {
    // THIS is the guard. Every precondition the 087.5 path required is present:
    // target-dominant posture, a nodeId, a non-suppressed schedule, an intent
    // cache, a cached artifact with mustConveyFacts, and a DUE teachable whose
    // id is in those facts. Verified to FAIL against the pre-deletion code --
    // without that check this file would be decoration.
    const llmClient = forbiddenGateway();
    const middleware = createSugarLangScriptedMiddleware({
      services: scriptedServices(llmClient) as never
    });
    const execution = scriptedExecution("target-dominant");
    execution.annotations["sugarlang.schedule"] = dueSchedule();

    await middleware.finalize?.(execution, {
      speakerId: "npc-orrin",
      text: "Good morning. Would you like some cheese?",
      metadata: { nodeId: "node-1" }
    } as never);

    expect(llmClient.generate).not.toHaveBeenCalled();
  });
});
