/**
 * packages/plugins/src/catalog/sugarlang/tests/inventory/function-tag-resolver.test.ts
 *
 * Purpose: Pins the function tag resolver's join logic, per-NPC attribution,
 *   derive-at-read contract, and player-speaker exclusion.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/inventory/function-tag-resolver.
 *   - Depends on es function inventory for realistic fixture data.
 *
 * Implements: Plan 085 story 085.4
 *
 * Status: active
 */

import { PLAYER_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it } from "vitest";
import type { DialogueDefinition } from "@sugarmagic/domain";
import type { FunctionInventory } from "../../runtime/contracts/function-inventory";
import type { LexicalChunk } from "../../runtime/types";
import { resolveFunctionTags } from "../../runtime/inventory/function-tag-resolver";

// Minimal inventory with three functions and one chunk each.
const FIXTURE_INVENTORY: FunctionInventory = {
  schemaVersion: "1",
  lang: "es",
  functions: [
    {
      functionId: "greet",
      displayName: "Greet",
      cefrDescriptor: "Can greet.",
      band: "A1",
      chunks: {
        es: [
          {
            chunkId: "buenos_dias",
            normalizedForm: "buenos_dias",
            surfaceForms: ["buenos dias", "buenos días"],
            cefrBand: "A1",
            constituentLemmas: ["bueno", "dia"]
          }
        ]
      }
    },
    {
      functionId: "thank",
      displayName: "Thank",
      cefrDescriptor: "Can thank.",
      band: "A1",
      chunks: {
        es: [
          {
            chunkId: "gracias",
            normalizedForm: "gracias",
            surfaceForms: ["gracias"],
            cefrBand: "A1",
            constituentLemmas: ["gracia"]
          }
        ]
      }
    },
    {
      functionId: "farewell",
      displayName: "Farewell",
      cefrDescriptor: "Can say goodbye.",
      band: "A1",
      chunks: {
        es: [
          {
            chunkId: "hasta_luego",
            normalizedForm: "hasta_luego",
            surfaceForms: ["hasta luego"],
            cefrBand: "A1",
            constituentLemmas: ["hasta", "luego"]
          }
        ]
      }
    }
  ]
};

function makeSceneChunks(
  normForms: string[]
): LexicalChunk[] {
  return normForms.map((normForm) => ({
    chunkId: normForm,
    normalizedForm: normForm,
    surfaceForms: [normForm.replace(/_/g, " ")],
    cefrBand: "A1" as const,
    constituentLemmas: [],
    extractedByModel: "test",
    extractedAtMs: 1,
    extractorPromptVersion: "1",
    source: "llm-extracted" as const
  }));
}

function makeDialogue(
  npcId: string | null,
  nodes: Array<{ text: string; speakerId?: string }>
): DialogueDefinition {
  return {
    definitionId: `dialogue-${npcId ?? "unbound"}`,
    displayName: "Test",
    startNodeId: "node-0",
    interactionBinding: { npcDefinitionId: npcId },
    nodes: nodes.map((n, i) => ({
      nodeId: `node-${i}`,
      text: n.text,
      speakerId: n.speakerId,
      next: [],
      graphPosition: { x: 0, y: 0 }
    }))
  };
}

