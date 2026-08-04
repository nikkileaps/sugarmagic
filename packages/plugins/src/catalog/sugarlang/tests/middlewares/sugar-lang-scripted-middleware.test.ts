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
import { SUGARLANG_CONSTRAINT_ANNOTATION,
  SUGARLANG_CURRICULUM_STATE_ANNOTATION
} from "../../runtime/middlewares/shared";
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

/** The learner state the deleted trigger required: a due item. */
function dueSchedule() {
  return {
    met: [],
    unmetCompetencyIds: [],
    dueItemIds: ["queso"],
    isColdStart: false,
    sceneId: "scene-dock",
    conversationId: "c1"
  };
}

describe("scripted rendering costs nothing", () => {
  function execution_forMarks() {
    return scriptedExecution("anchored");
  }

  it("090.11: an A1 line reads the baked variant instead of substituting", async () => {
    // THE BEHAVIOUR CHANGE. Beginner lines were the last ones realized at
    // runtime; every other band already read a bake. This is the pin that the
    // baked text actually reaches the player -- if the branch silently fell
    // through to substitution, the turn would still succeed and still cost no
    // gateway call, so nothing else here would notice.
    const llmClient = forbiddenGateway();
    const services = scriptedServices(llmClient) as unknown as {
      variantCache: unknown;
      resolveForExecution: () => Promise<unknown>;
    };
    const baked = { variant: { text: "Buenos dias. Quiere queso?" } };
    const resolved = await services.resolveForExecution();
    (resolved as { variantCache: unknown }).variantCache = {
      get: async () => baked
    };

    const middleware = createSugarLangScriptedMiddleware({
      services: services as never
    });
    const execution = scriptedExecution("anchored");

    const turn = await middleware.finalize?.(execution, {
      speakerId: "npc-orrin",
      text: "Good morning. Would you like some cheese?",
      metadata: { nodeId: "node-1" }
    } as never);

    expect(turn?.text).toBe("Buenos dias. Quiere queso?");
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("rf6.5.2: with no baked variant the AUTHORED ENGLISH is served unchanged", async () => {
    // CITATION-FORM SUBSTITUTION IS GONE FROM THIS PATH (nikki, 2026-07-31). A line with no variant is untaught
    // but correct and readable, which beats a line half-rewritten by a mechanism
    // that made no pedagogical decision.
    //
    // THIS TEST USED TO ASSERT `expect(turn?.text).toBeTruthy()`, which passes
    // whether the line was woven OR left alone -- so it could not tell the two
    // apart, and deleting substitution broke nothing. Asserting the EXACT authored
    // text is what makes the behaviour pinned instead of merely exercised.
    const authored = "Good morning. Would you like some cheese?";
    const llmClient = forbiddenGateway();
    const middleware = createSugarLangScriptedMiddleware({
      services: scriptedServices(llmClient) as never
    });
    const execution = scriptedExecution("anchored");

    const turn = await middleware.finalize?.(execution, {
      speakerId: "npc-orrin",
      text: authored,
      metadata: { nodeId: "node-1" }
    } as never);

    expect(turn?.text).toBe(authored);
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it("rf6.5.2: a baked line carries its MARKS to the turn annotation", async () => {
    // THE REGRESSION THIS CLOSES. Serving a baked variant set turn.text and
    // returned, never touching targetVocab -- which scripted mode leaves empty
    // because it never calls the Teacher. So observe built focusTerms from
    // nothing and a correctly baked line highlighted NOTHING, while a substituted
    // FALLBACK line highlighted fine. Exactly backwards.
    //
    // Pinning the ANNOTATION, not the text. Every other scripted test asserts
    // text, which is why this shipped unnoticed.
    const llmClient = forbiddenGateway();
    const services = scriptedServices(llmClient) as unknown as {
      resolveForExecution: () => Promise<unknown>;
    };
    const resolved = await services.resolveForExecution();
    (resolved as { variantCache: unknown }).variantCache = {
      get: async () => ({
        variant: {
          text: "Buenos dias. Quiere queso?",
          highlight: {
            focusTerms: ["queso", "buenos dias"],
            introduceTerms: ["queso"],
            glosses: { queso: "cheese" }
          }
        }
      })
    };

    const middleware = createSugarLangScriptedMiddleware({
      services: services as never
    });

    const turn = await middleware.finalize?.(execution_forMarks(), {
      speakerId: "npc-orrin",
      text: "Good morning. Would you like some cheese?",
      metadata: { nodeId: "node-1" }
    } as never);

    const highlight = turn?.annotations?.["dialogueHighlight"] as
      | { focusTerms: string[]; introduceTerms: string[]; glosses: Record<string, string> }
      | undefined;

    expect(highlight?.focusTerms).toEqual(["queso", "buenos dias"]);
    expect(highlight?.introduceTerms).toEqual(["queso"]);
    expect(highlight?.glosses).toEqual({ queso: "cheese" });
  });

  it("rf6.5.2: a variant with no marks writes no annotation rather than an empty one", async () => {
    // Variants baked before marks existed have no `highlight`. An empty
    // annotation would claim the line was examined and found to teach nothing,
    // which is a different statement from "this line was never marked".
    const llmClient = forbiddenGateway();
    const services = scriptedServices(llmClient) as unknown as {
      resolveForExecution: () => Promise<unknown>;
    };
    const resolved = await services.resolveForExecution();
    (resolved as { variantCache: unknown }).variantCache = {
      get: async () => ({ variant: { text: "Buenos dias." } })
    };

    const middleware = createSugarLangScriptedMiddleware({
      services: services as never
    });

    const turn = await middleware.finalize?.(execution_forMarks(), {
      speakerId: "npc-orrin",
      text: "Good morning.",
      metadata: { nodeId: "node-1" }
    } as never);

    expect(turn?.text).toBe("Buenos dias.");
    expect(turn?.annotations?.["dialogueHighlight"]).toBeUndefined();
  });

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
    execution.annotations[SUGARLANG_CURRICULUM_STATE_ANNOTATION] = dueSchedule();

    await middleware.finalize?.(execution, {
      speakerId: "npc-orrin",
      text: "Good morning. Would you like some cheese?",
      metadata: { nodeId: "node-1" }
    } as never);

    expect(llmClient.generate).not.toHaveBeenCalled();
  });
});
