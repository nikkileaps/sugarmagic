/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/test-helpers.ts
 *
 * Purpose: Shares compact scene-authoring fixtures for Epic 6 compile tests.
 *
 * Exports:
 *   - createTestRegion
 *   - createTestSceneAuthoringContext
 *   - createTestAtlasProvider
 *   - createTestMorphologyLoader
 *
 * Relationships:
 *   - Is consumed by the compile test suite in this directory.
 *   - Keeps test-only fixture wiring out of the runtime compiler modules.
 *
 * Implements: Epic 6 compile test support
 *
 * Status: active
 */

import type {
  DialogueDefinition,
  DocumentDefinition,
  ItemDefinition,
  NPCDefinition,
  QuestDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import {
  createDefaultRegionLandscapeState,
  createRegionAreaDefinition,
  createRegionItemPresence,
  createRegionNPCPresence
} from "@sugarmagic/domain";
import type {
  AtlasLemmaEntry,
  CEFRBand,
  LemmaRef,
  LexicalAtlasProvider
} from "../../runtime/types";
import { MorphologyLoader, type MorphologyDataFile } from "../../runtime/classifier/morphology-loader";
import {
  createSceneAuthoringContext,
  type SceneAuthoringContext
} from "../../runtime/compile/scene-traversal";

export function createTestAtlasProvider(
  lang: string,
  entries: Array<{
    lemmaId: string;
    cefrPriorBand: CEFRBand;
    frequencyRank?: number;
    partsOfSpeech?: string[];
    gloss?: string;
    cefrPriorSource?: AtlasLemmaEntry["cefrPriorSource"];
  }>
): LexicalAtlasProvider {
  const byLemma = new Map<string, AtlasLemmaEntry>();
  for (const entry of entries) {
    byLemma.set(entry.lemmaId, {
      lemmaId: entry.lemmaId,
      lang,
      cefrPriorBand: entry.cefrPriorBand,
      frequencyRank: entry.frequencyRank ?? 1,
      partsOfSpeech: entry.partsOfSpeech ?? ["noun"],
      glosses: entry.gloss ? { en: entry.gloss } : undefined,
      cefrPriorSource: entry.cefrPriorSource
    });
  }

  return {
    getLemma(lemmaId: string): AtlasLemmaEntry | undefined {
      return byLemma.get(lemmaId);
    },
    getBand(lemmaId: string): CEFRBand | undefined {
      return byLemma.get(lemmaId)?.cefrPriorBand;
    },
    getFrequencyRank(lemmaId: string): number | undefined {
      return byLemma.get(lemmaId)?.frequencyRank ?? undefined;
    },
    listLemmasAtBand(band: CEFRBand): LemmaRef[] {
      return [...byLemma.values()]
        .filter((entry) => entry.cefrPriorBand === band)
        .map((entry) => ({ lemmaId: entry.lemmaId, lang: entry.lang }));
    },
    getGloss(lemmaId: string, _lang: string, supportLang: string): string | undefined {
      return byLemma.get(lemmaId)?.glosses?.[supportLang];
    },
    resolveFromGloss(): AtlasLemmaEntry[] {
      return [];
    },
    getAtlasVersion(): string {
      return "test-atlas-v1";
    }
  };
}

export function createTestMorphologyLoader(
  lang: string,
  forms: Record<string, string>
): MorphologyLoader {
  const data: MorphologyDataFile = {
    lang,
    forms: Object.fromEntries(
      Object.entries(forms).map(([surfaceForm, lemmaId]) => [
        surfaceForm,
        {
          lemmaId,
          partsOfSpeech: ["test"]
        }
      ])
    )
  };

  return new MorphologyLoader({ [lang]: data });
}

export function createTestRegion(): RegionDocument {
  return {
    identity: {
      id: "scene-station",
      schema: "region-document",
      version: 1
    },
    displayName: "Wordlark Hollow Station",
    lorePageId: "doc-region",
    placement: {
      gridPosition: { x: 0, y: 0 },
      placementPolicy: "world-grid"
    },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [createRegionNPCPresence({ npcDefinitionId: "npc-orrin" })],
      itemPresences: [createRegionItemPresence({ itemDefinitionId: "item-ticket" })]
    },
    environmentBinding: {
      defaultEnvironmentId: null
    },
    areas: [
      createRegionAreaDefinition({
        areaId: "area-platform",
        displayName: "North Platform",
        lorePageId: "doc-platform"
      })
    ],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState(),
    markers: [],
    gameplayPlacements: []
  };
}

