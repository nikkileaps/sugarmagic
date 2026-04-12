/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/lore-resolution.test.ts
 *
 * Purpose: Verifies gateway-backed lore wiki resolution for Sugarlang scene compilation.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/lore-resolution and ../../runtime/compile/scene-traversal.
 *   - Guards the fast-path that resolves canonical lorePageId values through the gateway.
 *
 * Implements: Gateway-backed lore resolution for Sugarlang compile
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  resolveSceneAuthoringContexts,
  type SugarlangLoreResolutionClient
} from "../../runtime/compile/lore-resolution";
import {
  createTestDocumentDefinitions,
  createTestRegion
} from "./test-helpers";

describe("resolveSceneAuthoringContexts", () => {
  it("prefers gateway-resolved wiki lore pages for canonical lorePageId references", async () => {
    const loreClient: SugarlangLoreResolutionClient = {
      async resolveLorePages(pageIds) {
        return pageIds.map((pageId) => ({
          pageId,
          title: `Resolved ${pageId}`,
          relativePath: `${pageId}.md`,
          body: `Body for ${pageId}.`,
          sections: [
            {
              heading: "Overview",
              slug: "overview",
              content: `Overview for ${pageId}.`
            }
          ]
        }));
      }
    };

    const region = {
      ...createTestRegion(),
      lorePageId: "lore.locations.towns.earendale"
    };
    const contexts = await resolveSceneAuthoringContexts(
      [
        {
          region,
          targetLanguage: "es",
          npcDefinitions: [
            {
              definitionId: "npc-orrin",
              displayName: "Orrin",
              description: "Station manager of Wordlark Hollow.",
              interactionMode: "agent",
              lorePageId: "lore.entities.npcs.orrin",
              presentation: {
                modelAssetDefinitionId: null,
                modelHeight: 1.7,
                animationAssetBindings: { idle: null, walk: null, run: null }
              }
            }
          ],
          dialogueDefinitions: [],
          questDefinitions: [],
          itemDefinitions: [
            {
              definitionId: "item-ticket",
              displayName: "Train Ticket",
              description: "A stamped station ticket.",
              category: "quest",
              inventory: {
                stackable: false,
                maxStack: 1,
                giftable: false
              },
              presentation: {
                modelAssetDefinitionId: null,
                modelHeight: 0.45
              },
              interactionView: {
                kind: "readable",
                title: "Ticket",
                body: "Wordlark Hollow - North Platform",
                consumeLabel: "Read",
                documentDefinitionId: "doc-ticket"
              }
            }
          ],
          documentDefinitions: createTestDocumentDefinitions()
        }
      ],
      loreClient
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.lorePages.map((page) => page.lorePageId)).toEqual(
      expect.arrayContaining([
        "doc-ticket",
        "lore.entities.npcs.orrin",
        "lore.locations.towns.earendale"
      ])
    );
    expect(
      contexts[0]?.lorePages.find(
        (page) => page.lorePageId === "lore.locations.towns.earendale"
      )
    ).toMatchObject({
      displayName: "Resolved lore.locations.towns.earendale",
      body: "Body for lore.locations.towns.earendale."
    });
  });
});
