/**
 * packages/plugins/src/catalog/sugaragent/runtime/clients.test.ts
 *
 * Purpose: Unit-covers the persona load + drift-digest computation (Plan
 * 072.3/072.8) directly, rather than only transitively through the runtime
 * integration tests.
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildPersonaDigest,
  SugarAgentGatewayPersonaProvider,
  SugarAgentGatewayVectorStoreProvider,
  type GatewayVectorSearchRequest,
  type LoreResolveResult,
  type SugarAgentGatewayLoreClient,
  type SugarAgentGatewayVectorStoreClient
} from "./clients";
import type { LoreCardSection } from "./types";

function section(slug: string, content: string): LoreCardSection {
  return { heading: slug[0]!.toUpperCase() + slug.slice(1), slug, content };
}

describe("buildPersonaDigest (072.8)", () => {
  it("keeps the first 4 non-empty ## Persona lines and prefixes ## Voice", () => {
    const digest = buildPersonaDigest([
      section(
        "persona",
        "Line 1\nLine 2\n\nLine 3\nLine 4\nLine 5 (dropped)\nLine 6 (dropped)"
      ),
      section("voice", "Short sentences.")
    ]);
    expect(digest).toBe("Line 1\nLine 2\nLine 3\nLine 4\nVoice: Short sentences.");
  });

  it("returns just the voice line when persona is all blank", () => {
    const digest = buildPersonaDigest([
      section("persona", "   \n  \n"),
      section("voice", "Gruff.")
    ]);
    expect(digest).toBe("Voice: Gruff.");
  });

  it("returns an empty string when neither section is authored", () => {
    expect(buildPersonaDigest([section("work", "Bakes bread.")])).toBe("");
    expect(buildPersonaDigest([])).toBe("");
  });
});

describe("SugarAgentGatewayPersonaProvider.loadPersona (072.3)", () => {
  function makeProvider(resolve: (pageIds: string[]) => LoreResolveResult) {
    const client = {
      resolve: vi.fn(async (req: { pageIds: string[] }) => resolve(req.pageIds))
    } as unknown as SugarAgentGatewayLoreClient;
    return {
      provider: new SugarAgentGatewayPersonaProvider(client),
      client: client as unknown as { resolve: ReturnType<typeof vi.fn> }
    };
  }

  it("degrades without a fetch for a null/whitespace pageId (D3)", async () => {
    const { provider, client } = makeProvider(() => ({
      ok: true,
      pages: [],
      missingPageIds: []
    }));
    const result = await provider.loadPersona("   ");
    expect(result.loaded).toBe(false);
    expect(result.pageId).toBeNull();
    expect(result.fallbackReason).toBe("persona-unavailable");
    expect(result.digest).toBe("");
    expect(client.resolve).not.toHaveBeenCalled();
  });

  it("buckets persona/voice into the card and the rest into core knowledge", async () => {
    const { provider } = makeProvider((pageIds) => ({
      ok: true,
      pages: [
        {
          pageId: pageIds[0]!,
          title: "Maren",
          relativePath: "npc/maren.md",
          sectionCount: 3,
          body: "",
          sections: [
            { heading: "Persona", slug: "persona", content: "Warm." },
            { heading: "Voice", slug: "voice", content: "Clipped." },
            { heading: "Work", slug: "work", content: "Runs the bakery." }
          ]
        }
      ],
      missingPageIds: []
    }));
    const result = await provider.loadPersona("lore.maren");
    expect(result.loaded).toBe(true);
    expect(result.personaCard.map((s) => s.slug)).toEqual(["persona", "voice"]);
    expect(result.coreKnowledge.map((s) => s.slug)).toEqual(["work"]);
    expect(result.digest).toBe("Warm.\nVoice: Clipped.");
  });

  it("degrades when the requested page is in missingPageIds", async () => {
    const { provider } = makeProvider((pageIds) => ({
      ok: true,
      pages: [],
      missingPageIds: pageIds
    }));
    const result = await provider.loadPersona("lore.ghost");
    expect(result.loaded).toBe(false);
    expect(result.pageId).toBe("lore.ghost");
    expect(result.fallbackReason).toBe("persona-unavailable");
  });
});

describe("SugarAgentGatewayVectorStoreProvider.searchLore", () => {
  function fakeClient(): {
    client: SugarAgentGatewayVectorStoreClient;
    requests: GatewayVectorSearchRequest[];
  } {
    const requests: GatewayVectorSearchRequest[] = [];
    const search = vi.fn(async (request: GatewayVectorSearchRequest) => {
      requests.push(request);
      return { results: [], requestId: null };
    });
    return {
      client: { search } as unknown as SugarAgentGatewayVectorStoreClient,
      requests
    };
  }

  it("sends the project's relevance threshold with every search", async () => {
    const { client, requests } = fakeClient();
    const provider = new SugarAgentGatewayVectorStoreProvider(client, 0.78);

    await provider.searchLore({ vectorStoreId: "", query: "dock", maxResults: 4 });
    await provider.searchLore({ vectorStoreId: "", query: "suitcase", maxResults: 2 });

    expect(requests.map((request) => request.scoreThreshold)).toEqual([0.78, 0.78]);
  });

  it("sends a threshold of 0 rather than omitting it", async () => {
    // Omitting the field makes the gateway apply its own default, which would
    // silently override an author who deliberately turned the threshold off.
    const { client, requests } = fakeClient();
    const provider = new SugarAgentGatewayVectorStoreProvider(client, 0);

    await provider.searchLore({ vectorStoreId: "", query: "dock", maxResults: 4 });

    expect(requests[0]?.scoreThreshold).toBe(0);
  });
});
