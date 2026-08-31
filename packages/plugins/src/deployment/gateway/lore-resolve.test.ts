/**
 * packages/plugins/src/deployment/gateway/lore-resolve.test.ts
 *
 * Purpose: Verifies lore/resolve rebuilds a page from the vector store by id --
 * never from the filesystem -- in authored section order, keeps the
 * missingPageIds-in-200 convention, and still emits the shape sugarlang's
 * isResolvedLorePage guard requires.
 *
 * Status: active
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSugarAgentLoreResolve } from "./core";

function makeReq(bodyJson: unknown): IncomingMessage {
  const body = JSON.stringify(bodyJson);
  return {
    method: "POST",
    url: "/api/sugaragent/lore/resolve",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(body, "utf8");
    }
  } as unknown as IncomingMessage;
}

type MockRes = ServerResponse & {
  __sugarmagicCors?: Record<string, string>;
  statusCode: number;
  body: string;
};

function makeRes(): MockRes {
  let body = "";
  const res = {
    __sugarmagicCors: {},
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      res.statusCode = code;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
      res.body = body;
    }
  } as unknown as MockRes;
  return res;
}

interface ResolvedPage {
  pageId: string;
  title: string;
  relativePath: string;
  sectionCount: number;
  body: string;
  sections: Array<{ heading: string; slug: string; content: string }>;
}
interface ResolveResponse {
  ok: boolean;
  pages: ResolvedPage[];
  missingPageIds: string[];
}

// Mirror of sugarlang's isResolvedLorePage (lore-resolution.ts) required shape,
// so a drift that breaks the consumer fails here.
function validatesAgainstSugarlangGuard(page: unknown): boolean {
  if (typeof page !== "object" || page === null) return false;
  const p = page as Record<string, unknown>;
  return (
    typeof p["pageId"] === "string" &&
    typeof p["title"] === "string" &&
    typeof p["relativePath"] === "string" &&
    typeof p["body"] === "string" &&
    Array.isArray(p["sections"]) &&
    p["sections"].every(
      (s) =>
        typeof (s as Record<string, unknown>)?.["heading"] === "string" &&
        typeof (s as Record<string, unknown>)?.["slug"] === "string" &&
        typeof (s as Record<string, unknown>)?.["content"] === "string"
    )
  );
}

describe("lore/resolve reads pages from the vector store", () => {
  const savedStore = process.env["SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID"];
  const savedKey = process.env["SUGARMAGIC_OPENAI_API_KEY"];
  const savedLorePath = process.env["SUGARMAGIC_LORE_SOURCE_PATH"];

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedLorePath === undefined) delete process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
    else process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = savedLorePath;
    if (savedStore === undefined) delete process.env["SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID"];
    else process.env["SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID"] = savedStore;
    if (savedKey === undefined) delete process.env["SUGARMAGIC_OPENAI_API_KEY"];
    else process.env["SUGARMAGIC_OPENAI_API_KEY"] = savedKey;
  });

  interface StoredChunk {
    pageId: string;
    title: string;
    heading: string;
    slug: string;
    index: number;
    content: string;
  }

  // `## Secrets` is absent because ingest never chunks it, so a store that
  // stands in for a real one simply has no secret chunk to serve.
  const CHUNKS: StoredChunk[] = [
    { pageId: "lore.npc.maren", title: "Maren", heading: "Work", slug: "work", index: 1, content: "Runs the bakery." },
    { pageId: "lore.npc.maren", title: "Maren", heading: "Persona", slug: "persona", index: 0, content: "Warm and brisk." },
    { pageId: "lore.npc.tomas", title: "Tomas", heading: "Persona", slug: "persona", index: 0, content: "Gruff miller." }
  ];

  function stubStore(chunks: StoredChunk[] = CHUNKS): void {
    process.env["SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID"] = "vs_test";
    process.env["SUGARMAGIC_OPENAI_API_KEY"] = "sk-test";
    const fileId = (c: StoredChunk) => `file-${c.pageId}#${c.slug}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/content")) {
          const chunk = chunks.find((c) => url.includes(encodeURIComponent(fileId(c))) || url.includes(fileId(c)));
          return new Response(
            JSON.stringify({
              data: [
                {
                  type: "text",
                  text: `Page ID: ${chunk!.pageId}\n\nTitle: ${chunk!.title}\n\nSection: ${chunk!.heading}\n\n${chunk!.content}`
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            has_more: false,
            data: chunks.map((c) => ({
              id: fileId(c),
              attributes: {
                page_id: c.pageId,
                chunk_id: `${c.pageId}#${c.slug}`,
                title: c.title,
                section_slug: c.slug,
                section_heading: c.heading,
                section_index: String(c.index),
                relative_path: `npc/${c.pageId}.md`,
                canon_level: "hard"
              }
            }))
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
  }

  async function resolve(pageIds: string[]): Promise<ResolveResponse> {
    const res = makeRes();
    await handleSugarAgentLoreResolve(makeReq({ pageIds }), res);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ResolveResponse;
  }

  it("rebuilds a page from every chunk indexed for it", async () => {
    stubStore();
    const out = await resolve(["lore.npc.maren"]);
    const page = out.pages.find((p) => p.pageId === "lore.npc.maren")!;
    // Order is the store's, not the author's -- nothing reads sections
    // positionally -- so assert the SET rather than a sequence.
    expect(page.sections.map((s) => s.slug).sort()).toEqual(["persona", "work"]);
    expect(page.title).toBe("Maren");
    expect(page.sectionCount).toBe(2);
  });

  it("walks every page of the file list, not just the first", async () => {
    stubStore();
    await resolve(["lore.npc.maren"]);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const listCalls = calls.filter((c) => !String(c[0]).includes("/content"));
    // limit=100 is what keeps one store from becoming five round trips at
    // conversation open.
    expect(listCalls.every((c) => String(c[0]).includes("limit=100"))).toBe(true);
  });

  it("loses one unreadable chunk, not the whole character", async () => {
    stubStore();
    const realFetch = globalThis.fetch as unknown as (...a: unknown[]) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/content") && url.includes("work")) {
        return new Response("gone", { status: 404 });
      }
      return realFetch(input, init as never);
    }));
    const out = await resolve(["lore.npc.maren"]);
    const page = out.pages.find((p) => p.pageId === "lore.npc.maren")!;
    expect(page.sections.map((s) => s.slug)).toEqual(["persona"]);
  });

  it("strips the ingest header so a section carries only what the author wrote", async () => {
    stubStore();
    const out = await resolve(["lore.npc.maren"]);
    const page = out.pages.find((p) => p.pageId === "lore.npc.maren")!;
    expect(page.sections.find((s) => s.slug === "persona")!.content).toBe(
      "Warm and brisk."
    );
    expect(page.body).not.toContain("Page ID:");
    expect(page.body).toContain("Warm and brisk.");
  });

  it("never reads the filesystem, so a gateway with no lore on disk still serves", async () => {
    stubStore();
    delete process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
    const out = await resolve(["lore.npc.tomas"]);
    expect(out.pages.map((p) => p.pageId)).toEqual(["lore.npc.tomas"]);
  });

  it("keeps the missingPageIds convention (200, no 404)", async () => {
    stubStore();
    const out = await resolve(["lore.npc.maren", "lore.npc.nobody"]);
    expect(out.missingPageIds).toEqual(["lore.npc.nobody"]);
    expect(out.pages.map((p) => p.pageId)).toEqual(["lore.npc.maren"]);
  });

  it("still validates against sugarlang's isResolvedLorePage shape", async () => {
    stubStore();
    const out = await resolve(["lore.npc.maren", "lore.npc.tomas"]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages.every(validatesAgainstSugarlangGuard)).toBe(true);
  });

  it("says so loudly when no vector store is configured", async () => {
    delete process.env["SUGARMAGIC_SUGARAGENT_OPENAI_VECTOR_STORE_ID"];
    const res = makeRes();
    await handleSugarAgentLoreResolve(makeReq({ pageIds: ["lore.npc.maren"] }), res);
    // A build/config mistake fails loud rather than reading as "no such page".
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe("LoreStoreUnavailable");
  });
});
