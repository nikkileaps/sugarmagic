/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/compile-sugarlang-scene.test.ts
 *
 * Purpose: Verifies Epic 6's single scene lexicon compiler across profiles and diagnostics.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/compile-sugarlang-scene with deterministic fixture contexts.
 *   - Depends on ./test-helpers for compact scene, atlas, and morphology setup.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { compileSugarlangScene } from "../../runtime/compile/compile-sugarlang-scene";
import {
  createTestAtlasProvider,
  createTestMorphologyLoader,
  createTestSceneAuthoringContext
} from "./test-helpers";

function createCompileDependencies() {
  const atlas = createTestAtlasProvider("es", [
    { lemmaId: "station", cefrPriorBand: "A2", partsOfSpeech: ["noun"] },
    { lemmaId: "north", cefrPriorBand: "A1", partsOfSpeech: ["adjective"] },
    { lemmaId: "platform", cefrPriorBand: "A2", partsOfSpeech: ["noun"] },
    { lemmaId: "hola", cefrPriorBand: "A1", partsOfSpeech: ["interjection"] },
    { lemmaId: "viajero", cefrPriorBand: "A1", partsOfSpeech: ["noun"] },
    { lemmaId: "orrin", cefrPriorBand: "A1", partsOfSpeech: ["proper-noun"] },
    { lemmaId: "investigate", cefrPriorBand: "B1", partsOfSpeech: ["verb"] },
    { lemmaId: "altar", cefrPriorBand: "C1", partsOfSpeech: ["noun"] },
    { lemmaId: "etéreo", cefrPriorBand: "C2", partsOfSpeech: ["adjective"] },
    { lemmaId: "keeper", cefrPriorBand: "C1", partsOfSpeech: ["noun"] },
    { lemmaId: "temple", cefrPriorBand: "C1", partsOfSpeech: ["noun"] },
    { lemmaId: "oracle", cefrPriorBand: "C1", partsOfSpeech: ["noun"] },
    {
      lemmaId: "ticket",
      cefrPriorBand: "A2",
      partsOfSpeech: ["noun"],
      cefrPriorSource: "frequency-derived"
    }
  ]);
  const morphology = createTestMorphologyLoader("es", {
    station: "station",
    north: "north",
    platform: "platform",
    hola: "hola",
    viajero: "viajero",
    orrin: "orrin",
    investigate: "investigate",
    altar: "altar",
    etéreo: "etéreo",
    keeper: "keeper",
    temple: "temple",
    oracle: "oracle",
    ticket: "ticket"
  });

  return { atlas, morphology };
}

