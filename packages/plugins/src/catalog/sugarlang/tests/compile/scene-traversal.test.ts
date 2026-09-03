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
import {
  collectSceneText,
  projectSceneContextSources
} from "../../runtime/compile/scene-traversal";
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

describe("projectSceneContextSources (Plan 090.1)", () => {
  it("projects the authored sources the extractor reads", () => {
    const sources = projectSceneContextSources(createTestSceneAuthoringContext());

    // Every source must be identifiable: provenance is validated against these
    // ids, and a concept citing an id we never sent gets dropped.
    expect(sources.every((source) => source.sourceId.length > 0)).toBe(true);
    expect(sources.map((source) => source.kind)).toContain("npc");
    expect(sources.map((source) => source.kind)).toContain("region");
  });

  it("is deterministic across repeated projections", () => {
    const context = createTestSceneAuthoringContext();

    expect(projectSceneContextSources(context)).toEqual(
      projectSceneContextSources(context)
    );
  });

  it("passes an NPC bio through as prose for the model to infer from", () => {
    const context = createTestSceneAuthoringContext({
      npcDefinitions: [
        {
          definitionId: "npc-orrin",
          displayName: "Orrin",
          description: "A cheesemonger, forever waiting on a late shipment.",
          interactionMode: "agent",
          lorePageId: null,
          recoveryStrategies: [],
          presentation: {} as never
        }
      ]
    });

    const npc = projectSceneContextSources(context).find(
      (source) => source.sourceId === "npc:npc-orrin"
    );

    // "cheese" appears in no form the word-scanner can match -- inferring it
    // from this prose is the entire point of the pass.
    expect(npc?.prose).toContain("cheesemonger");
    expect(npc?.displayName).toBe("Orrin");
  });

  it("projects only NPCs actually present in the scene", () => {
    // createSceneAuthoringContext filters definitions down to those with a
    // presence, so an NPC defined but not placed contributes nothing. The
    // extractor should never describe someone who is not there.
    const context = createTestSceneAuthoringContext({
      npcDefinitions: [
        {
          definitionId: "npc-elsewhere",
          displayName: "Elsewhere",
          description: "Stands in another region entirely.",
          interactionMode: "agent",
          lorePageId: null,
          recoveryStrategies: [],
          presentation: {} as never
        }
      ]
    });

    expect(
      projectSceneContextSources(context).some((source) =>
        source.sourceId.includes("npc-elsewhere")
      )
    ).toBe(false);
  });

  it("attributes dialogue to the speaking NPC, not to the whole dialogue", () => {
    const sources = projectSceneContextSources(createTestSceneAuthoringContext());
    const dialogueSources = sources.filter((source) =>
      source.sourceId.startsWith("dialogue:")
    );

    // Per-NPC, because "what is this scene about" is not a per-line question.
    expect(dialogueSources.every((source) => source.kind === "npc")).toBe(true);
  });

  it("emits no source for content that is entirely empty", () => {
    const sources = projectSceneContextSources(
      createTestSceneAuthoringContext({
        npcDefinitions: [],
        dialogueDefinitions: [],
        itemDefinitions: [],
        documentDefinitions: [],
        activeScene: null,
        region: {
          ...createTestSceneAuthoringContext().region,
          displayName: "",
          lorePageId: null,
          areas: []
        }
      })
    );

    expect(sources).toEqual([]);
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
