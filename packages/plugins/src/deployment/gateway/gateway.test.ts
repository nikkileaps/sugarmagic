// Story 071.9 — handler unit tests for the compiled gateway source.
// These import directly from core.ts so TypeScript type-checks the handlers
// under the same compiler settings as the production source.
import { type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initGateway,
  resolveAllowedOrigin,
  normalizePath,
  authorizeBearer,
  parseFrontmatter,
  splitLoreSections,
  handleSugarAgentGenerate,
  handleSugarAgentSearch,
  handleSugarAgentLoreStatus
} from "./core";

// ---------------------------------------------------------------------------
// Minimal test doubles
// ---------------------------------------------------------------------------

function makeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const readable = {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: opts.headers ?? {},
    [Symbol.asyncIterator]: async function* () {
      if (opts.body) yield Buffer.from(opts.body, "utf8");
    }
  } as unknown as IncomingMessage;
  return readable;
}

type MockRes = ServerResponse & {
  __sugarmagicCors?: Record<string, string>;
  statusCode?: number;
  headers: Record<string, string | string[]>;
  body: string;
};

function makeRes(): MockRes {
  let body = "";
  const res: MockRes = {
    __sugarmagicCors: {},
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      res.statusCode = code;
      res.headers = { ...(hdrs ?? {}) };
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
      res.body = body;
    }
  } as unknown as MockRes;
  return res;
}

const TEST_MANIFEST = {
  serviceUnitId: "sugarmagic-gateway",
  targetId: "google-cloud-run",
  authMode: "none",
  containerPort: 8080,
  label: "SugarMagic Gateway",
  owners: ["sugaragent"],
  routes: [
    {
      routeId: "sugaragent-generate",
      path: "/api/sugaragent/generate",
      protocol: "http-json",
      consumer: "browser-runtime"
    },
    {
      routeId: "sugaragent-retrieve",
      path: "/api/sugaragent/retrieve",
      protocol: "http-json",
      consumer: "browser-runtime"
    },
    {
      routeId: "sugaragent-lore",
      path: "/api/sugaragent/lore",
      protocol: "http-json",
      consumer: "browser-runtime"
    }
  ]
};

beforeEach(() => {
  process.env["SUGARMAGIC_ANTHROPIC_API_KEY"] = "test-anthropic-key";
  process.env["SUGARMAGIC_OPENAI_API_KEY"] = "test-openai-key";
  process.env["SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS"] = "https://game.example.com";
  initGateway(TEST_MANIFEST);
});

afterEach(() => {
  delete process.env["SUGARMAGIC_ANTHROPIC_API_KEY"];
  delete process.env["SUGARMAGIC_OPENAI_API_KEY"];
  delete process.env["SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS"];
  delete process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"];
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo vi.stubGlobal — without this, the first
  // fetch-stubbing test leaves fetch mocked for the rest of the file.
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe("resolveAllowedOrigin", () => {
  it("returns exact origin when it matches a pattern", () => {
    expect(resolveAllowedOrigin("https://game.example.com")).toBe(
      "https://game.example.com"
    );
  });

  it("returns origin for wildcard pattern match", () => {
    process.env["SUGARMAGIC_GATEWAY_ALLOWED_ORIGINS"] =
      "https://*--site.netlify.app";
    initGateway(TEST_MANIFEST);
    const origin = "https://deploy-abc123--site.netlify.app";
    expect(resolveAllowedOrigin(origin)).toBe(origin);
  });

  it("returns null for unrecognized origin", () => {
    expect(resolveAllowedOrigin("https://evil.com")).toBeNull();
  });

  it("returns null for empty/undefined origin", () => {
    expect(resolveAllowedOrigin(undefined)).toBeNull();
    expect(resolveAllowedOrigin("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth: bearer mode
// ---------------------------------------------------------------------------

describe("authorizeBearer", () => {
  it("returns false when env var is empty", () => {
    delete process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"];
    const req = makeReq({
      headers: { authorization: "Bearer some-token" }
    });
    expect(authorizeBearer(req)).toBe(false);
  });

  it("returns true for matching token", () => {
    process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"] = "secret-token-123";
    const req = makeReq({
      headers: { authorization: "Bearer secret-token-123" }
    });
    expect(authorizeBearer(req)).toBe(true);
  });

  it("returns false for wrong token", () => {
    process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"] = "secret-token-123";
    const req = makeReq({
      headers: { authorization: "Bearer wrong-token-xxx" }
    });
    expect(authorizeBearer(req)).toBe(false);
  });

  it("returns false for missing Authorization header", () => {
    process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"] = "secret-token-123";
    const req = makeReq({});
    expect(authorizeBearer(req)).toBe(false);
  });

  it("returns false for Basic auth instead of Bearer", () => {
    process.env["SUGARMAGIC_GATEWAY_SHARED_TOKEN"] = "secret-token-123";
    const req = makeReq({
      headers: { authorization: "Basic dXNlcjpwYXNz" }
    });
    expect(authorizeBearer(req)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

describe("normalizePath", () => {
  it("strips query string", () => {
    expect(normalizePath("/api/foo?bar=baz")).toBe("/api/foo");
  });

  it("returns / for empty url", () => {
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("preserves trailing slash", () => {
    expect(normalizePath("/api/foo/")).toBe("/api/foo/");
  });
});

// ---------------------------------------------------------------------------
// handleSugarAgentGenerate
// ---------------------------------------------------------------------------

describe("handleSugarAgentGenerate", () => {
  it("returns 405 for non-POST", async () => {
    const req = makeReq({ method: "GET", url: "/api/sugaragent/generate" });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 when systemPrompt is missing", async () => {
    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userPrompt: "hello" })
    });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe("InvalidRequest");
  });

  it("returns 400 when userPrompt is missing", async () => {
    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemPrompt: "you are helpful" })
    });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("proxies to Anthropic and returns text on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: "text", text: "Hello from Claude" }]
        }),
      headers: { get: (_k: string) => "req-id-123" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPrompt: "you are helpful",
        userPrompt: "say hello",
        maxTokens: 50
      })
    });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { text: string };
    expect(body.text).toBe("Hello from Claude");

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain("anthropic.com");
    const requestBody = JSON.parse(callArgs[1].body as string) as {
      max_tokens: number;
    };
    expect(requestBody.max_tokens).toBe(50);
  });

  it("wraps Anthropic non-2xx as 500 GatewayProxyFailure via caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => "overloaded",
      headers: { get: () => null }
    }));

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPrompt: "you are helpful",
        userPrompt: "say hello"
      })
    });
    const res = makeRes();
    await expect(handleSugarAgentGenerate(req, res)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleSugarAgentSearch
// ---------------------------------------------------------------------------

describe("handleSugarAgentSearch", () => {
  it("returns 405 for non-POST", async () => {
    const req = makeReq({ method: "GET", url: "/api/sugaragent/retrieve/search" });
    const res = makeRes();
    await handleSugarAgentSearch(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 when query is missing", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ vectorStoreId: "vs_abc" })
    });
    const res = makeRes();
    await handleSugarAgentSearch(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when vectorStoreId is missing", async () => {
    const req = makeReq({
      method: "POST",
      body: JSON.stringify({ query: "what is wordlark?" })
    });
    const res = makeRes();
    await handleSugarAgentSearch(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("proxies to OpenAI and returns results on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              file_id: "file-123",
              filename: "lore.md",
              score: 0.87,
              attributes: { page_id: "world.regions.wordlark" },
              content: [{ type: "text", text: "Wordlark is a cozy village." }]
            }
          ]
        }),
      headers: { get: () => "req-id-openai" }
    }));

    const req = makeReq({
      method: "POST",
      body: JSON.stringify({
        query: "what is wordlark?",
        vectorStoreId: "vs_abc123",
        maxResults: 2
      })
    });
    const res = makeRes();
    await handleSugarAgentSearch(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ score: number; text: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.score).toBe(0.87);
    expect(body.results[0]!.text).toBe("Wordlark is a cozy village.");
  });
});

