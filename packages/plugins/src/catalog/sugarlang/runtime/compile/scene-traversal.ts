/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-traversal.ts
 *
 * Purpose: Collects authored scene text into a stable, compiler-friendly blob list.
 *
 * Exports:
 *   - TextBlobSourceKind
 *   - TextBlob
 *   - SceneAuthoringContext
 *   - createSceneAuthoringContext
 *   - collectSceneText
 *
 * Relationships:
 *   - Depends on authored domain types for region, dialogue, quest, NPC, item, and document content.
 *   - Is consumed by compile-sugarlang-scene and the preview/publish compile helpers.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
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
import type { SourceLocation } from "../types";

export type TextBlobSourceKind =
  | "dialogue"
  | "npc-bio"
  | "quest-objective"
  | "quest-objective-display-name"
  | "item-label"
  | "region-label"
  | "lore-page";

export interface TextBlob {
  sourceKind: TextBlobSourceKind;
  sourceId: string;
  sourceLocation: SourceLocation;
  text: string;
  weight: number;
  objectiveNodeId?: string;
  questDefinitionId?: string;
  objectiveDisplayName?: string;
}

export interface SceneAuthoringContext {
  sceneId: string;
  targetLanguage: string;
  region: RegionDocument;
  npcs: NPCDefinition[];
  dialogues: DialogueDefinition[];
  quests: QuestDefinition[];
  items: ItemDefinition[];
  lorePages: DocumentDefinition[];
}

const TEXT_BLOB_WEIGHTS: Record<TextBlobSourceKind, number> = {
  dialogue: 1,
  "npc-bio": 0.8,
  "quest-objective": 0.95,
  "quest-objective-display-name": 1,
  "item-label": 0.7,
  "region-label": 0.9,
  "lore-page": 0.5
};

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function buildSourceLocation(
  file: string,
  snippet: string
): SourceLocation {
  return {
    file,
    lineStart: 1,
    lineEnd: 1,
    snippet
  };
}

function trimText(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectRegionLabelBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  const regionDisplayName = trimText(context.region.displayName);
  if (regionDisplayName) {
    blobs.push({
      sourceKind: "region-label",
      sourceId: `region:${context.region.identity.id}`,
      sourceLocation: buildSourceLocation(
        `region:${context.region.identity.id}`,
        regionDisplayName
      ),
      text: regionDisplayName,
      weight: TEXT_BLOB_WEIGHTS["region-label"]
    });
  }

  for (const area of [...context.region.areas].sort((left, right) =>
    compareStrings(left.areaId, right.areaId)
  )) {
    const areaDisplayName = trimText(area.displayName);
    if (!areaDisplayName) {
      continue;
    }

    blobs.push({
      sourceKind: "region-label",
      sourceId: `area:${area.areaId}`,
      sourceLocation: buildSourceLocation(`area:${area.areaId}`, areaDisplayName),
      text: areaDisplayName,
      weight: TEXT_BLOB_WEIGHTS["region-label"]
    });
  }

  return blobs;
}

function collectNpcBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  for (const npc of [...context.npcs].sort((left, right) =>
    compareStrings(left.definitionId, right.definitionId)
  )) {
    const pieces = [trimText(npc.displayName), trimText(npc.description)].filter(
      (piece): piece is string => piece !== null
    );
    if (pieces.length === 0) {
      continue;
    }

    blobs.push({
      sourceKind: "npc-bio",
      sourceId: npc.definitionId,
      sourceLocation: buildSourceLocation(`npc:${npc.definitionId}`, pieces[0]!),
      text: pieces.join("\n"),
      weight: TEXT_BLOB_WEIGHTS["npc-bio"]
    });
  }

  return blobs;
}

function collectDialogueBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  for (const dialogue of [...context.dialogues].sort((left, right) =>
    compareStrings(left.definitionId, right.definitionId)
  )) {
    for (const node of [...dialogue.nodes].sort((left, right) =>
      compareStrings(left.nodeId, right.nodeId)
    )) {
      const text = trimText(node.text);
      if (!text) {
        continue;
      }

      blobs.push({
        sourceKind: "dialogue",
        sourceId: `${dialogue.definitionId}:${node.nodeId}`,
        sourceLocation: buildSourceLocation(
          `dialogue:${dialogue.definitionId}:${node.nodeId}`,
          text
        ),
        text,
        weight: TEXT_BLOB_WEIGHTS.dialogue
      });
    }
  }

  return blobs;
}

function collectQuestBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  for (const quest of [...context.quests].sort((left, right) =>
    compareStrings(left.definitionId, right.definitionId)
  )) {
    for (const stage of [...quest.stageDefinitions].sort((left, right) =>
      compareStrings(left.stageId, right.stageId)
    )) {
      for (const node of [...stage.nodeDefinitions].sort((left, right) =>
        compareStrings(left.nodeId, right.nodeId)
      )) {
        const displayName = trimText(node.displayName);
        if (displayName) {
          blobs.push({
            sourceKind: "quest-objective-display-name",
            sourceId: `${quest.definitionId}:${node.nodeId}:display-name`,
            sourceLocation: buildSourceLocation(
              `quest:${quest.definitionId}:${node.nodeId}:display-name`,
              displayName
            ),
            text: displayName,
            weight: TEXT_BLOB_WEIGHTS["quest-objective-display-name"],
            objectiveNodeId: node.nodeId,
            questDefinitionId: quest.definitionId,
            objectiveDisplayName: node.displayName
          });
        }

        const description = trimText(node.description);
        if (description) {
          blobs.push({
            sourceKind: "quest-objective",
            sourceId: `${quest.definitionId}:${node.nodeId}:description`,
            sourceLocation: buildSourceLocation(
              `quest:${quest.definitionId}:${node.nodeId}:description`,
              description
            ),
            text: description,
            weight: TEXT_BLOB_WEIGHTS["quest-objective"],
            objectiveNodeId: node.nodeId,
            questDefinitionId: quest.definitionId,
            objectiveDisplayName: node.displayName
          });
        }
      }
    }
  }

  return blobs;
}

function collectItemBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  for (const item of [...context.items].sort((left, right) =>
    compareStrings(left.definitionId, right.definitionId)
  )) {
    const parts = [
      trimText(item.displayName),
      trimText(item.description),
      trimText(item.interactionView.title),
      trimText(item.interactionView.body)
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      continue;
    }

    blobs.push({
      sourceKind: "item-label",
      sourceId: item.definitionId,
      sourceLocation: buildSourceLocation(`item:${item.definitionId}`, parts[0]!),
      text: parts.join("\n"),
      weight: TEXT_BLOB_WEIGHTS["item-label"]
    });
  }

  return blobs;
}

function collectLorePageBlobs(context: SceneAuthoringContext): TextBlob[] {
  const blobs: TextBlob[] = [];
  for (const document of [...context.lorePages].sort((left, right) =>
    compareStrings(left.definitionId, right.definitionId)
  )) {
    const parts = [
      trimText(document.displayName),
      trimText(document.subtitle),
      trimText(document.body),
      trimText(document.author),
      trimText(document.locationLine),
      trimText(document.dateLine),
      trimText(document.footer),
      trimText(document.backBody),
      ...document.pages.map((page) => trimText(page)),
      ...document.sections.flatMap((section) => [
        trimText(section.heading),
        trimText(section.body)
      ])
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      continue;
    }

    blobs.push({
      sourceKind: "lore-page",
      sourceId: document.definitionId,
      sourceLocation: buildSourceLocation(
        `lore:${document.definitionId}`,
        parts[0]!
      ),
      text: parts.join("\n"),
      weight: TEXT_BLOB_WEIGHTS["lore-page"]
    });
  }

  return blobs;
}

