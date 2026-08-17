/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/scene-context-extractor.ts
 *
 * WHAT THIS ANSWERS
 *   "What is this content ABOUT?" -- and nothing else. Given context sources it
 *   returns a `SceneContextModel`: a short prose description plus a list of
 *   CONCEPTS, each a short English label with provenance back to the source
 *   that suggested it.
 *
 * WHY IT EXISTS -- THE SIBLING SPLIT
 *   The same authored content is read twice, for different questions:
 *
 *     compileSugarlangScene    which WORDS are literally in this text
 *     this module              what the content is ABOUT
 *
 *   They are SIBLINGS. Neither derives from the other, neither is an input to
 *   the other, and both are compile artifacts of the same SceneAuthoringContext.
 *   The word-scanning path cannot see about-ness -- a bio reading
 *   "cheesemonger" contains no form of "cheese", so `queso` was never
 *   nominated, which is the motivating bug of Plan 090.
 *
 * IT MUST NOT KNOW THE CURRICULUM
 *   This module never sees the atlas or the competency inventory, and that is
 *   load-bearing rather than incidental:
 *     - If it knew the ten competencies it would only ever surface those ten,
 *       so we could never learn the curriculum is MISSING something.
 *     - Its output stays curriculum-independent, so adding a competency, or
 *       resolving the same scene for another target language, invalidates
 *       nothing. That is why the cache key is `supportLanguage` and not the
 *       target language.
 *   Resolution -- concept to teachable, against the atlas AND the inventory --
 *   is a separate, deterministic, LLM-free step (Plan 090.2). Do not grow this
 *   module in that direction.
 *
 *   Note the absent dependency is visible in the constructor: unlike
 *   `MultiWordExpressionExtractor`, there is no `atlas` in the deps. If you find
 *   yourself wanting to add one, the change belongs in resolution instead.
 *
 * CAPABILITY SPLIT
 *   `composeSceneContextProse` is a pure exported function needing no LLM: it
 *   assembles authored labels into prose. `SceneContextExtractor` requires an
 *   `llmClient` in its constructor and adds concept inference on top. A caller
 *   holding no client can therefore only do the cheap half, and the cost is
 *   visible at the call site rather than hidden inside the module.
 *
 * PATTERNS USED
 *   Mirrors MultiWordExpressionExtractor deliberately, so the two read alike:
 *   constructor DI, an exported pure prompt builder (assert prompt shape with no
 *   model), an Ajv boundary because model output is untrusted input, and
 *   fail-soft -- any failure returns an empty concept list plus a `failure`,
 *   never a throw, so a compile degrades rather than breaking authoring.
 *
 * SCOPE IS WHAT DECIDES AN ARTIFACT BOUNDARY
 *   A per-line pass briefly lived here and was moved back out, because the two
 *   depend on different things:
 *
 *     scene concepts   depend on ALL sources        -> one artifact per scene
 *     line intent      depends on ONE dialogue node -> one artifact per node
 *
 *   Editing one line must invalidate one intent, not a scene's worth of them.
 *   Consumers agree: the variant generator wants a node's text and intent, never
 *   the scene's concepts.
 *
 * Exports:
 *   - SceneContextExtractor (class)
 *   - SCENE_CONTEXT_PROMPT_VERSION / _TEMPLATE / _SCHEMA
 *   - buildSceneContextPrompt
 *   - composeSceneContextProse
 *   - SceneContextExtractionResult
 *
 * Implements: Plan 090 story 090.1
 *
 * Status: active
 */

import Ajv from "ajv";
import type { SugarlangLLMClient, SugarlangLLMResult } from "../llm/types";
import { EXTRACTION_PURPOSE } from "../llm/types";
import {
  CONCEPT_PARTS_OF_SPEECH,
  type Concept,
  type ConceptPartOfSpeech,
  type ContextSource,
  type SceneContextModel
} from "../contracts/scene-context";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";

const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: false });

/**
 * A leg of the scene-context cache key, so bumping it recompiles every scene.
 *
 *   090.1.0  first version.
 *   conjugation.concepts.0
 *            acts are named with their VERB rather than nominalized. The prompt
 *            always asked for acts and always got them -- as `greeting`,
 *            `arrival`, `introduction`. Those are nouns, and reverse-gloss
 *            resolution turns them into `saludo`, `llegada`, `introducción`, so
 *            a scene full of things happening could not put a single verb in
 *            front of a learner. `greet` resolves to `saludar`, `arrive` to
 *            `llegar`.
 *            EVERY CACHED SCENE CONTEXT IS INVALIDATED. Rebuild scenes.
 */