// ---------------------------------------------------------------------------
// Lore helpers
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("parses valid YAML frontmatter", () => {
    const raw = "---\nid: world.regions.wordlark\ntitle: Wordlark\n---\nBody here.";
    const { metadata, body } = parseFrontmatter(raw);
    expect(metadata["id"]).toBe("world.regions.wordlark");
    expect(metadata["title"]).toBe("Wordlark");
    expect(body.trim()).toBe("Body here.");
  });

  it("returns empty metadata when no frontmatter", () => {
    const { metadata, body } = parseFrontmatter("Just body.");
    expect(metadata).toEqual({});
    expect(body).toBe("Just body.");
  });

  it("handles quoted frontmatter values", () => {
    const raw = "---\ntitle: 'My Page'\n---\nbody";
    const { metadata } = parseFrontmatter(raw);
    expect(metadata["title"]).toBe("My Page");
  });
});

describe("splitLoreSections", () => {
  it("splits on heading boundaries", () => {
    const md = "# Overview\nIntro.\n## Details\nMore info.";
    const sections = splitLoreSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.heading).toBe("Overview");
    expect(sections[0]!.slug).toBe("overview");
    expect(sections[1]!.heading).toBe("Details");
    expect(sections[1]!.content).toContain("More info.");
  });

  it("returns a single overview section when no headings", () => {
    const sections = splitLoreSections("Just some body text.");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.slug).toBe("overview");
  });

  it("slugifies headings correctly", () => {
    const sections = splitLoreSections("## The Great War!\nContent.");
    expect(sections[0]!.slug).toBe("the-great-war");
  });
});

// ---------------------------------------------------------------------------
// handleSugarAgentLoreStatus (smoke test — requires no lore configured)
// ---------------------------------------------------------------------------

describe("handleSugarAgentLoreStatus", () => {
  it("returns 405 for non-GET", async () => {
    const req = makeReq({ method: "POST", url: "/api/sugaragent/lore/status" });
    const res = makeRes();
    await handleSugarAgentLoreStatus(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 200 with sourceReady=false when LORE_SOURCE_PATH not set", async () => {
    const savedLorePath = process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
    delete process.env["SUGARMAGIC_LORE_SOURCE_PATH"];
    try {
      const req = makeReq({ method: "GET", url: "/api/sugaragent/lore/status" });
      const res = makeRes();
      await handleSugarAgentLoreStatus(req, res);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { ok: boolean; sourceReady: boolean };
      expect(body.ok).toBe(true);
      expect(body.sourceReady).toBe(false);
    } finally {
      if (savedLorePath !== undefined) {
        process.env["SUGARMAGIC_LORE_SOURCE_PATH"] = savedLorePath;
      }
    }
  });
});