function referencesSceneRegion(
  quest: QuestDefinition,
  context: SceneAuthoringContext
): boolean {
  const areaIds = new Set(context.region.areas.map((area) => area.areaId));
  const npcIds = new Set(context.region.scene.npcPresences.map((presence) => presence.npcDefinitionId));
  const itemIds = new Set(context.region.scene.itemPresences.map((presence) => presence.itemDefinitionId));
  const dialogueIds = new Set(context.dialogues.map((dialogue) => dialogue.definitionId));

  return quest.stageDefinitions.some((stage) =>
    stage.nodeDefinitions.some((node) => {
      if (node.targetId && (areaIds.has(node.targetId) || npcIds.has(node.targetId) || itemIds.has(node.targetId))) {
        return true;
      }
      if (node.dialogueDefinitionId && dialogueIds.has(node.dialogueDefinitionId)) {
        return true;
      }
      return false;
    })
  );
}

function collectReferencedLorePages(
  region: RegionDocument,
  npcs: NPCDefinition[],
  items: ItemDefinition[],
  documents: DocumentDefinition[]
): DocumentDefinition[] {
  const referencedIds = new Set<string>();

  const pushMaybe = (value: string | null | undefined) => {
    if (typeof value === "string" && value.trim().length > 0) {
      referencedIds.add(value.trim());
    }
  };

  pushMaybe(region.lorePageId);
  for (const area of region.areas) {
    pushMaybe(area.lorePageId);
  }
  for (const npc of npcs) {
    pushMaybe(npc.lorePageId);
  }
  for (const item of items) {
    pushMaybe(item.interactionView.documentDefinitionId);
  }

  return documents.filter((document) => referencedIds.has(document.definitionId));
}

export interface CreateSceneAuthoringContextInput {
  region: RegionDocument;
  targetLanguage: string;
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
}

export function createSceneAuthoringContext(
  input: CreateSceneAuthoringContextInput
): SceneAuthoringContext {
  const npcIds = new Set(
    input.region.scene.npcPresences.map((presence) => presence.npcDefinitionId)
  );
  const itemIds = new Set(
    input.region.scene.itemPresences.map((presence) => presence.itemDefinitionId)
  );
  const npcs = input.npcDefinitions.filter((npc) => npcIds.has(npc.definitionId));
  const dialogues = input.dialogueDefinitions.filter((dialogue) =>
    dialogue.interactionBinding.npcDefinitionId
      ? npcIds.has(dialogue.interactionBinding.npcDefinitionId)
      : false
  );
  const items = input.itemDefinitions.filter((item) =>
    itemIds.has(item.definitionId)
  );
  const provisionalContext: SceneAuthoringContext = {
    sceneId: input.region.identity.id,
    targetLanguage: input.targetLanguage,
    region: input.region,
    npcs,
    dialogues,
    quests: [],
    items,
    lorePages: []
  };
  const quests = input.questDefinitions.filter((quest) =>
    referencesSceneRegion(quest, provisionalContext)
  );
  const lorePages = collectReferencedLorePages(
    input.region,
    npcs,
    items,
    input.documentDefinitions
  );

  return {
    ...provisionalContext,
    quests,
    lorePages
  };
}

export function collectSceneText(context: SceneAuthoringContext): TextBlob[] {
  const blobs = [
    ...collectRegionLabelBlobs(context),
    ...collectNpcBlobs(context),
    ...collectDialogueBlobs(context),
    ...collectQuestBlobs(context),
    ...collectItemBlobs(context),
    ...collectLorePageBlobs(context)
  ];

  return blobs
    .filter((blob) => blob.text.trim().length > 0)
    .sort((left, right) => {
      if (left.sourceKind !== right.sourceKind) {
        return compareStrings(left.sourceKind, right.sourceKind);
      }
      if (left.sourceId !== right.sourceId) {
        return compareStrings(left.sourceId, right.sourceId);
      }
      return compareStrings(left.text, right.text);
    });
}
