import { describe, expect, it } from "vitest";
import {
  createDefaultItemDefinition,
  normalizeItemDefinition
} from "@sugarmagic/domain";

describe("item readable documents", () => {
  it("creates default readable document scaffolding", () => {
    const definition = createDefaultItemDefinition();

    expect(definition.interactionView.readableDocument.template).toBe("book");
    expect(definition.interactionView.readableDocument.pages).toEqual([""]);
    expect(definition.interactionView.readableDocument.sections).toEqual([
      { heading: "", body: "" }
    ]);
  });

  it("normalizes partial readable document fields and preserves nested content", () => {
    const normalized = normalizeItemDefinition({
      displayName: "Town Bulletin",
      interactionView: {
        ...createDefaultItemDefinition().interactionView,
        kind: "readable",
        title: "Town Bulletin",
        readableDocument: {
          ...createDefaultItemDefinition().interactionView.readableDocument,
          template: "newspaper",
          subtitle: "Market Ward Edition",
          sections: [{ heading: "Festival Tonight", body: "Meet at dusk." }]
        }
      }
    });

    expect(normalized.interactionView.kind).toBe("readable");
    expect(normalized.interactionView.readableDocument.template).toBe("newspaper");
    expect(normalized.interactionView.readableDocument.subtitle).toBe(
      "Market Ward Edition"
    );
    expect(normalized.interactionView.readableDocument.pages).toEqual([""]);
    expect(normalized.interactionView.readableDocument.sections).toEqual([
      { heading: "Festival Tonight", body: "Meet at dusk." }
    ]);
  });
});
