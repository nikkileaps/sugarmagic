/**
 * packages/runtime-core/src/coordination/gameplay-session.test.ts
 *
 * Purpose: Verifies authored NPC metadata propagates into conversation selection and middleware execution.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests the NPC-to-selection mapping in ./gameplay-session.
 *   - Exercises the conversation host path that middlewares observe at runtime.
 *
 * Implements: Epic 2 Story 2.2 tests
 *
 * Status: active
 */

import { normalizeNPCDefinition } from "@sugarmagic/domain";
import { describe, expect, it } from "vitest";
import {
  createConversationHost,
  type ConversationMiddleware,
  type ConversationProvider
} from "../conversation";
import { createConversationSelectionFromNpc } from "./gameplay-session";

describe("gameplay session NPC metadata propagation", () => {
  it("copies NPC metadata into the selection context", () => {
    const selection = createConversationSelectionFromNpc({
      npcDefinition: normalizeNPCDefinition({
        definitionId: "npc.orinn",
        displayName: "Orrin",
        interactionMode: "agent",
        metadata: { sugarlangRole: "placement" }
      })
    });

    expect(selection?.metadata?.sugarlangRole).toBe("placement");
  });

  it("leaves selection metadata undefined when the NPC has no metadata", () => {
    const selection = createConversationSelectionFromNpc({
      npcDefinition: normalizeNPCDefinition({
        definitionId: "npc.orinn",
        displayName: "Orrin",
        interactionMode: "agent"
      })
    });

    expect(selection?.metadata).toBeUndefined();
  });

  it("clones metadata so selection mutations do not mutate the NPC definition", () => {
    const npcDefinition = normalizeNPCDefinition({
      definitionId: "npc.orinn",
      displayName: "Orrin",
      interactionMode: "agent",
      metadata: { sugarlangRole: "placement" }
    });
    const selection = createConversationSelectionFromNpc({ npcDefinition });

    if (!selection?.metadata) {
      throw new Error("expected metadata to be present");
    }

    selection.metadata.sugarlangRole = "changed";

    expect(npcDefinition.metadata?.sugarlangRole).toBe("placement");
  });

  it("merges preexisting selection metadata with NPC metadata and lets NPC keys win", () => {
    const selection = createConversationSelectionFromNpc({
      npcDefinition: normalizeNPCDefinition({
        definitionId: "npc.orinn",
        displayName: "Orrin",
        interactionMode: "agent",
        metadata: {
          sugarlangRole: "placement",
          sugarlangPlacementQuestionOverrideId: "npc-authored"
        }
      }),
      metadata: {
        source: "existing-selection",
        sugarlangPlacementQuestionOverrideId: "upstream"
      }
    });

    expect(selection?.metadata).toEqual({
      source: "existing-selection",
      sugarlangRole: "placement",
      sugarlangPlacementQuestionOverrideId: "npc-authored"
    });
  });

  it("lets middleware prepare hooks read propagated metadata from execution.selection", async () => {
    let observedRole: unknown = null;

    const middleware: ConversationMiddleware = {
      middlewareId: "test.capture-selection-metadata",
      displayName: "Capture Selection Metadata",
      priority: 0,
      stage: "context",
      prepare(context) {
        observedRole = context.selection.metadata?.sugarlangRole ?? null;
        return context;
      }
    };

    const provider: ConversationProvider = {
      providerId: "test.provider",
      displayName: "Test Provider",
      priority: 0,
      canHandle: () => true,
      startSession: () => ({
        session: {
          advance: () => null
        },
        initialTurn: {
          turnId: "turn-1",
          providerId: "test.provider",
          conversationKind: "free-form",
          text: "hello",
          choices: []
        }
      })
    };

    const host = createConversationHost({
      providers: [provider],
      middlewares: [middleware]
    });
    const selection = createConversationSelectionFromNpc({
      npcDefinition: normalizeNPCDefinition({
        definitionId: "npc.orinn",
        displayName: "Orrin",
        interactionMode: "agent",
        metadata: { sugarlangRole: "placement" }
      })
    });

    const initialTurn = selection ? await host.startSession(selection) : null;

    expect(initialTurn?.text).toBe("hello");
    expect(observedRole).toBe("placement");
  });
});
