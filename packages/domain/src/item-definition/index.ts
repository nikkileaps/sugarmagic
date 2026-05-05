import { createUuid } from "../shared/identity";
import {
  normalizeCastableInvocation,
  type CastableInvocation
} from "../mechanics";

export type ItemCategory = "quest" | "gift" | "key" | "misc";
export type ItemViewKind =
  | "none"
  | "readable"
  | "examine"
  | "consumable"
  | "trigger-castable";

export interface ItemInventoryProfile {
  stackable: boolean;
  maxStack: number;
  giftable: boolean;
}

export interface ItemPresentationProfile {
  modelAssetDefinitionId: string | null;
  /**
   * Relative path to a managed PNG file under the project's
   * `assets/thumbnails/` folder. Generated via the "Generate Thumbnail"
   * button in the Item inspector — not user-editable directly.
   */
  thumbnailAssetPath: string | null;
}

export interface ItemInteractionView {
  kind: ItemViewKind;
  title: string;
  body: string;
  consumeLabel: string;
  documentDefinitionId: string | null;
  castableInvocation: CastableInvocation;
}

export interface ItemDefinition {
  definitionId: string;
  displayName: string;
  description?: string;
  category: ItemCategory;
  inventory: ItemInventoryProfile;
  presentation: ItemPresentationProfile;
  interactionView: ItemInteractionView;
}

export function createItemDefinitionId(): string {
  return createUuid();
}

export function createDefaultItemDefinition(
  options: {
    definitionId?: string;
    displayName?: string;
    description?: string;
  } = {}
): ItemDefinition {
  return {
    definitionId: options.definitionId ?? createItemDefinitionId(),
    displayName: options.displayName ?? "New Item",
    description: options.description,
    category: "misc",
    inventory: {
      stackable: false,
      maxStack: 1,
      giftable: false
    },
    presentation: {
      modelAssetDefinitionId: null,
      thumbnailAssetPath: null
    },
    interactionView: {
      kind: "none",
      title: "",
      body: "",
      consumeLabel: "Use",
      documentDefinitionId: null,
      castableInvocation: {
        id: "",
        args: {}
      }
    }
  };
}

export function normalizeItemDefinition(
  itemDefinition: Partial<ItemDefinition> | null | undefined
): ItemDefinition {
  const defaultDefinition = createDefaultItemDefinition();

  if (!itemDefinition) {
    return defaultDefinition;
  }

  return {
    definitionId: itemDefinition.definitionId ?? defaultDefinition.definitionId,
    displayName: itemDefinition.displayName ?? defaultDefinition.displayName,
    description: itemDefinition.description ?? undefined,
    category: itemDefinition.category ?? defaultDefinition.category,
    inventory: {
      stackable:
        itemDefinition.inventory?.stackable ?? defaultDefinition.inventory.stackable,
      maxStack:
        itemDefinition.inventory?.maxStack ?? defaultDefinition.inventory.maxStack,
      giftable:
        itemDefinition.inventory?.giftable ?? defaultDefinition.inventory.giftable
    },
    presentation: {
      modelAssetDefinitionId:
        itemDefinition.presentation?.modelAssetDefinitionId ??
        defaultDefinition.presentation.modelAssetDefinitionId,
      thumbnailAssetPath:
        itemDefinition.presentation?.thumbnailAssetPath ??
        defaultDefinition.presentation.thumbnailAssetPath
    },
    interactionView: {
      kind: itemDefinition.interactionView?.kind ?? defaultDefinition.interactionView.kind,
      title:
        itemDefinition.interactionView?.title ?? defaultDefinition.interactionView.title,
      body: itemDefinition.interactionView?.body ?? defaultDefinition.interactionView.body,
      consumeLabel:
        itemDefinition.interactionView?.consumeLabel ??
        defaultDefinition.interactionView.consumeLabel,
      documentDefinitionId:
        itemDefinition.interactionView?.documentDefinitionId ??
        defaultDefinition.interactionView.documentDefinitionId,
      castableInvocation: normalizeCastableInvocation(
        itemDefinition.interactionView?.castableInvocation,
        defaultDefinition.interactionView.castableInvocation.id
      )
    }
  };
}
