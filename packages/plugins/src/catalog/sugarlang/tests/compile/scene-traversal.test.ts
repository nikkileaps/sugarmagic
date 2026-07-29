/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/scene-traversal.test.ts
 *
 * Purpose: Verifies deterministic text-blob traversal for scene compilation.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/scene-traversal.
 *   - Depends on ./test-helpers for compact authored scene fixtures.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { DialogueDefinition } from "@sugarmagic/domain";
import {
  EXCERPT_SPEAKER,
  NARRATOR_SPEAKER,
  PLAYER_SPEAKER,
  PLAYER_VO_SPEAKER
} from "@sugarmagic/domain";
import { collectSceneText } from "../../runtime/compile/scene-traversal";
import { createTestSceneAuthoringContext } from "./test-helpers";

describe("collectSceneText", () => {
  it("collects the expected text blobs for a minimal scene", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());

    expect(blobs.map((blob) => blob.sourceKind)).toEqual(
      expect.arrayContaining([
        "dialogue",
        "npc-bio",
        "quest-objective",
        "quest-objective-display-name",
        "item-label",
        "region-label",
        "lore-page"
      ])
    );
  });

  it("is deterministic across repeated traversals", () => {
    const context = createTestSceneAuthoringContext();

    expect(collectSceneText(context)).toEqual(collectSceneText(context));
  });

  it("returns an empty array for an empty scene", () => {
    const blobs = collectSceneText(
      createTestSceneAuthoringContext({
        npcDefinitions: [],
        dialogueDefinitions: [],
        questDefinitions: [],
        itemDefinitions: [],
        documentDefinitions: [],
        region: {
          ...createTestSceneAuthoringContext().region,
          displayName: "",
          lorePageId: null,
          areas: []
        },
        // Plan 058 §058.1 — null Scene composes base-only:
        // no presences, matching the old empty-nest fixture.
        activeScene: null
      })
    );

    expect(blobs).toEqual([]);
  });
});

describe("dialogue blob NPC attribution (Plan 090.1)", () => {
  const dialogueBlobs = (context: Parameters<typeof collectSceneText>[0]) =>
    collectSceneText(context).filter((blob) => blob.sourceKind === "dialogue");

  const withNodes = (nodes: DialogueDefinition["nodes"]) =>
    createTestSceneAuthoringContext({
      dialogueDefinitions: [
        {
          definitionId: "dialogue-orrin",
          displayName: "Greeting",
          startNodeId: "node-1",
          interactionBinding: { npcDefinitionId: "npc-orrin" },
          nodes
        }
      ]
    });

  it("attributes an unset speaker to the bound NPC", () => {
    // Authoring default: no speakerId on an NPC dialogue means the NPC talks.
    const blobs = dialogueBlobs(
      withNodes([
        {
          nodeId: "node-1",
          displayName: "Greeting",
          text: "Hola viajero",
          next: [],
          graphPosition: { x: 0, y: 0 }
        }
      ])
    );

    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.npcDefinitionId).toBe("npc-orrin");
  });

  it("attributes an explicit NPC speaker to that NPC, not the bound one", () => {
    const blobs = dialogueBlobs(
      withNodes([
        {
          nodeId: "node-1",
          displayName: "Aside",
          text: "El queso es excelente",
          speakerId: "npc-finnick",
          next: [],
          graphPosition: { x: 0, y: 0 }
        }
      ])
    );

    expect(blobs[0]?.npcDefinitionId).toBe("npc-finnick");
  });

  it.each([
    ["player", PLAYER_SPEAKER.speakerId],
    ["player-vo", PLAYER_VO_SPEAKER.speakerId],
    ["narrator", NARRATOR_SPEAKER.speakerId],
    ["excerpt", EXCERPT_SPEAKER.speakerId]
  ])("leaves %s lines unattributed", (_label, speakerId) => {
    // The w_npc boost means "words this NPC says". Crediting the NPC with the
    // player's own choices or with narration would inflate it with vocabulary
    // they never speak.
    const blobs = dialogueBlobs(
      withNodes([
        {
          nodeId: "node-1",
          displayName: "Line",
          text: "Hola viajero",
          speakerId,
          next: [],
          graphPosition: { x: 0, y: 0 }
        }
      ])
    );

    expect(blobs[0]?.npcDefinitionId).toBeUndefined();
  });

  it("attributes per node, so one dialogue can split across speakers", () => {
    const blobs = dialogueBlobs(
      withNodes([
        {
          nodeId: "node-1",
          displayName: "NPC line",
          text: "Hola viajero",
          next: [],
          graphPosition: { x: 0, y: 0 }
        },
        {
          nodeId: "node-2",
          displayName: "Player choice",
          text: "Buenos dias",
          speakerId: PLAYER_SPEAKER.speakerId,
          next: [],
          graphPosition: { x: 0, y: 0 }
        }
      ])
    );

    expect(
      blobs.map((blob) => [blob.sourceId, blob.npcDefinitionId])
    ).toEqual([
      ["dialogue-orrin:node-1", "npc-orrin"],
      ["dialogue-orrin:node-2", undefined]
    ]);
  });
});