describe("resolveFunctionTags", () => {
  it("returns empty tags when scene has no chunks", () => {
    const result = resolveFunctionTags(undefined, FIXTURE_INVENTORY, "es");
    expect(result.sceneFunctions).toEqual([]);
    expect(result.npcFunctions).toEqual({});
  });

  it("returns empty tags when scene chunk list is empty", () => {
    const result = resolveFunctionTags([], FIXTURE_INVENTORY, "es");
    expect(result.sceneFunctions).toEqual([]);
    expect(result.npcFunctions).toEqual({});
  });

  it("scene tags: detects greet when buenos_dias chunk is in the scene", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneFunctions).toContain("greet");
    expect(result.sceneFunctions).not.toContain("thank");
    expect(result.sceneFunctions).not.toContain("farewell");
  });

  it("scene tags: detects multiple functions when multiple chunks present", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "gracias", "hasta_luego"]);
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneFunctions).toEqual(["farewell", "greet", "thank"]);
  });

  it("scene tags: ignores scene chunks that have no inventory match", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "unknown_chunk"]);
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneFunctions).toEqual(["greet"]);
  });

  it("npc tags: attributes chunk to correct NPC from interactionBinding", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const dialogues = [
      makeDialogue("npc-orrin", [{ text: "Buenos dias viajero!" }])
    ];
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcFunctions["npc-orrin"]).toContain("greet");
  });

  it("npc tags: skips player-spoken nodes for NPC attribution", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "gracias"]);
    const dialogues = [
      makeDialogue("npc-orrin", [
        { text: "Buenos dias!", speakerId: undefined }, // NPC line (default)
        { text: "Gracias.", speakerId: PLAYER_SPEAKER.speakerId } // player line -- NOT attributed to NPC
      ])
    ];
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    // NPC only gets greet (from "Buenos dias!"), not thank (from player's "Gracias")
    expect(result.npcFunctions["npc-orrin"]).toContain("greet");
    expect(result.npcFunctions["npc-orrin"]).not.toContain("thank");
    // Scene still sees both chunks
    expect(result.sceneFunctions).toContain("greet");
  });

  it("npc tags: undefined speakerId defaults to the bound NPC", () => {
    const sceneChunks = makeSceneChunks(["hasta_luego"]);
    const dialogues = [
      makeDialogue("npc-mira", [
        { text: "Hasta luego amigo." /* speakerId: undefined */ }
      ])
    ];
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcFunctions["npc-mira"]).toContain("farewell");
  });

  it("npc tags: unbound dialogue (null npcDefinitionId) does not appear in npcFunctions", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const dialogues = [
      makeDialogue(null, [{ text: "Buenos dias." }])
    ];
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(Object.keys(result.npcFunctions)).toHaveLength(0);
  });

  it("npc tags: two NPCs in the same scene get separate function lists", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "hasta_luego"]);
    const dialogues = [
      makeDialogue("npc-orrin", [{ text: "Buenos dias amigo!" }]),
      makeDialogue("npc-mira", [{ text: "Hasta luego." }])
    ];
    const result = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcFunctions["npc-orrin"]).toEqual(["greet"]);
    expect(result.npcFunctions["npc-mira"]).toEqual(["farewell"]);
  });

  it("085.4 derive-at-read: inventory edit changes resolver output without a scene recompile", () => {
    // Seed a scene with apenas_dias (new chunk not in original inventory).
    const sceneChunks = makeSceneChunks(["buenos_dias", "apenas_dias"]);

    // Original inventory: no "apenas_dias" chunk.
    const before = resolveFunctionTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(before.sceneFunctions).toEqual(["greet"]);

    // "Inventory edit": add a new function with apenas_dias.
    const editedInventory: FunctionInventory = {
      ...FIXTURE_INVENTORY,
      functions: [
        ...FIXTURE_INVENTORY.functions,
        {
          functionId: "greet-colloquial",
          displayName: "Greet (colloquial)",
          cefrDescriptor: "Can greet informally.",
          band: "A2",
          chunks: {
            es: [
              {
                chunkId: "apenas_dias",
                normalizedForm: "apenas_dias",
                surfaceForms: ["apenas dias"],
                cefrBand: "A2",
                constituentLemmas: ["apenas", "dia"]
              }
            ]
          }
        }
      ]
    };

    // No scene recompile: same sceneChunks, new inventory.
    const after = resolveFunctionTags(sceneChunks, editedInventory, "es");
    expect(after.sceneFunctions).toEqual(["greet", "greet-colloquial"]);
  });
});
