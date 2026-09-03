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
  handleSugarAgentLoreStatus,
  handleTelemetryIngest,
  toStructuredOutputSchema
} from "./core";

describe("toStructuredOutputSchema", () => {
  it("drops the keywords the provider rejects, at every depth", () => {
    const sanitized = toStructuredOutputSchema({
      type: "object",
      required: ["concepts"],
      properties: {
        concepts: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1, maxLength: 40 },
              pos: { type: "string", enum: ["noun", "verb"] }
            }
          }
        }
      }
    });

    expect(sanitized).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["concepts"],
      properties: {
        concepts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              // enum survives -- it is supported, and it is what keeps a
              // hallucinated part of speech from reaching resolution.
              pos: { type: "string", enum: ["noun", "verb"] }
            }
          }
        }
      }
    });
  });

  it("keeps a field whose NAME collides with a dropped keyword", () => {
    // `properties` holds field names, not keywords. Filtering them as keywords
    // would silently delete the field.
    const sanitized = toStructuredOutputSchema({
      type: "object",
      properties: { pattern: { type: "string" }, maxLength: { type: "number" } }
    }) as { properties: Record<string, unknown> };

    expect(Object.keys(sanitized.properties).sort()).toEqual(["maxLength", "pattern"]);
  });

  it("forces additionalProperties false, whatever the caller said", () => {
    const sanitized = toStructuredOutputSchema({
      type: "object",
      additionalProperties: true,
      properties: {}
    }) as { additionalProperties: unknown };

    expect(sanitized.additionalProperties).toBe(false);
  });

  it("returns null for anything that is not a schema object", () => {
    expect(toStructuredOutputSchema(undefined)).toBeNull();
    expect(toStructuredOutputSchema("{}")).toBeNull();
    expect(toStructuredOutputSchema([{ type: "object" }])).toBeNull();
  });
});

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
      system: unknown;
    };
    expect(requestBody.max_tokens).toBe(50);
    // Legacy string path (sugarlang): `system` stays a plain string.
    expect(requestBody.system).toBe("you are helpful");
  });

  it("constrains generation to a caller's schema, and turns thinking off", async () => {
    // The whole point: a schema-constrained reply cannot be JSON that fails to
    // parse. Thinking goes off because max_tokens caps thinking and reply
    // together, and a truncated object is exactly the failure being removed.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: "text", text: '{"prose":"x"}' }] }),
      headers: { get: (_k: string) => "req-id-123" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPrompt: "extract",
        userPrompt: "some scene text",
        outputSchema: {
          type: "object",
          required: ["prose"],
          properties: { prose: { type: "string", minLength: 1 } }
        }
      })
    });
    await handleSugarAgentGenerate(req, makeRes());

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(callArgs[1].body as string) as {
      output_config?: { format?: { type?: string; schema?: Record<string, unknown> } };
      thinking?: { type?: string };
    };
    expect(requestBody.output_config?.format?.type).toBe("json_schema");
    expect(requestBody.thinking?.type).toBe("disabled");
    // Sanitized on the way through: the constraint Anthropic rejects is gone,
    // and the object it requires is present.
    const schema = requestBody.output_config?.format?.schema as {
      additionalProperties?: unknown;
      properties?: { prose?: Record<string, unknown> };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.prose).toEqual({ type: "string" });
  });

  it("sends no output_config when the caller asked for no schema", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
      headers: { get: (_k: string) => null }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemPrompt: "s", userPrompt: "u" })
    });
    await handleSugarAgentGenerate(req, makeRes());

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
    expect(requestBody["output_config"]).toBeUndefined();
    expect(requestBody["thinking"]).toBeUndefined();
  });

  it("logs model usage without making the turn wait for it", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: "text", text: "Hola" }],
          model: "served-model-z",
          usage: {
            input_tokens: 120,
            output_tokens: 34,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 0
          }
        }),
      headers: { get: (_k: string) => "req-id-usage" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const lines: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      });

    try {
      const req = makeReq({
        method: "POST",
        url: "/api/sugaragent/generate",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "you are helpful",
          userPrompt: "say hello",
          purpose: "teacher"
        })
      });
      // The auth gate assigns this before any route dispatches.
      (req as IncomingMessage & { user?: { userId: string; email: string } }).user = {
        userId: "user-abc",
        email: "player@example.test"
      };
      const res = makeRes();
      await handleSugarAgentGenerate(req, res);

      // THE CONSTRAINT: the player's reply is already sent and this call's
      // measurement has not been written. Measurement never sits in front of
      // a turn. (Earlier tests' deferred writes can land in this spy, so the
      // assertion is about THIS call, identified by its user.)
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).text).toBe("Hola");
      expect(lines.some((line) => line.includes("user-abc"))).toBe(false);

      // It lands on a later tick.
      await new Promise((resolve) => setImmediate(resolve));

      const usage = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find(
          (entry) =>
            entry["kind"] === "gateway.model-usage" && entry["userId"] === "user-abc"
        );
      expect(usage).toMatchObject({
        vendor: "anthropic",
        purpose: "teacher",
        model: "served-model-z",
        userId: "user-abc",
        ok: true,
        inputTokens: 120,
        outputTokens: 34,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0
      });
      // Raw counts only -- a computed cost cannot be recomputed when prices move.
      expect(usage).not.toHaveProperty("costUsd");
      // An email address has no business in a log line.
      expect(JSON.stringify(usage)).not.toContain("player@example.test");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("073.2 — resolves the model server-side by purpose (no model id from the client)", async () => {
    process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"] = "dialogue-model-x";
    process.env["SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL"] = "summary-model-y";
    try {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        headers: { get: () => "req" }
      });
      vi.stubGlobal("fetch", mockFetch);

      // No purpose => dialogue model.
      await handleSugarAgentGenerate(
        makeReq({
          method: "POST",
          url: "/api/sugaragent/generate",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ systemPrompt: "s", userPrompt: "u" })
        }),
        makeRes()
      );
      // purpose:"summary" => summary model.
      await handleSugarAgentGenerate(
        makeReq({
          method: "POST",
          url: "/api/sugaragent/generate",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "summary", systemPrompt: "s", userPrompt: "u" })
        }),
        makeRes()
      );

      const dialogueBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { model: string };
      const summaryBody = JSON.parse(
        (mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string
      ) as { model: string };
      expect(dialogueBody.model).toBe("dialogue-model-x");
      expect(summaryBody.model).toBe("summary-model-y");
    } finally {
      delete process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"];
      delete process.env["SUGARMAGIC_SUGARAGENT_SUMMARY_MODEL"];
    }
  });

  it("090 — purpose:\"teacher\" resolves from the SUGARLANG env var, not the sugaragent dialogue model", async () => {
    // Regression: the Teacher had no purpose, so it silently ran on the cheap
    // sugaragent dialogue model while a default-model constant sat inert in
    // sugarlang. Nothing caught it because nothing asserted the routing.
    process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"] = "dialogue-model-x";
    process.env["SUGARMAGIC_SUGARLANG_TEACHER_MODEL"] = "teacher-model-z";
    try {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        headers: { get: () => "req" }
      });
      vi.stubGlobal("fetch", mockFetch);

      await handleSugarAgentGenerate(
        makeReq({
          method: "POST",
          url: "/api/sugaragent/generate",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "teacher", systemPrompt: "s", userPrompt: "u" })
        }),
        makeRes()
      );

      const teacherBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { model: string };
      expect(teacherBody.model).toBe("teacher-model-z");
      expect(teacherBody.model).not.toBe("dialogue-model-x");
    } finally {
      delete process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"];
      delete process.env["SUGARMAGIC_SUGARLANG_TEACHER_MODEL"];
    }
  });

  it("090.1 — purpose:\"extraction\" resolves from the extraction env var, and ignores a client-sent model", async () => {
    // The compile-time passes (MWE, line intent, scene concepts) used to send a
    // client-side `model` while sending no purpose, so the gateway ignored the
    // model AND fell through to the dialogue default -- and their telemetry
    // reported the ignored constant as `extractorModel`. Both halves are
    // asserted here: routing comes from the env var, and a client model id
    // cannot override it.
    process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"] = "dialogue-model-x";
    process.env["SUGARMAGIC_SUGARLANG_EXTRACTION_MODEL"] = "extraction-model-q";
    try {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        headers: { get: () => "req" }
      });
      vi.stubGlobal("fetch", mockFetch);

      await handleSugarAgentGenerate(
        makeReq({
          method: "POST",
          url: "/api/sugaragent/generate",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            purpose: "extraction",
            model: "client-supplied-should-be-ignored",
            systemPrompt: "s",
            userPrompt: "u"
          })
        }),
        makeRes()
      );

      const sent = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { model: string };
      expect(sent.model).toBe("extraction-model-q");
      expect(sent.model).not.toBe("dialogue-model-x");
      expect(sent.model).not.toBe("client-supplied-should-be-ignored");
    } finally {
      delete process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"];
      delete process.env["SUGARMAGIC_SUGARLANG_EXTRACTION_MODEL"];
    }
  });

  it("090 — an unset teacher env var falls back to a reasoning model, never the dialogue model", async () => {
    process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"] = "dialogue-model-x";
    delete process.env["SUGARMAGIC_SUGARLANG_TEACHER_MODEL"];
    try {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        headers: { get: () => "req" }
      });
      vi.stubGlobal("fetch", mockFetch);

      await handleSugarAgentGenerate(
        makeReq({
          method: "POST",
          url: "/api/sugaragent/generate",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "teacher", systemPrompt: "s", userPrompt: "u" })
        }),
        makeRes()
      );

      const body = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { model: string };
      expect(body.model).toBe("claude-sonnet-4-6");
    } finally {
      delete process.env["SUGARMAGIC_SUGARAGENT_ANTHROPIC_MODEL"];
    }
  });

  it("072.5 — maps systemBlocks to Anthropic system content blocks with cache_control", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: "text", text: "Hi." }] }),
      headers: { get: () => "req-1" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemBlocks: [{ text: "You are Finnick.", cache: true }],
        userPrompt: "hi"
      })
    });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);

    expect(res.statusCode).toBe(200);
    const requestBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    ) as { system: Array<{ type: string; text: string; cache_control?: unknown }> };
    expect(Array.isArray(requestBody.system)).toBe(true);
    expect(requestBody.system[0]).toEqual({
      type: "text",
      text: "You are Finnick.",
      cache_control: { type: "ephemeral" }
    });
  });

  it("072.5 — a systemBlocks block without cache gets no cache_control", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: "text", text: "Hi." }] }),
      headers: { get: () => "req-1" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemBlocks: [{ text: "Uncached." }],
        userPrompt: "hi"
      })
    });
    await handleSugarAgentGenerate(req, makeRes());

    const requestBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string
    ) as { system: Array<Record<string, unknown>> };
    expect(requestBody.system[0]).not.toHaveProperty("cache_control");
  });

  it("072.7 — reports Anthropic's served model, falling back to the requested id", async () => {
    // Response includes its own model -> that wins.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [{ type: "text", text: "Hi." }],
            model: "claude-haiku-4-5-20251001"
          }),
        headers: { get: () => "r" }
      })
    );
    const res1 = makeRes();
    await handleSugarAgentGenerate(
      makeReq({
        method: "POST",
        url: "/api/sugaragent/generate",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemPrompt: "s", userPrompt: "u", model: "claude-haiku-4-5" })
      }),
      res1
    );
    expect((JSON.parse(res1.body) as { model: string }).model).toBe(
      "claude-haiku-4-5-20251001"
    );

    // Response omits model -> fall back to the env-var-resolved model (body model is ignored).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: "text", text: "Hi." }] }),
        headers: { get: () => "r" }
      })
    );
    const res2 = makeRes();
    await handleSugarAgentGenerate(
      makeReq({
        method: "POST",
        url: "/api/sugaragent/generate",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemPrompt: "s", userPrompt: "u" })
      }),
      res2
    );
    expect((JSON.parse(res2.body) as { model: string }).model).toBe("claude-haiku-4-5");
  });

  it("072.5 — accepts systemBlocks alone (no systemPrompt) and passes usage through", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: "text", text: "Hi." }],
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 0
          }
        }),
      headers: { get: () => "req-1" }
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = makeReq({
      method: "POST",
      url: "/api/sugaragent/generate",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemBlocks: [{ text: "You are Finnick.", cache: true }],
        userPrompt: "hi"
      })
    });
    const res = makeRes();
    await handleSugarAgentGenerate(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      text: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
      };
    };
    expect(body.text).toBe("Hi.");
    expect(body.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 0
    });
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

