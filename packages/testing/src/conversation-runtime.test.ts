import { describe, expect, it } from "vitest";
import {
  createConversationHost,
  type ConversationMiddleware,
  type ConversationProvider
} from "@sugarmagic/runtime-core";

describe("conversation host", () => {
  it("selects the first provider that can handle the session", async () => {
    const events: string[] = [];

    const fallbackProvider: ConversationProvider = {
      providerId: "fallback",
      displayName: "Fallback",
      priority: 100,
      canHandle: () => true,
      startSession: () => {
        events.push("fallback:start");
        return {
          session: {
            advance: () => null
          },
          initialTurn: {
            turnId: "fallback:start",
            providerId: "fallback",
            conversationKind: "scripted-dialogue",
            text: "Fallback",
            choices: []
          }
        };
      }
    };

    const preferredProvider: ConversationProvider = {
      providerId: "preferred",
      displayName: "Preferred",
      priority: 10,
      canHandle: () => true,
      startSession: () => {
        events.push("preferred:start");
        return {
          session: {
            advance: () => null
          },
          initialTurn: {
            turnId: "preferred:start",
            providerId: "preferred",
            conversationKind: "scripted-dialogue",
            text: "Preferred",
            choices: []
          }
        };
      }
    };

    const host = createConversationHost({
      providers: [fallbackProvider, preferredProvider]
    });

    const turn = await host.startSession({
      conversationKind: "scripted-dialogue",
      dialogueDefinitionId: "dialogue:test"
    });

    expect(turn?.providerId).toBe("preferred");
    expect(events).toEqual(["preferred:start"]);
  });

  it("runs middleware prepare and finalize in ordered stages", async () => {
    const sequence: string[] = [];

    const middlewareA: ConversationMiddleware = {
      middlewareId: "context-a",
      displayName: "Context A",
      priority: 20,
      stage: "context",
      prepare(context) {
        sequence.push("context-a:prepare");
        return {
          ...context,
          annotations: {
            ...context.annotations,
            contextA: true
          }
        };
      },
      finalize(context, turn) {
        sequence.push(`context-a:finalize:${String(context.annotations.contextA)}`);
        return turn;
      }
    };

    const middlewareB: ConversationMiddleware = {
      middlewareId: "analysis-b",
      displayName: "Analysis B",
      priority: 10,
      stage: "analysis",
      finalize(_context, turn) {
        sequence.push("analysis-b:finalize");
        return turn
          ? {
              ...turn,
              annotations: {
                ...turn.annotations,
                analyzed: true
              }
            }
          : turn;
      }
    };

    const provider: ConversationProvider = {
      providerId: "provider",
      displayName: "Provider",
      priority: 10,
      canHandle: () => true,
      startSession: ({ execution }) => {
        sequence.push(`provider:start:${String(execution.annotations.contextA)}`);
        return {
          session: {
            advance: () => null
          },
          initialTurn: {
            turnId: "provider:start",
            providerId: "provider",
            conversationKind: "scripted-dialogue",
            text: "Hello",
            choices: []
          }
        };
      }
    };

    const host = createConversationHost({
      providers: [provider],
      middlewares: [middlewareB, middlewareA]
    });

    const turn = await host.startSession({
      conversationKind: "scripted-dialogue",
      dialogueDefinitionId: "dialogue:test"
    });

    expect(sequence).toEqual([
      "context-a:prepare",
      "provider:start:true",
      "context-a:finalize:true",
      "analysis-b:finalize"
    ]);
    expect(turn?.annotations?.analyzed).toBe(true);
  });
});