export const SCENE_CONTEXT_PROMPT_VERSION = "conjugation.concepts.0";

/**
 * The model's output contract.
 *
 * `pos` is OPTIONAL and enum-constrained. Optional because a concept label may
 * be a small phrase (`self introduction`) with no sensible part of speech;
 * enum-constrained because resolution tests POS membership against atlas
 * entries, so a value no atlas emits can never match and every concept carrying
 * it would drop SILENTLY -- reading as a coverage problem rather than a schema
 * mismatch. `CONCEPT_PARTS_OF_SPEECH` is pinned against every shipped atlas by
 * tests/contracts/scene-context.test.ts.
 */
export const SCENE_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prose", "concepts"],
  properties: {
    prose: { type: "string", minLength: 1 },
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "sourceIds"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 40 },
          pos: { type: "string", enum: [...CONCEPT_PARTS_OF_SPEECH] },
          sourceIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          mustComprehend: { type: "boolean" }
        }
      }
    }
  }
} as const;

const validateSceneContextPayload = ajv.compile(SCENE_CONTEXT_SCHEMA);


interface RawConcept {
  label: string;
  pos?: string;
  sourceIds: string[];
  mustComprehend?: boolean;
}

interface RawPayload {
  prose: string;
  concepts: RawConcept[];
}

export const SCENE_CONTEXT_PROMPT_TEMPLATE = [
  "You are annotating authored game content for a language-learning system.",
  "Return JSON only, matching the given schema.",
  "",
  "Your job is to say what this content is ABOUT. Two outputs:",
  "",
  "1. `prose`: two or three sentences describing the situation -- who and what",
  "   is here, what the place is, what is going on. Plain English.",
  "",
  "2. `concepts`: short English labels for the things this content is about or",
  "   does. Each carries the sourceIds it came from.",
  "",
  "RULES FOR CONCEPTS",
  "- Prefer a SINGLE word (`cheese`, `boat`, `greeting`). Use a short phrase",
  "  ONLY when no single word carries it (`self introduction`).",
  "- Include `pos` when the label is a single word; omit it for phrases.",
  "- Infer, do not copy. A bio reading \"cheesemonger\" yields the concept",
  "  `cheese` even though that word never appears. This is the point of the",
  "  pass: surface what the content is about, not which words are in it.",
  "- Include acts the content involves, not only objects. These matter as much",
  "  as nouns.",
  "- NAME AN ACT WITH ITS VERB, in the plain base form -- `arrive`, `greet`,",
  "  `buy`, `introduce`, `ask` -- and set pos to \"verb\". Do NOT nominalize:",
  "  `arrival`, `greeting`, `introduction` are nouns, and they resolve to the",
  "  noun in the target language (`llegada`, `saludo`), so the learner never",
  "  meets the verb. A scene where someone ARRIVES should teach `llegar`.",
  "- Do NOT translate anything. Every label is English.",
  "- Do NOT invent content that no source supports. Every concept must cite at",
  "  least one sourceId it actually came from.",
  "- Set `mustComprehend` true ONLY when a source marks the idea as required to",
  "  progress (a quest objective's own text). Absent means not required.",
  "- Aim for breadth over volume: a dozen good concepts beats forty weak ones.",
  "  Do not pad with generic ideas (`thing`, `person`, `place`) that would be",
  "  true of any scene."
];

/** Stable, readable dump of one source for the prompt. */
function renderSource(source: ContextSource): string {
  const lines = [`[${source.kind}] ${source.sourceId}`];
  if (source.displayName) lines.push(`name: ${source.displayName}`);
  for (const [key, value] of Object.entries(source.labels ?? {}).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    lines.push(`${key}: ${value}`);
  }
  if (source.prose) lines.push(source.prose.normalize("NFC"));
  return lines.join("\n");
}

/**
 * Assemble authored labels into prose WITHOUT a model.
 *
 * The no-LLM half of the capability split, and the fail-soft floor: when the
 * gateway is down a caller still gets a usable description built from authored
 * facts, just with no inferred concepts.
 */