export function createTestDocumentDefinitions(): DocumentDefinition[] {
  return [
    {
      definitionId: "doc-region",
      displayName: "Station Guide",
      template: "book",
      body: "Wordlark Hollow welcomes travelers.",
      author: "Guild Clerk",
      locationLine: "Station Hall",
      dateLine: "Spring",
      footer: "",
      backBody: "",
      pages: ["Welcome to Wordlark Hollow."],
      sections: [{ heading: "Entry", body: "Speak to Orrin." }]
    },
    {
      definitionId: "doc-platform",
      displayName: "North Platform Notice",
      template: "sign",
      body: "Boarding at dawn.",
      author: "",
      locationLine: "",
      dateLine: "",
      footer: "",
      backBody: "",
      pages: [""],
      sections: [{ heading: "", body: "" }]
    },
    {
      definitionId: "doc-npc",
      displayName: "Orrin Notes",
      template: "book",
      body: "Orrin keeps the station calm.",
      author: "",
      locationLine: "",
      dateLine: "",
      footer: "",
      backBody: "",
      pages: [""],
      sections: [{ heading: "", body: "" }]
    },
    {
      definitionId: "doc-ticket",
      displayName: "Ticket Copy",
      template: "letter",
      body: "Platform 1 only.",
      author: "",
      locationLine: "",
      dateLine: "",
      footer: "",
      backBody: "",
      pages: [""],
      sections: [{ heading: "", body: "" }]
    }
  ];
}

export function createTestSceneAuthoringContext(
  overrides: Partial<{
    targetLanguage: string;
    region: RegionDocument;
    npcDefinitions: NPCDefinition[];
    dialogueDefinitions: DialogueDefinition[];
    questDefinitions: QuestDefinition[];
    itemDefinitions: ItemDefinition[];
    documentDefinitions: DocumentDefinition[];
  }> = {}
): SceneAuthoringContext {
  const region = overrides.region ?? createTestRegion();
  const npcDefinitions =
    overrides.npcDefinitions ??
    [
      {
        definitionId: "npc-orrin",
        displayName: "Orrin",
        description: "Station manager of Wordlark Hollow.",
        interactionMode: "agent",
        lorePageId: "doc-npc",
        presentation: {
          modelAssetDefinitionId: null,
          modelHeight: 1.7,
          animationAssetBindings: { idle: null, walk: null, run: null }
        }
      }
    ];
  const dialogueDefinitions =
    overrides.dialogueDefinitions ??
    [
      {
        definitionId: "dialogue-orrin",
        displayName: "Greeting",
        startNodeId: "node-1",
        interactionBinding: { npcDefinitionId: "npc-orrin" },
        nodes: [
          {
            nodeId: "node-1",
            displayName: "Greeting",
            text: "Hola viajero",
            next: [],
            graphPosition: { x: 0, y: 0 }
          }
        ]
      }
    ];
  const questDefinitions =
    overrides.questDefinitions ??
    [
      {
        definitionId: "quest-altar",
        displayName: "Investigate the Ethereal Altar",
        description: "Find the strange altar in the station.",
        startStageId: "stage-1",
        repeatable: false,
        rewardDefinitions: [],
        stageDefinitions: [
          {
            stageId: "stage-1",
            displayName: "Stage 1",
            nextStageId: null,
            entryNodeIds: ["objective-altar"],
            nodeDefinitions: [
                {
                  nodeId: "objective-altar",
                  displayName: "Investigate the Ethereal Altar",
                  description: "Go to the altar etéreo beside the platform keeper temple oracle",
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
    ];
  const itemDefinitions =
    overrides.itemDefinitions ??
    [
      {
        definitionId: "item-ticket",
        displayName: "Train Ticket",
        description: "A stamped station ticket.",
        category: "quest",
        inventory: {
          stackable: false,
          maxStack: 1,
          giftable: false
        },
        presentation: {
          modelAssetDefinitionId: null,
          modelHeight: 0.45
        },
        interactionView: {
          kind: "readable",
          title: "Ticket",
          body: "Wordlark Hollow - North Platform",
          consumeLabel: "Read",
          documentDefinitionId: "doc-ticket"
        }
      }
    ];
  const documentDefinitions =
    overrides.documentDefinitions ?? createTestDocumentDefinitions();

  return createSceneAuthoringContext({
    region,
    targetLanguage: overrides.targetLanguage ?? "es",
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    itemDefinitions,
    documentDefinitions
  });
}
