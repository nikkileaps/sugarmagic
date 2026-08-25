/**
 * packages/runtime-core/src/npc/interaction-mode.test.ts
 *
 * Purpose: Pins quest-driven NPC interaction-mode switching --
 * the precedence rule, the override store and its save slice, and
 * the thing that actually matters: that a flip changes the SHAPE
 * of the conversation selection, because everything downstream
 * (sugaragent's `canHandle`, sugarlang's scripted gate) routes on
 * the derived `conversationKind` rather than on the mode itself.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  normalizeNPCDefinition,
  resolveEffectiveInteractionMode
} from "@sugarmagic/domain";
import { createConversationSelectionFromNpc } from "../coordination/gameplay-session";
import {
  createNpcInteractionModeSaveParticipant,
  NPC_INTERACTION_MODE_SLICE_SCHEMA_VERSION,
  NpcInteractionModeStore
} from "./interaction-mode-store";

function npc(mode: "scripted" | "agent") {
  return normalizeNPCDefinition({
    definitionId: "npc.finnick",
    displayName: "Finnick",
    interactionMode: mode
  });
}

describe("resolveEffectiveInteractionMode", () => {
  it("uses the definition when there is no override", () => {
    expect(resolveEffectiveInteractionMode("scripted", null)).toEqual({
      mode: "scripted",
      tier: "definition"
    });
  });

  it("lets an override win, in both directions", () => {
    expect(resolveEffectiveInteractionMode("scripted", "agent")).toEqual({
      mode: "agent",
      tier: "quest"
    });
    expect(resolveEffectiveInteractionMode("agent", "scripted")).toEqual({
      mode: "scripted",
      tier: "quest"
    });
  });

  it("treats undefined the same as no override", () => {
    expect(resolveEffectiveInteractionMode("agent", undefined).tier).toBe(
      "definition"
    );
  });
});

describe("NpcInteractionModeStore", () => {
  it("reports whether a set actually changed anything", () => {
    const store = new NpcInteractionModeStore();
    expect(store.set("npc.finnick", "agent")).toBe(true);
    // A no-op flip must NOT report a change: the Teacher warm is
    // invalidated off this, and re-warming costs a blocking call.
    expect(store.set("npc.finnick", "agent")).toBe(false);
    expect(store.set("npc.finnick", "scripted")).toBe(true);
  });

  it("clears back to the definition with null", () => {
    const store = new NpcInteractionModeStore();
    store.set("npc.finnick", "agent");
    expect(store.get("npc.finnick")).toBe("agent");
    expect(store.set("npc.finnick", null)).toBe(true);
    expect(store.get("npc.finnick")).toBeNull();
    expect(store.set("npc.finnick", null)).toBe(false);
  });

  it("notifies only on a real change, and stops after unsubscribe", () => {
    const store = new NpcInteractionModeStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.set("npc.finnick", "agent");
    store.set("npc.finnick", "agent");
    expect(calls).toBe(1);
    unsubscribe();
    store.set("npc.finnick", "scripted");
    expect(calls).toBe(1);
  });

  it("keeps every subscriber -- a second does not evict the first", () => {
    const store = new NpcInteractionModeStore();
    let first = 0;
    let second = 0;
    store.subscribe(() => {
      first += 1;
    });
    const stopSecond = store.subscribe(() => {
      second += 1;
    });
    store.set("npc.finnick", "agent");
    expect([first, second]).toEqual([1, 1]);
    stopSecond();
    store.set("npc.finnick", "scripted");
    expect([first, second]).toEqual([2, 1]);
  });
});

describe("npc.interaction-mode save slice", () => {
  it("round-trips overrides", () => {
    const source = new NpcInteractionModeStore();
    source.set("npc.finnick", "agent");
    source.set("npc.horace", "scripted");
    const participant = createNpcInteractionModeSaveParticipant({
      store: source
    });

    const restored = new NpcInteractionModeStore();
    createNpcInteractionModeSaveParticipant({ store: restored }).deserialize({
      schemaVersion: NPC_INTERACTION_MODE_SLICE_SCHEMA_VERSION,
      data: participant.serialize()
    });

    expect(restored.get("npc.finnick")).toBe("agent");
    expect(restored.get("npc.horace")).toBe("scripted");
  });

  it("restores before spawn -- host-owned tier", () => {
    // The mode decides how a conversation opens and which NPCs get
    // warmed, both read from the moment the world spawns.
    expect(
      createNpcInteractionModeSaveParticipant({
        store: new NpcInteractionModeStore()
      }).tier
    ).toBe("host-owned");
  });

  it("resets to empty on a null slice", () => {
    const store = new NpcInteractionModeStore();
    store.set("npc.finnick", "agent");
    createNpcInteractionModeSaveParticipant({ store }).deserialize(null);
    expect(store.get("npc.finnick")).toBeNull();
  });

  it("drops a mode that is no longer in the union", () => {
    // Falling back to the definition is the safe direction; keeping an
    // unknown string would reach the write normalizer, which throws.
    const store = new NpcInteractionModeStore();
    createNpcInteractionModeSaveParticipant({ store }).deserialize({
      schemaVersion: NPC_INTERACTION_MODE_SLICE_SCHEMA_VERSION,
      data: {
        overrides: {
          "npc.finnick": "guided" as unknown as "agent",
          "npc.horace": "agent"
        }
      }
    });
    expect(store.get("npc.finnick")).toBeNull();
    expect(store.get("npc.horace")).toBe("agent");
  });
});

describe("a flip changes the conversation selection shape", () => {
  it("scripted NPC forced to agent opens free-form", () => {
    const selection = createConversationSelectionFromNpc({
      npcDefinition: npc("scripted"),
      dialogueDefinitionId: "dialogue.finnick",
      interactionModeOverride: "agent"
    });
    // free-form is what sugaragent's canHandle tests for, so this is
    // the assertion that proves the flip reaches the agent pipeline.
    expect(selection?.conversationKind).toBe("free-form");
    expect(selection?.interactionMode).toBe("agent");
    // The authored dialogue rides along as the scripted follow-up
    // rather than being discarded.
    expect(selection?.scriptedFollowupDialogueDefinitionId).toBe(
      "dialogue.finnick"
    );
  });

  it("agent NPC forced to scripted opens scripted-dialogue", () => {
    const selection = createConversationSelectionFromNpc({
      npcDefinition: npc("agent"),
      dialogueDefinitionId: "dialogue.finnick",
      interactionModeOverride: "scripted"
    });
    expect(selection?.conversationKind).toBe("scripted-dialogue");
    expect(selection?.interactionMode).toBe("scripted");
  });

  it("an agent NPC forced to scripted with no dialogue has no conversation", () => {
    // Same rule a natively scripted NPC follows: scripted with nothing
    // to say is not a conversation.
    expect(
      createConversationSelectionFromNpc({
        npcDefinition: npc("agent"),
        interactionModeOverride: "scripted"
      })
    ).toBeNull();
  });

  it("no override leaves the authored mode alone", () => {
    expect(
      createConversationSelectionFromNpc({
        npcDefinition: npc("agent"),
        interactionModeOverride: null
      })?.conversationKind
    ).toBe("free-form");
    expect(
      createConversationSelectionFromNpc({
        npcDefinition: npc("scripted"),
        dialogueDefinitionId: "dialogue.finnick"
      })?.conversationKind
    ).toBe("scripted-dialogue");
  });
});