export function composeSceneContextProse(sources: ContextSource[]): string {
  const named = sources
    .filter((source) => source.displayName)
    .map((source) => source.displayName as string);
  const unique = [...new Set(named)].sort(compareStrings);
  if (unique.length === 0) return "";
  return `Present here: ${unique.join(", ")}.`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildSceneContextPrompt(
  sources: ContextSource[],
  supportLanguage: string,
  promptVersion = SCENE_CONTEXT_PROMPT_VERSION
): { system: string; user: string } {
  const system = SCENE_CONTEXT_PROMPT_TEMPLATE.join("\n");
  const user = [
    `promptVersion: ${promptVersion}`,
    `outputLanguage: ${supportLanguage}`,
    "Output schema:",
    JSON.stringify(SCENE_CONTEXT_SCHEMA),
    "",
    "Sources:",
    [...sources]
      .sort((left, right) => compareStrings(left.sourceId, right.sourceId))
      .map(renderSource)
      .join("\n\n---\n\n")
  ].join("\n");

  return { system, user };
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export interface SceneContextExtractionResult {
  model: SceneContextModel;
  tokenCost: { input: number; output: number };
  latencyMs: number;
  failure?: { code: string; message: string };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

export interface SceneContextExtractorDeps {
  llmClient: SugarlangLLMClient;
  telemetry?: TelemetrySink;
  /** Injected clock; defaults to Date.now. Kept injectable for deterministic tests. */
  now?: () => number;
}

export interface SceneContextExtractRequest {
  sources: ContextSource[];
  /** Language the concepts are written in. NOT the target language. */
  supportLanguage: string;
  sceneId: string;
  contentHash: string;
  promptVersion?: string;
  maxTokens?: number;
}

/**
 * Infers what authored content is about. See the module header for the sibling
 * split and why this must not know the curriculum.
 *
 * Stateless per call -- caching and scheduling belong to the caller, exactly as
 * with the other compile pipelines.
 */
export class SceneContextExtractor {
  constructor(private readonly deps: SceneContextExtractorDeps) {}

  async extract(
    request: SceneContextExtractRequest
  ): Promise<SceneContextExtractionResult> {
    const telemetry = this.deps.telemetry ?? createNoOpTelemetrySink();
    const now = this.deps.now ?? (() => Date.now());
    const promptVersion = request.promptVersion ?? SCENE_CONTEXT_PROMPT_VERSION;
    const prompt = buildSceneContextPrompt(
      request.sources,
      request.supportLanguage,
      promptVersion
    );
    const startedAt = now();
    const inputTokens =
      estimateTokens(prompt.system) + estimateTokens(prompt.user);

    // Every early return degrades to this: authored prose, no concepts. A
    // compile with no situation is a worse compile, not a broken one.
    const degraded = (failure: {
      code: string;
      message: string;
    }): SceneContextExtractionResult => ({
      model: {
        sceneId: request.sceneId,
        contentHash: request.contentHash,
        promptVersion,
        supportLanguage: request.supportLanguage,
        prose: composeSceneContextProse(request.sources),
        concepts: [],
        extractedAtMs: now(),
        extractedByModel: "gateway-resolved",
        reviewFlag: true
      },
      tokenCost: { input: inputTokens, output: 0 },
      latencyMs: now() - startedAt,
      failure
    });

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("scene-context.extraction-started", {
        timestamp: startedAt,
        sceneId: request.sceneId,
        contentHash: request.contentHash,
        supportLanguage: request.supportLanguage,
        sourceCount: request.sources.length,
        extractorPurpose: EXTRACTION_PURPOSE,
        extractorPromptVersion: promptVersion
      })
    );

    let response: SugarlangLLMResult;
    try {
      response = await this.deps.llmClient.generate({
        purpose: EXTRACTION_PURPOSE,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        // ROOM TO FINISH. This was 1200, and a busy scene did not fit: the
        // reply stopped mid-array at exactly 1200 output tokens and the caller
        // reported it as invalid JSON, so `arrival-station` reached the Teacher
        // with no concepts through several edits. `max_tokens` is a ceiling,
        // not a reservation -- an unused one costs nothing, and a scene that
        // hits even this is caught loudly below rather than silently cut.
        maxTokens: request.maxTokens ?? 8000,
        // CONSTRAINED, not merely requested. The schema is in the prompt too --
        // it tells the model what the fields MEAN -- but the prompt is a
        // request and this is a limit on what can be written. Without it a
        // single missing comma lost a whole scene's concepts, and did.
        outputSchema: SCENE_CONTEXT_SCHEMA
      });
    } catch (error) {
      const failure = {
        code: "extractor_request_failed",
        message:
          error instanceof Error
            ? error.message
            : "Scene context extraction failed"
      };
      await emitTelemetry(
        telemetry,
        createTelemetryEvent("scene-context.extraction-failed", {
          timestamp: now(),
          sceneId: request.sceneId,
          contentHash: request.contentHash,
          supportLanguage: request.supportLanguage,
          error: failure
        })
      );
      return degraded(failure);
    }

    // TRUNCATION IS NOT BAD SYNTAX, and reporting it as such cost days. A reply
    // cut off at the ceiling fails to parse in the same way a malformed one
    // does, so say which happened while we still know.
    if (response.stopReason === "max_tokens") {
      return degraded({
        code: "extractor_response_truncated",
        message:
          `Scene context for "${request.sceneId}" did not fit in ` +
          `${request.maxTokens ?? 8000} output tokens. Raise maxTokens, or ` +
          `split the scene's authored content.`
      });
    }

    const candidate = extractJsonCandidate(response.text);
    if (!candidate) {
      return degraded({
        code: "extractor_unparseable_response",
        message: "Response contained no JSON object"
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      return degraded({
        code: "extractor_invalid_json",
        message: error instanceof Error ? error.message : "Invalid JSON"
      });
    }

    if (!validateSceneContextPayload(parsed)) {
      return degraded({
        code: "extractor_schema_violation",
        message: ajv.errorsText(validateSceneContextPayload.errors)
      });
    }

    const payload = parsed as RawPayload;
    const knownSourceIds = new Set(
      request.sources.map((source) => source.sourceId)
    );
    const kindBySourceId = new Map(
      request.sources.map((source) => [source.sourceId, source.kind])
    );

    // Provenance is validated, not trusted: a model citing a sourceId we never
    // sent is hallucinating, and a concept whose every citation is bogus has no
    // support at all. Drop it rather than carry an unattributable concept into a
    // teaching decision.
    let droppedForBadProvenance = 0;
    const byLabel = new Map<string, Concept>();

    for (const raw of payload.concepts) {
      const label = normalizeLabel(raw.label);
      if (!label) continue;

      const cited = [...new Set(raw.sourceIds)].filter((id) =>
        knownSourceIds.has(id)
      );
      if (cited.length === 0) {
        droppedForBadProvenance += 1;
        continue;
      }

      const provenance = cited.sort(compareStrings).map((sourceId) => ({
        sourceId,
        kind: kindBySourceId.get(sourceId) as ContextSource["kind"]
      }));

      const existing = byLabel.get(label);
      if (existing) {
        // Same label from two sources is one concept with two provenances.
        const merged = new Map(
          [...existing.provenance, ...provenance].map((entry) => [
            entry.sourceId,
            entry
          ])
        );
        existing.provenance = [...merged.values()].sort((left, right) =>
          compareStrings(left.sourceId, right.sourceId)
        );
        if (raw.mustComprehend) existing.mustComprehend = true;
        continue;
      }

      byLabel.set(label, {
        label,
        ...(raw.pos ? { pos: raw.pos as ConceptPartOfSpeech } : {}),
        provenance,
        ...(raw.mustComprehend ? { mustComprehend: true } : {})
      });
    }

    const concepts = [...byLabel.values()].sort((left, right) =>
      compareStrings(left.label, right.label)
    );

    const model: SceneContextModel = {
      sceneId: request.sceneId,
      contentHash: request.contentHash,
      promptVersion,
      supportLanguage: request.supportLanguage,
      prose: payload.prose.trim(),
      concepts,
      extractedAtMs: now(),
      extractedByModel: "gateway-resolved",
      reviewFlag: droppedForBadProvenance > 0
    };

    await emitTelemetry(
      telemetry,
      createTelemetryEvent("scene-context.extraction-completed", {
        timestamp: now(),
        sceneId: request.sceneId,
        contentHash: request.contentHash,
        supportLanguage: request.supportLanguage,
        conceptCount: concepts.length,
        droppedForBadProvenance,
        latencyMs: now() - startedAt,
        tokenCost: { input: inputTokens, output: estimateTokens(response.text) }
      })
    );

    return {
      model,
      tokenCost: { input: inputTokens, output: estimateTokens(response.text) },
      latencyMs: now() - startedAt
    };
  }
}
