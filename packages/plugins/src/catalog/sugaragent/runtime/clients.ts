import type { RetrievedEvidenceItem } from "./types";

export const OPENAI_VECTOR_STORE_PAGE_ID_ATTRIBUTE = "page_id";

export interface OpenAIVectorStoreEqFilter {
  type: "eq";
  key: string;
  value: string | number | boolean;
}

export type OpenAIVectorStoreFilter = OpenAIVectorStoreEqFilter;

export interface LLMGenerateRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface LLMProvider {
  generateStructuredTurn: (request: LLMGenerateRequest) => Promise<string>;
}

export interface EmbeddingsProvider {
  embedQuery: (input: string, model: string) => Promise<number[]>;
}

export interface VectorStoreSearchRequest {
  vectorStoreId: string;
  query: string;
  maxResults: number;
  filters?: OpenAIVectorStoreFilter | null;
}

export interface VectorStoreProvider {
  searchLore: (request: VectorStoreSearchRequest) => Promise<RetrievedEvidenceItem[]>;
}

export interface GatewayGenerateRequest {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface GatewayGenerateResult {
  text: string;
  requestId: string | null;
}

export interface GatewayEmbeddingRequest {
  input: string;
  model?: string;
}

export interface GatewayEmbeddingResult {
  embedding: number[];
  requestId: string | null;
}

export interface GatewayVectorSearchRequest {
  vectorStoreId?: string;
  query: string;
  maxResults: number;
  filters?: OpenAIVectorStoreFilter | null;
}

export interface GatewayVectorSearchResult {
  results: RetrievedEvidenceItem[];
  requestId: string | null;
}

interface VendorTextResult {
  text: string;
  requestId: string | null;
}

interface VendorEmbeddingResult {
  embedding: number[];
  requestId: string | null;
}

interface VendorVectorSearchResult {
  results: RetrievedEvidenceItem[];
  requestId: string | null;
}

export interface AnthropicMessageRequest {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
}

export interface OpenAIResponseRequest {
  model: string;
  instructions: string;
  input: string;
  maxOutputTokens: number;
}

export interface OpenAIEmbeddingRequest {
  input: string;
  model: string;
}

export interface OpenAIVectorStoreSearchRequest {
  vectorStoreId: string;
  query: string;
  maxResults: number;
  filters?: OpenAIVectorStoreFilter | null;
}

function normalizeModel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error("Model identifier is required");
  }
  return normalized;
}

function normalizePrompt(text: string, field: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeMaxTokens(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeMaxResults(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Gateway base URL is required");
  }
  return normalized;
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${label} failed with status ${response.status}${body.trim() ? `: ${body}` : ""}`
    );
  }
  return (await response.json()) as T;
}

export class AnthropicClient {
  constructor(private readonly apiKey: string) {}

  async generateMessage(request: AnthropicMessageRequest): Promise<VendorTextResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [
          {
            role: "user",
            content: request.userMessage
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = payload.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");

    if (!text) {
      throw new Error("Anthropic response did not include text content");
    }

    return {
      text,
      requestId: response.headers.get("request-id")
    };
  }
}

export class OpenAIClient {
  constructor(private readonly apiKey: string) {}

  async generateResponse(request: OpenAIResponseRequest): Promise<VendorTextResult> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        max_output_tokens: request.maxOutputTokens
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI response request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const text = payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" && typeof item.text === "string")
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");

    if (!text) {
      throw new Error("OpenAI response did not include output text");
    }

    return {
      text,
      requestId: response.headers.get("x-request-id")
    };
  }
}

export class OpenAIEmbeddingsClient {
  constructor(private readonly apiKey: string) {}

  async createEmbedding(request: OpenAIEmbeddingRequest): Promise<VendorEmbeddingResult> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        input: request.input,
        model: request.model
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("OpenAI embeddings response did not include an embedding");
    }

    return {
      embedding,
      requestId: response.headers.get("x-request-id")
    };
  }
}

export class OpenAIVectorStoreClient {
  constructor(private readonly apiKey: string) {}

  async search(request: OpenAIVectorStoreSearchRequest): Promise<VendorVectorSearchResult> {
    const response = await fetch(
      `https://api.openai.com/v1/vector_stores/${request.vectorStoreId}/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: request.query,
          max_num_results: request.maxResults,
          filters: request.filters ?? undefined
        })
      }
    );

    if (!response.ok) {
      throw new Error(`OpenAI vector search failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{
        file_id?: string;
        filename?: string;
        score?: number;
        attributes?: Record<string, unknown>;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    return {
      requestId: response.headers.get("x-request-id"),
      results: (payload.data ?? []).map((result, index) => ({
        fileId: result.file_id ?? `vector-result-${index}`,
        filename: result.filename ?? "unknown",
        score: typeof result.score === "number" ? result.score : 0,
        attributes: result.attributes ?? {},
        text:
          result.content
            ?.filter((item) => item.type === "text" && typeof item.text === "string")
            .map((item) => item.text?.trim() ?? "")
            .filter(Boolean)
            .join("\n\n") ?? ""
      }))
    };
  }
}

export class SugarAgentGatewayLLMClient {
  constructor(private readonly baseUrl: string) {}

  async generate(request: GatewayGenerateRequest): Promise<GatewayGenerateResult> {
    const response = await fetch(
      `${normalizeBaseUrl(this.baseUrl)}/api/sugaragent/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(request)
      }
    );

    return parseJsonResponse<GatewayGenerateResult>(
      response,
      "SugarAgent gateway generate request"
    );
  }
}