// ---------------------------------------------------------------------------
// handleTelemetryIngest
// ---------------------------------------------------------------------------

describe("handleTelemetryIngest", () => {
  it("returns 405 for non-POST", async () => {
    const req = makeReq({ method: "GET", url: "/api/telemetry" });
    const res = makeRes();
    await handleTelemetryIngest(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 on a body that is not JSON", async () => {
    const req = makeReq({
      method: "POST",
      url: "/api/telemetry",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    const res = makeRes();
    await handleTelemetryIngest(req, res);
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: string }).error).toBe("InvalidJson");
  });

  it("writes one JSON line per event, which is what Cloud Logging parses", async () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const req = makeReq({
        method: "POST",
        url: "/api/telemetry",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          events: [
            { kind: "sugaragent.turn-degraded", turnId: "turn-1" },
            { kind: "session.started", sessionId: "session-1" }
          ]
        })
      });
      const res = makeRes();
      await handleTelemetryIngest(req, res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, accepted: 2 });

      const lines = writeSpy.mock.calls.map((call) => String(call[0]));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.endsWith("\n")).toBe(true);
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(JSON.parse(lines[0]!)).toMatchObject({
        kind: "sugaragent.turn-degraded",
        turnId: "turn-1"
      });
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("takes any producer's kind, not only sugarlang's", async () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const req = makeReq({
        method: "POST",
        url: "/api/telemetry",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [{ kind: "anything.at-all", producerField: 42 }]
        })
      });
      const res = makeRes();
      await handleTelemetryIngest(req, res);

      expect(JSON.parse(String(writeSpy.mock.calls[0]?.[0]))).toMatchObject({
        kind: "anything.at-all",
        producerField: 42
      });
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("THE PII BACKSTOP: strips player text an old client still sent", async () => {
    // The client scrubs before POSTing. This runs again on arrival, because a
    // player mid-session is running whatever build they loaded.
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const req = makeReq({
        method: "POST",
        url: "/api/telemetry",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              kind: "classifier.verdict",
              inputText: "what the player typed",
              playerResponseText: "also the player",
              originalText: "before repair",
              repairedText: "after repair",
              regionId: "region-1",
              observations: [
                { observation: { inputText: "nested typing", lemmaId: "hola" } }
              ]
            }
          ]
        })
      });
      const res = makeRes();
      await handleTelemetryIngest(req, res);

      const logged = JSON.parse(String(writeSpy.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(logged).not.toHaveProperty("inputText");
      expect(logged).not.toHaveProperty("playerResponseText");
      expect(logged).not.toHaveProperty("originalText");
      expect(logged).not.toHaveProperty("repairedText");
      expect(logged.regionId).toBe("region-1");
      const observations = logged.observations as Array<{
        observation: Record<string, unknown>;
      }>;
      expect(observations[0]?.observation).not.toHaveProperty("inputText");
      expect(observations[0]?.observation.lemmaId).toBe("hola");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("caps a batch at 100 events so one request cannot flood the log", async () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const req = makeReq({
        method: "POST",
        url: "/api/telemetry",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: Array.from({ length: 150 }, (_unused, index) => ({
            kind: "session.started",
            index
          }))
        })
      });
      const res = makeRes();
      await handleTelemetryIngest(req, res);

      expect(JSON.parse(res.body)).toMatchObject({ ok: true, accepted: 100 });
      expect(writeSpy).toHaveBeenCalledTimes(100);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
