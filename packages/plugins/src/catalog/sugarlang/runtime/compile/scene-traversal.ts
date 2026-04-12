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
  /** NPC definition ID that this blob is associated with, if any. */
  npcDefinitionId?: string;
}

export interface SceneLorePageSection {
  heading: string;
  body: string;
}

export interface SceneLorePage {
  lorePageId: string;
  displayName: string;
  subtitle?: string;
  body?: string;
  author?: string;
  locationLine?: string;
  dateLine?: string;
  footer?: string;
  backBody?: string;
  pages: string[];
  sections: SceneLorePageSection[];
}

export interface SceneAuthoringContext {
  sceneId: string;
  targetLanguage: string;
  supportLanguage: string;
  region: RegionDocument;
  npcs: NPCDefinition[];
  dialogues: DialogueDefinition[];
  quests: QuestDefinition[];
  items: ItemDefinition[];
  lorePages: SceneLorePage[];
}

const TEXT_BLOB_WEIGHTS: Record<TextBlobSourceKind, number> = {
  dialogue: 1,
  "npc-bio": 1,
  "quest-objective": 0.95,
  "quest-objective-display-name": 1,
  "item-label": 0.7,
  "region-label": 0.4,
  "lore-page": 1
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
      weight: TEXT_BLOB_WEIGHTS["npc-bio"],
      npcDefinitionId: npc.definitionId
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
  for (const page of [...context.lorePages].sort((left, right) =>
    compareStrings(left.lorePageId, right.lorePageId)
  )) {
    const parts = [
      trimText(page.displayName),
      trimText(page.subtitle),
      trimText(page.body),
      trimText(page.author),
      trimText(page.locationLine),
      trimText(page.dateLine),
      trimText(page.footer),
      trimText(page.backBody),
      ...page.pages.map((entry) => trimText(entry)),
      ...page.sections.flatMap((section) => [
        trimText(section.heading),
        trimText(section.body)
      ])
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      continue;
    }

    blobs.push({
      sourceKind: "lore-page",
      sourceId: page.lorePageId,
      sourceLocation: buildSourceLocation(
        `lore:${page.lorePageId}`,
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
  documents: DocumentDefinition[],
  resolvedLorePages: SceneLorePage[]
): SceneLorePage[] {
  const lorePageIds = new Set<string>();
  const itemDocumentIds = new Set<string>();

  const pushMaybe = (value: string | null | undefined) => {
    if (typeof value === "string" && value.trim().length > 0) {
      lorePageIds.add(value.trim());
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
    const documentDefinitionId = item.interactionView.documentDefinitionId;
    if (
      typeof documentDefinitionId === "string" &&
      documentDefinitionId.trim().length > 0
    ) {
      itemDocumentIds.add(documentDefinitionId.trim());
    }
  }

  const pagesById = new Map<string, SceneLorePage>();

  for (const page of resolvedLorePages) {
    if (lorePageIds.has(page.lorePageId)) {
      pagesById.set(page.lorePageId, page);
    }
  }

  for (const document of documents) {
    const documentId = document.definitionId.trim();
    if (!itemDocumentIds.has(documentId) && pagesById.has(documentId)) {
      continue;
    }
    if (!lorePageIds.has(documentId) && !itemDocumentIds.has(documentId)) {
      continue;
    }
    pagesById.set(documentId, sceneLorePageFromDocumentDefinition(document));
  }

  return [...pagesById.values()].sort((left, right) =>
    compareStrings(left.lorePageId, right.lorePageId)
  );
}

export interface CreateSceneAuthoringContextInput {
  region: RegionDocument;
  targetLanguage: string;
  supportLanguage?: string;
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  resolvedLorePages?: SceneLorePage[];
}

export function sceneLorePageFromDocumentDefinition(
  document: DocumentDefinition
): SceneLorePage {
  return {
    lorePageId: document.definitionId,
    displayName: document.displayName,
    subtitle: document.subtitle,
    body: document.body,
    author: document.author,
    locationLine: document.locationLine,
    dateLine: document.dateLine,
    footer: document.footer,
    backBody: document.backBody,
    pages: [...document.pages],
    sections: document.sections.map((section) => ({
      heading: section.heading,
      body: section.body
    }))
  };
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
    supportLanguage: input.supportLanguage ?? "en",
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
    input.documentDefinitions,
    input.resolvedLorePages ?? []
  );

  return {
    ...provisionalContext,
    quests,
    lorePages
  };
}

export function collectSceneText(context: SceneAuthoringContext): TextBlob[] {
  // Build lorePageId → npcDefinitionId reverse map so lore page blobs
  // can be tagged with the NPC they belong to.
  const lorePageToNpc = new Map<string, string>();
  for (const npc of context.npcs) {
    if (npc.lorePageId) {
      lorePageToNpc.set(npc.lorePageId, npc.definitionId);
    }
  }

  const loreBlobs = collectLorePageBlobs(context).map((blob) => {
    const npcId = lorePageToNpc.get(blob.sourceId);
    return npcId ? { ...blob, npcDefinitionId: npcId } : blob;
  });

  const blobs = [
    ...collectRegionLabelBlobs(context),
    ...collectNpcBlobs(context),
    ...collectDialogueBlobs(context),
    ...collectQuestBlobs(context),
    ...collectItemBlobs(context),
    ...loreBlobs
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
