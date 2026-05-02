/**
 * Inventory readable-document flow tests.
 *
 * Guards that readable items resolve their bound image-pages document through
 * the same item -> document binding path as existing text documents.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultDocumentDefinition,
  createDefaultItemDefinition
} from "@sugarmagic/domain";
import { createDocumentDefinitionFromItem } from "@sugarmagic/runtime-core";

describe("inventory readable image-page documents", () => {
  it("resolves a bound image-pages document from a readable item", () => {
    const document = createDefaultDocumentDefinition({
      definitionId: "document:map",
      displayName: "Map"
    });
    document.template = "image-pages";
    document.imagePages = ["assets/documents/document-map/page-1.png"];

    const item = createDefaultItemDefinition({
      definitionId: "item:map",
      displayName: "Map Item"
    });
    item.interactionView = {
      ...item.interactionView,
      kind: "readable",
      documentDefinitionId: document.definitionId
    };

    expect(createDocumentDefinitionFromItem(item, [document])).toEqual(document);
  });
});
