import { createUuid } from "../shared/identity";

export type DocumentTemplate =
  | "book"
  | "newspaper"
  | "letter"
  | "postcard"
  | "flyer"
  | "sign"
  | "plaque"
  | "image-pages";

export interface DocumentSection {
  heading: string;
  body: string;
}

export interface DocumentDefinition {
  definitionId: string;
  displayName: string;
  subtitle?: string;
  template: DocumentTemplate;
  body: string;
  author: string;
  locationLine: string;
  dateLine: string;
  footer: string;
  backBody: string;
  pages: string[];
  sections: DocumentSection[];
  /**
   * Relative paths to managed page-image files. Populated only when
   * template is `"image-pages"`. Stored under
   * `assets/documents/<documentId>/page-N.png`. Not exposed as library
   * entries; resolved through the asset-source map at runtime.
   */
  imagePages: string[];
}

export function createDocumentDefinitionId(): string {
  return createUuid();
}

export function createDefaultDocumentDefinition(
  options: {
    definitionId?: string;
    displayName?: string;
    template?: DocumentTemplate;
  } = {}
): DocumentDefinition {
  return {
    definitionId: options.definitionId ?? createDocumentDefinitionId(),
    displayName: options.displayName ?? "New Document",
    subtitle: undefined,
    template: options.template ?? "book",
    body: "",
    author: "",
    locationLine: "",
    dateLine: "",
    footer: "",
    backBody: "",
    pages: [""],
    sections: [{ heading: "", body: "" }],
    imagePages: []
  };
}

export function normalizeDocumentDefinition(
  definition: Partial<DocumentDefinition> | null | undefined
): DocumentDefinition {
  const fallback = createDefaultDocumentDefinition();
  if (!definition) return fallback;

  return {
    definitionId: definition.definitionId ?? fallback.definitionId,
    displayName: definition.displayName ?? fallback.displayName,
    subtitle: definition.subtitle ?? undefined,
    template: definition.template ?? fallback.template,
    body: definition.body ?? fallback.body,
    author: definition.author ?? fallback.author,
    locationLine: definition.locationLine ?? fallback.locationLine,
    dateLine: definition.dateLine ?? fallback.dateLine,
    footer: definition.footer ?? fallback.footer,
    backBody: definition.backBody ?? fallback.backBody,
    pages:
      definition.pages && definition.pages.length > 0
        ? definition.pages.map((page) => page ?? "")
        : fallback.pages,
    sections:
      definition.sections && definition.sections.length > 0
        ? definition.sections.map((section) => ({
            heading: section.heading ?? "",
            body: section.body ?? ""
          }))
        : fallback.sections,
    imagePages:
      definition.imagePages && definition.imagePages.length > 0
        ? definition.imagePages.filter((path): path is string => typeof path === "string")
        : []
  };
}
