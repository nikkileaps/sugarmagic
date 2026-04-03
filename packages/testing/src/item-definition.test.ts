import { describe, expect, it } from "vitest";
import {
  createDefaultItemDefinition,
  normalizeItemDefinition
} from "@sugarmagic/domain";

describe("item readable documents", () => {
  it("defaults readable items to no bound document", () => {
    const definition = createDefaultItemDefinition();

    expect(definition.interactionView.documentDefinitionId).toBeNull();
  });

  it("normalizes readable document bindings cleanly", () => {
    const normalized = normalizeItemDefinition({
      displayName: "Town Bulletin",
      interactionView: {
        ...createDefaultItemDefinition().interactionView,
        kind: "readable",
        documentDefinitionId: "doc-town-bulletin"
      }
    });

    expect(normalized.interactionView.kind).toBe("readable");
    expect(normalized.interactionView.documentDefinitionId).toBe("doc-town-bulletin");
  });
});
