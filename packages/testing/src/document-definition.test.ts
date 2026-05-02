/**
 * DocumentDefinition image-pages regression tests.
 *
 * Guards Epic 040's additive domain shape: text templates keep their existing
 * fields, while image-page documents preserve managed page-image paths.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultDocumentDefinition,
  normalizeDocumentDefinition
} from "@sugarmagic/domain";

describe("document definitions", () => {
  it("defaults imagePages to an empty array for new text documents", () => {
    const definition = createDefaultDocumentDefinition();

    expect(definition.template).toBe("book");
    expect(definition.imagePages).toEqual([]);
  });

  it("normalizes legacy documents without dropping text fields", () => {
    const definition = normalizeDocumentDefinition({
      definitionId: "doc:legacy",
      displayName: "Legacy Letter",
      template: "letter",
      body: "Hello",
      pages: ["Page text"]
    });

    expect(definition.imagePages).toEqual([]);
    expect(definition.body).toBe("Hello");
    expect(definition.pages).toEqual(["Page text"]);
  });

  it("round-trips image page paths on image-pages documents", () => {
    const definition = normalizeDocumentDefinition({
      definitionId: "doc:image",
      displayName: "Map Folio",
      template: "image-pages",
      imagePages: [
        "assets/documents/doc-image/page-1.png",
        "assets/documents/doc-image/page-2.png"
      ]
    });

    expect(definition.template).toBe("image-pages");
    expect(definition.imagePages).toEqual([
      "assets/documents/doc-image/page-1.png",
      "assets/documents/doc-image/page-2.png"
    ]);
  });
});
