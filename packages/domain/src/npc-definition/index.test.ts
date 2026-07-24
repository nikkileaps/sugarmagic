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