describe("compileSugarlangScene", () => {
  it("compiles a minimal scene into a lexicon with the expected lemmas", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );

    expect(Object.keys(lexicon.lemmas)).toContain("hola");
    expect(lexicon.lemmas.altar?.cefrPriorBand).toBe("C1");
    expect(lexicon.questEssentialLemmas.map((lemma) => lemma.lemmaId)).toEqual(
      expect.arrayContaining(["investigate", "altar", "etéreo", "keeper", "temple"])
    );
  });

  it("keeps semantic fields identical across profiles while stripping debug fields", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    const authoring = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "authoring-preview"
    );
    const runtime = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );
    const published = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "published-target"
    );

    expect({
      ...authoring,
      profile: "runtime-preview",
      sources: undefined,
      diagnostics: undefined
    }).toEqual(runtime);
    expect({ ...runtime, profile: "published-target" }).toEqual(published);
    expect(authoring.sources).toBeDefined();
    expect(authoring.diagnostics).toBeDefined();
    expect(runtime.sources).toBeUndefined();
    expect(runtime.diagnostics).toBeUndefined();
  });

  it("is deterministic for the same input", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    expect(
      compileSugarlangScene(context, atlas, morphology, "runtime-preview")
    ).toEqual(
      compileSugarlangScene(context, atlas, morphology, "runtime-preview")
    );
  });

  it("collects proper nouns from capitalized unknown forms", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );

    expect(lexicon.properNouns).toContain("Wordlark Hollow");
    expect(lexicon.properNouns).toContain("Wordlark");
  });

  it("emits authoring diagnostics for overly advanced scenes", () => {
    const context = createTestSceneAuthoringContext({
      dialogueDefinitions: [
        {
          definitionId: "dialogue-heavy",
          displayName: "Heavy",
          startNodeId: "node-1",
          interactionBinding: { npcDefinitionId: "npc-orrin" },
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Heavy",
              text: "altar etéreo keeper temple altar etéreo keeper temple",
              next: [],
              graphPosition: { x: 0, y: 0 }
            }
          ]
        }
      ]
    });
    const { atlas, morphology } = createCompileDependencies();

    const authoring = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "authoring-preview"
    );
    const runtime = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );

    expect(authoring.diagnostics?.some((warning) =>
      warning.message.includes("30% high-band lemmas")
    )).toBe(true);
    expect(runtime.diagnostics).toBeUndefined();
  });

  it("tags quest-essential lemmas with objective metadata", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );

    expect(lexicon.questEssentialLemmas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lemmaId: "investigate",
          sourceObjectiveNodeId: "objective-altar",
          sourceObjectiveDisplayName: "Investigate the Ethereal Altar"
        })
      ])
    );
  });

  it("deduplicates quest-essential lemmas by objective while preserving overlaps across objectives", () => {
    const context = createTestSceneAuthoringContext({
      questDefinitions: [
        ...createTestSceneAuthoringContext().quests,
        {
          definitionId: "quest-second",
          displayName: "Find Another Altar",
          description: "",
          startStageId: "stage-2",
          repeatable: false,
          rewardDefinitions: [],
          stageDefinitions: [
            {
              stageId: "stage-2",
              displayName: "Stage 2",
              nextStageId: null,
              entryNodeIds: ["objective-altar-2"],
              nodeDefinitions: [
                {
                  nodeId: "objective-altar-2",
                  displayName: "Check the Altar",
                  description: "altar temple",
                  nodeBehavior: "objective",
                  objectiveSubtype: "location",
                  targetId: "area-platform",
                  count: 1,
                  optional: false,
                  prerequisiteNodeIds: [],
                  failTargetNodeIds: [],
                  onEnterActions: [],
                  onCompleteActions: [],
                  showInHud: true,
                  graphPosition: { x: 0, y: 0 }
                }
              ]
            }
          ]
        }
      ]
    });
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );
    const altarEntries = lexicon.questEssentialLemmas.filter(
      (lemma) => lemma.lemmaId === "altar"
    );

    expect(altarEntries).toHaveLength(2);
    expect(new Set(altarEntries.map((entry) => entry.sourceObjectiveNodeId)).size).toBe(2);
  });

  it("returns an empty quest-essential list when no quests touch the scene", () => {
    const context = createTestSceneAuthoringContext({ questDefinitions: [] });
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "runtime-preview"
    );

    expect(lexicon.questEssentialLemmas).toEqual([]);
  });

  it("warns about deadlock-prone objectives under authoring-preview", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();

    const lexicon = compileSugarlangScene(
      context,
      atlas,
      morphology,
      "authoring-preview"
    );

    expect(lexicon.diagnostics?.some((warning) =>
      warning.message.includes("deadlock-prone")
    )).toBe(true);
  });

  it("stays within the performance budget for a medium fixture", () => {
    const context = createTestSceneAuthoringContext();
    const { atlas, morphology } = createCompileDependencies();
    const startedAt = performance.now();

    for (let index = 0; index < 50; index += 1) {
      compileSugarlangScene(context, atlas, morphology, "runtime-preview");
    }

    const averageDurationMs = (performance.now() - startedAt) / 50;
    expect(averageDurationMs).toBeLessThan(50);
  });
});
