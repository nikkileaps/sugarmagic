/**
 * packages/domain/src/npc-definition/index.test.ts
 *
 * Purpose: Verifies NPC metadata normalization and JSON serialization behavior.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Tests the canonical NPCDefinition normalization seam in ./index.
 *   - Covers the metadata contract required by sugarlang's placement flow.
 *
 * Implements: Epic 2 Story 2.1 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultNPCDefinition,
  normalizeNPCDefinition,
  normalizeNPCDefinitionForWrite
} from "./index";

describe("npc-definition metadata normalization", () => {
  it("omits metadata from the default NPC definition", () => {
    const npc = createDefaultNPCDefinition();

    expect(npc).not.toHaveProperty("metadata");
  });

  it("preserves metadata objects during normalization", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Orrin",
      interactionMode: "agent",
      metadata: { sugarlangRole: "placement" }
    });

    expect(npc.metadata).toEqual({ sugarlangRole: "placement" });
  });

  it("strips null metadata during normalization", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Orrin",
      interactionMode: "agent",
      metadata: null as unknown as Record<string, unknown>
    });

    expect(npc).not.toHaveProperty("metadata");
  });

  it("strips non-object metadata during normalization", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Orrin",
      interactionMode: "agent",
      metadata: "not-an-object" as unknown as Record<string, unknown>
    });

    expect(npc).not.toHaveProperty("metadata");
  });

  it("preserves metadata across JSON round-trips", () => {
    const authored = normalizeNPCDefinitionForWrite({
      displayName: "Orrin",
      interactionMode: "agent",
      metadata: {
        sugarlangRole: "placement",
        sugarlangPlacementQuestionOverrideId: "orinn-intake-v1"
      }
    });

    const roundTripped = normalizeNPCDefinition(
      JSON.parse(JSON.stringify(authored)) as Record<string, unknown>
    );

    expect(roundTripped.metadata).toEqual(authored.metadata);
  });

  it("serializes cleanly when metadata is omitted", () => {
    const authored = normalizeNPCDefinitionForWrite({
      displayName: "Orrin",
      interactionMode: "agent"
    });

    const serialized = JSON.stringify(authored);

    expect(serialized).not.toContain("\"metadata\"");
  });
});

describe("recovery strategies", () => {
  it("defaults a project saved before the field existed to none", () => {
    // The migration boundary: an older project has no such key, and an NPC with
    // no strategies is legal -- it talks about itself.
    const npc = normalizeNPCDefinition({
      displayName: "Maren",
      interactionMode: "agent"
    });
    expect(npc.recoveryStrategies).toEqual([]);
  });

  it("keeps a note exactly as typed, so an author can type a space", () => {
    // normalize runs on the WRITE path, and the editor reads its value back
    // out of the store. Trimming here would delete the space the moment it was
    // typed, and a note could never be more than one word.
    const npc = normalizeNPCDefinitionForWrite({
      displayName: "Horace",
      interactionMode: "agent",
      recoveryStrategies: [{ strategy: "curt-exit", note: "He has " }]
    });
    expect(npc.recoveryStrategies[0]!.note).toBe("He has ");
  });

  it("drops a word that is not one of the six", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Maren",
      interactionMode: "agent",
      recoveryStrategies: [
        { strategy: "joke", note: "" },
        { strategy: "storms-off-in-a-huff", note: "she leaves" }
      ]
    } as never);
    expect(npc.recoveryStrategies.map((e) => e.strategy)).toEqual(["joke"]);
  });

  it("keeps the first entry when a strategy repeats", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Maren",
      interactionMode: "agent",
      recoveryStrategies: [
        { strategy: "joke", note: "first" },
        { strategy: "joke", note: "second" }
      ]
    } as never);
    expect(npc.recoveryStrategies).toEqual([{ strategy: "joke", note: "first" }]);
  });

  it("preserves authored order, because it decides what the NPC reaches for first", () => {
    const npc = normalizeNPCDefinition({
      displayName: "Finnick",
      interactionMode: "agent",
      recoveryStrategies: [
        { strategy: "gossip", note: "" },
        { strategy: "playful-probe", note: "" },
        { strategy: "change-subject", note: "" }
      ]
    } as never);
    expect(npc.recoveryStrategies.map((e) => e.strategy)).toEqual([
      "gossip",
      "playful-probe",
      "change-subject"
    ]);
  });

  it("survives a save and reload", () => {
    const authored = normalizeNPCDefinitionForWrite({
      displayName: "Bo",
      interactionMode: "agent",
      recoveryStrategies: [{ strategy: "self-disclosure", note: "The mountains." }]
    });
    const reloaded = normalizeNPCDefinition(
      JSON.parse(JSON.stringify(authored)) as Record<string, unknown>
    );
    expect(reloaded.recoveryStrategies).toEqual(authored.recoveryStrategies);
  });
});
