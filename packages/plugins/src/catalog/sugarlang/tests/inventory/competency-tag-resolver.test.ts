/**
 * packages/plugins/src/catalog/sugarlang/tests/inventory/competency-tag-resolver.test.ts
 *
 * Purpose: Pins the competency tag resolver's join logic, per-NPC attribution,
 *   derive-at-read contract, and player-speaker exclusion.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/inventory/competency-tag-resolver.
 *   - Depends on es competency inventory for realistic fixture data.
 *
 * Implements: Plan 085 story 085.4
 *
 * Status: active
 */

import { PLAYER_SPEAKER } from "@sugarmagic/domain";
import { describe, expect, it } from "vitest";
import type { DialogueDefinition } from "@sugarmagic/domain";
import type { CompetencyInventory } from "../../runtime/contracts/competency-inventory";
import type { LexicalChunk } from "../../runtime/types";
import { resolveCompetencyTags } from "../../runtime/inventory/competency-tag-resolver";

// Minimal inventory with three functions and one chunk each.
const FIXTURE_INVENTORY: CompetencyInventory = {
  schemaVersion: "1",
  lang: "es",
  competencies: [
    {
      competencyId: "greet",
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
      competencyId: "thank",
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
      competencyId: "farewell",
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

describe("resolveCompetencyTags", () => {
  it("returns empty tags when scene has no chunks", () => {
    const result = resolveCompetencyTags(undefined, FIXTURE_INVENTORY, "es");
    expect(result.sceneCompetencies).toEqual([]);
    expect(result.npcCompetencies).toEqual({});
  });

  it("returns empty tags when scene chunk list is empty", () => {
    const result = resolveCompetencyTags([], FIXTURE_INVENTORY, "es");
    expect(result.sceneCompetencies).toEqual([]);
    expect(result.npcCompetencies).toEqual({});
  });

  it("scene tags: detects greet when buenos_dias chunk is in the scene", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneCompetencies).toContain("greet");
    expect(result.sceneCompetencies).not.toContain("thank");
    expect(result.sceneCompetencies).not.toContain("farewell");
  });

  it("scene tags: detects multiple functions when multiple chunks present", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "gracias", "hasta_luego"]);
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneCompetencies).toEqual(["farewell", "greet", "thank"]);
  });

  it("scene tags: ignores scene chunks that have no inventory match", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "unknown_chunk"]);
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(result.sceneCompetencies).toEqual(["greet"]);
  });

  it("npc tags: attributes chunk to correct NPC from interactionBinding", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const dialogues = [
      makeDialogue("npc-orrin", [{ text: "Buenos dias viajero!" }])
    ];
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcCompetencies["npc-orrin"]).toContain("greet");
  });

  it("npc tags: skips player-spoken nodes for NPC attribution", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "gracias"]);
    const dialogues = [
      makeDialogue("npc-orrin", [
        { text: "Buenos dias!", speakerId: undefined }, // NPC line (default)
        { text: "Gracias.", speakerId: PLAYER_SPEAKER.speakerId } // player line -- NOT attributed to NPC
      ])
    ];
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    // NPC only gets greet (from "Buenos dias!"), not thank (from player's "Gracias")
    expect(result.npcCompetencies["npc-orrin"]).toContain("greet");
    expect(result.npcCompetencies["npc-orrin"]).not.toContain("thank");
    // Scene still sees both chunks
    expect(result.sceneCompetencies).toContain("greet");
  });

  it("npc tags: undefined speakerId defaults to the bound NPC", () => {
    const sceneChunks = makeSceneChunks(["hasta_luego"]);
    const dialogues = [
      makeDialogue("npc-mira", [
        { text: "Hasta luego amigo." /* speakerId: undefined */ }
      ])
    ];
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcCompetencies["npc-mira"]).toContain("farewell");
  });

  it("npc tags: unbound dialogue (null npcDefinitionId) does not appear in npcCompetencies", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias"]);
    const dialogues = [
      makeDialogue(null, [{ text: "Buenos dias." }])
    ];
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(Object.keys(result.npcCompetencies)).toHaveLength(0);
  });

  it("npc tags: two NPCs in the same scene get separate function lists", () => {
    const sceneChunks = makeSceneChunks(["buenos_dias", "hasta_luego"]);
    const dialogues = [
      makeDialogue("npc-orrin", [{ text: "Buenos dias amigo!" }]),
      makeDialogue("npc-mira", [{ text: "Hasta luego." }])
    ];
    const result = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es", dialogues);
    expect(result.npcCompetencies["npc-orrin"]).toEqual(["greet"]);
    expect(result.npcCompetencies["npc-mira"]).toEqual(["farewell"]);
  });

  it("085.4 derive-at-read: inventory edit changes resolver output without a scene recompile", () => {
    // Seed a scene with apenas_dias (new chunk not in original inventory).
    const sceneChunks = makeSceneChunks(["buenos_dias", "apenas_dias"]);

    // Original inventory: no "apenas_dias" chunk.
    const before = resolveCompetencyTags(sceneChunks, FIXTURE_INVENTORY, "es");
    expect(before.sceneCompetencies).toEqual(["greet"]);

    // "Inventory edit": add a new function with apenas_dias.
    const editedInventory: CompetencyInventory = {
      ...FIXTURE_INVENTORY,
      competencies: [
        ...FIXTURE_INVENTORY.competencies,
        {
          competencyId: "greet-colloquial",
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
    const after = resolveCompetencyTags(sceneChunks, editedInventory, "es");
    expect(after.sceneCompetencies).toEqual(["greet", "greet-colloquial"]);
  });
});
