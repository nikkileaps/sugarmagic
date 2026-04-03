import { createUuid } from "../shared/identity";

export type ItemCategory = "quest" | "gift" | "key" | "misc";
export type ItemViewKind = "none" | "readable" | "examine" | "consumable";
export type ItemReadableTemplate =
  | "book"
  | "newspaper"
  | "letter"
  | "postcard"
  | "flyer";

export interface ItemInventoryProfile {
  stackable: boolean;
  maxStack: number;
  giftable: boolean;
}

export interface ItemPresentationProfile {
  modelAssetDefinitionId: string | null;
  modelHeight: number;
}

export interface ItemReadableSection {
  heading: string;
  body: string;
}

export interface ItemReadableDocument {
  template: ItemReadableTemplate;
  subtitle: string;
  author: string;
  locationLine: string;
  dateLine: string;
  footer: string;
  backBody: string;
  pages: string[];
  sections: ItemReadableSection[];
}

export interface ItemInteractionView {
  kind: ItemViewKind;
  title: string;
  body: string;
  consumeLabel: string;
  readableDocument: ItemReadableDocument;
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

export const DEFAULT_ITEM_MODEL_HEIGHT = 0.45;

export function createItemDefinitionId(): string {
  return createUuid();
}

export function createDefaultReadableDocument(
  template: ItemReadableTemplate = "book"
): ItemReadableDocument {
  return {
    template,
    subtitle: "",
    author: "",
    locationLine: "",
    dateLine: "",
    footer: "",
    backBody: "",
    pages: [""],
    sections: [{ heading: "", body: "" }]
  };
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
      modelHeight: DEFAULT_ITEM_MODEL_HEIGHT
    },
    interactionView: {
      kind: "none",
      title: "",
      body: "",
      consumeLabel: "Use",
      readableDocument: createDefaultReadableDocument()
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
      modelHeight:
        itemDefinition.presentation?.modelHeight ??
        defaultDefinition.presentation.modelHeight
    },
    interactionView: {
      kind: itemDefinition.interactionView?.kind ?? defaultDefinition.interactionView.kind,
      title:
        itemDefinition.interactionView?.title ?? defaultDefinition.interactionView.title,
      body: itemDefinition.interactionView?.body ?? defaultDefinition.interactionView.body,
      consumeLabel:
        itemDefinition.interactionView?.consumeLabel ??
        defaultDefinition.interactionView.consumeLabel,
      readableDocument: {
        template:
          itemDefinition.interactionView?.readableDocument?.template ??
          defaultDefinition.interactionView.readableDocument.template,
        subtitle:
          itemDefinition.interactionView?.readableDocument?.subtitle ??
          defaultDefinition.interactionView.readableDocument.subtitle,
        author:
          itemDefinition.interactionView?.readableDocument?.author ??
          defaultDefinition.interactionView.readableDocument.author,
        locationLine:
          itemDefinition.interactionView?.readableDocument?.locationLine ??
          defaultDefinition.interactionView.readableDocument.locationLine,
        dateLine:
          itemDefinition.interactionView?.readableDocument?.dateLine ??
          defaultDefinition.interactionView.readableDocument.dateLine,
        footer:
          itemDefinition.interactionView?.readableDocument?.footer ??
          defaultDefinition.interactionView.readableDocument.footer,
        backBody:
          itemDefinition.interactionView?.readableDocument?.backBody ??
          defaultDefinition.interactionView.readableDocument.backBody,
        pages:
          itemDefinition.interactionView?.readableDocument?.pages?.length &&
          itemDefinition.interactionView.readableDocument.pages.length > 0
            ? itemDefinition.interactionView.readableDocument.pages.map((page) => page ?? "")
            : defaultDefinition.interactionView.readableDocument.pages,
        sections:
          itemDefinition.interactionView?.readableDocument?.sections?.length &&
          itemDefinition.interactionView.readableDocument.sections.length > 0
            ? itemDefinition.interactionView.readableDocument.sections.map((section) => ({
                heading: section.heading ?? "",
                body: section.body ?? ""
              }))
            : defaultDefinition.interactionView.readableDocument.sections
      }
    }
  };
}
