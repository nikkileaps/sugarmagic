import { createUuid } from "../shared/identity";

export type DocumentTemplate =
  | "book"
  | "newspaper"
  | "letter"
  | "postcard"
  | "flyer"
  | "sign"
  | "plaque";

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
    sections: [{ heading: "", body: "" }]
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
        : fallback.sections
  };
}