export class SugarAgentGatewayEmbeddingsClient {
  constructor(private readonly baseUrl: string) {}

  async createEmbedding(
    request: GatewayEmbeddingRequest
  ): Promise<GatewayEmbeddingResult> {
    const response = await fetch(
      `${normalizeBaseUrl(this.baseUrl)}/api/sugaragent/retrieve/embed`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(request)
      }
    );

    return parseJsonResponse<GatewayEmbeddingResult>(
      response,
      "SugarAgent gateway embedding request"
    );
  }
}

export class SugarAgentGatewayVectorStoreClient {
  constructor(private readonly baseUrl: string) {}

  async search(
    request: GatewayVectorSearchRequest
  ): Promise<GatewayVectorSearchResult> {
    const response = await fetch(
      `${normalizeBaseUrl(this.baseUrl)}/api/sugaragent/retrieve/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(request)
      }
    );

    return parseJsonResponse<GatewayVectorSearchResult>(
      response,
      "SugarAgent gateway vector search"
    );
  }
}

export class AnthropicLLMProvider implements LLMProvider {
  constructor(
    private readonly client: AnthropicClient,
    private readonly defaults: { maxTokens?: number } = {}
  ) {}

  async generateStructuredTurn(request: LLMGenerateRequest): Promise<string> {
    const response = await this.client.generateMessage({
      model: normalizeModel(request.model),
      system: normalizePrompt(request.systemPrompt, "systemPrompt"),
      userMessage: normalizePrompt(request.userPrompt, "userPrompt"),
      maxTokens: normalizeMaxTokens(request.maxTokens, this.defaults.maxTokens ?? 300)
    });
    return response.text;
  }
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(
    private readonly client: OpenAIClient,
    private readonly defaults: { maxTokens?: number } = {}
  ) {}

  async generateStructuredTurn(request: LLMGenerateRequest): Promise<string> {
    const response = await this.client.generateResponse({
      model: normalizeModel(request.model),
      instructions: normalizePrompt(request.systemPrompt, "systemPrompt"),
      input: normalizePrompt(request.userPrompt, "userPrompt"),
      maxOutputTokens: normalizeMaxTokens(
        request.maxTokens,
        this.defaults.maxTokens ?? 300
      )
    });
    return response.text;
  }
}

export class OpenAIEmbeddingsProvider implements EmbeddingsProvider {
  constructor(private readonly client: OpenAIEmbeddingsClient) {}

  async embedQuery(input: string, model: string): Promise<number[]> {
    const response = await this.client.createEmbedding({
      input: normalizePrompt(input, "embedding input"),
      model: normalizeModel(model)
    });
    return response.embedding;
  }
}

export class OpenAIVectorStoreProvider implements VectorStoreProvider {
  constructor(private readonly client: OpenAIVectorStoreClient) {}

  async searchLore(request: VectorStoreSearchRequest): Promise<RetrievedEvidenceItem[]> {
    const response = await this.client.search({
      vectorStoreId: normalizePrompt(request.vectorStoreId, "vectorStoreId"),
      query: normalizePrompt(request.query, "query"),
      maxResults: normalizeMaxResults(request.maxResults),
      filters: request.filters ?? undefined
    });
    return response.results;
  }
}

export class SugarAgentGatewayLLMProvider implements LLMProvider {
  constructor(
    private readonly client: SugarAgentGatewayLLMClient,
    private readonly defaults: { maxTokens?: number } = {}
  ) {}

  async generateStructuredTurn(request: LLMGenerateRequest): Promise<string> {
    const response = await this.client.generate({
      model: request.model.trim() || undefined,
      systemPrompt: normalizePrompt(request.systemPrompt, "systemPrompt"),
      userPrompt: normalizePrompt(request.userPrompt, "userPrompt"),
      maxTokens: normalizeMaxTokens(request.maxTokens, this.defaults.maxTokens ?? 300)
    });
    return response.text;
  }
}

export class SugarAgentGatewayEmbeddingsProvider implements EmbeddingsProvider {
  constructor(private readonly client: SugarAgentGatewayEmbeddingsClient) {}

  async embedQuery(input: string, model: string): Promise<number[]> {
    const response = await this.client.createEmbedding({
      input: normalizePrompt(input, "embedding input"),
      model: model.trim() || undefined
    });
    return response.embedding;
  }
}

export class SugarAgentGatewayVectorStoreProvider implements VectorStoreProvider {
  constructor(private readonly client: SugarAgentGatewayVectorStoreClient) {}

  async searchLore(request: VectorStoreSearchRequest): Promise<RetrievedEvidenceItem[]> {
    const response = await this.client.search({
      vectorStoreId: request.vectorStoreId.trim() || undefined,
      query: normalizePrompt(request.query, "query"),
      maxResults: normalizeMaxResults(request.maxResults),
      filters: request.filters ?? undefined
    });
    return response.results;
  }
}
