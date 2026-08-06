/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/schema-parser.ts
 *
 * Purpose: Parses, validates, repairs, and enforces hard Teacher'soutput constraints.
 *
 * Exports:
 *   - DirectiveParseError
 *   - ParseResult
 *   - parseDirective
 *   - repairDirective
 *   - parseAndValidateDirective
 *
 * Relationships:
 *   - Depends on the PedagogicalDirective contract type.
 *   - Will be consumed by ClaudeTeacherPolicy and fallback handling in Epic 9.
 *
 * Implements: Proposal 001 §3. Teacher's *
 * Status: active
 */

import { clampRatioToPosture } from "./band-envelope";
import {
  isVocabularyRef,
  teachableRefKey,
  toVocabularyRefs,
  vocabularyRefs,
  type TeachableRef
} from "../contracts/teachable-ref";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import type {
  DirectiveLifetime,
  TeacherContext,
  GlossingStrategy,
  LemmaRef,
  PedagogicalDirective
} from "../types";
import {
  createNoOpTelemetrySink,
  createTelemetryEvent,
  emitTelemetry,
  type TelemetryEvent,
  type TelemetrySink
} from "../telemetry/telemetry";
import { EMPTY_NPC_CONTEXT } from "../situation";
import { computePacingSignals } from "../learner";
import { resolveQuestEssentialLemmaRefs } from "./quest-essential";

/**
 * 090.4: the probe-pacing signals, derived rather than carried. See
 * learner/pacing-signals.ts -- both are pure functions of the learner's cards
 * plus the conversation's turn count, so a stored copy could only drift.
 */
function pacingSignals(context: TeacherContext) {
  return computePacingSignals(
    context.learner,
    context.situation?.turnsSinceLastProbe ?? 0
  );
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false
});

const SUPPORT_POSTURES = [
  "anchored",
  "supported",
  "target-dominant",
  "target-only"
] as const;
const INTERACTION_STYLES = [
  "listening_first",
  "guided_dialogue",
  "natural_dialogue",
  "recast_mode",
  "elicitation_mode"
] as const;
const GLOSSING_STRATEGIES = [
  "inline",
  "parenthetical",
  "hover-only",
  "none"
] as const;
const SENTENCE_COMPLEXITY_CAPS = [
  "single-clause",
  "two-clause",
  "free"
] as const;
const CONFIDENCE_BANDS = ["high", "medium", "low"] as const;
const PROBE_STYLES = ["recall", "recognition", "production", "none"] as const;
const PROBE_REASONS = [
  "teacher-discretion",
  "soft-floor",
  "hard-floor-turns",
  "hard-floor-lemma-age",
  "teacher-deferred-override"
] as const;
const ACCEPTABLE_RESPONSE_FORMS = [
  "any",
  "single-word",
  "short-phrase",
  "full-sentence"
] as const;
const INVALIDATION_TRIGGERS = [
  "player_code_switch",
  "quest_stage_change",
  "location_change"
] as const;

const lemmaRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lemmaId", "lang"],
  properties: {
    lemmaId: { type: "string", minLength: 1 },
    lang: { type: "string", minLength: 1 },
    surfaceForm: { type: "string" }
  }
} as const;

/**
 * 090.4: what the Teacher may name on the slate -- a word OR a competency.
 *
 * This schema is what makes "introduce ask-where" expressible: `targetVocab`
 * takes a union, so a competency is named directly rather than disguised as a
 * word.
 *
 * `kind` is REQUIRED on both branches rather than defaulted to "vocabulary".
 * A default would mean a malformed competency silently parses as a word with a
 * missing lemmaId, and the failure would surface much later as an atlas miss.
 */
const teachableRefSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "lemmaId", "lang"],
      properties: {
        kind: { const: "vocabulary" },
        lemmaId: { type: "string", minLength: 1 },
        lang: { type: "string", minLength: 1 },
        surfaceForm: { type: "string" }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "competencyId", "lang"],
      properties: {
        kind: { const: "competency" },
        competencyId: { type: "string", minLength: 1 },
        lang: { type: "string", minLength: 1 }
      }
    }
  ]
} as const;

const pedagogicalDirectiveSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "targetVocab",
    "supportPosture",
    "targetLanguageRatio",
    "interactionStyle",
    "glossingStrategy",
    "sentenceComplexityCap",
    "comprehensionCheck",
    "directiveLifetime",
    "citedSignals",
    "rationale",
    "confidenceBand",
    "isFallbackDirective"
  ],
  properties: {
    targetVocab: {
      type: "object",
      additionalProperties: false,
      required: ["introduce", "reinforce", "avoid"],
      properties: {
        introduce: { type: "array", items: teachableRefSchema },
        reinforce: { type: "array", items: teachableRefSchema },
        avoid: { type: "array", items: teachableRefSchema }
      }
    },
    supportPosture: { enum: [...SUPPORT_POSTURES] },
    targetLanguageRatio: { type: "number" },
    interactionStyle: { enum: [...INTERACTION_STYLES] },
    glossingStrategy: { enum: [...GLOSSING_STRATEGIES] },
    sentenceComplexityCap: { enum: [...SENTENCE_COMPLEXITY_CAPS] },
    comprehensionCheck: {
      type: "object",
      additionalProperties: false,
      required: ["trigger", "probeStyle", "targetLemmas"],
      properties: {
        trigger: { type: "boolean" },
        probeStyle: { enum: [...PROBE_STYLES] },
        targetLemmas: { type: "array", items: lemmaRefSchema },
        triggerReason: { enum: [...PROBE_REASONS] },
        characterVoiceReminder: { type: "string" },
        acceptableResponseForms: { enum: [...ACCEPTABLE_RESPONSE_FORMS] }
      }
    },
    directiveLifetime: {
      type: "object",
      additionalProperties: false,
      required: ["maxTurns", "invalidateOn"],
      properties: {
        maxTurns: { type: "integer" },
        invalidateOn: {
          type: "array",
          items: { enum: [...INVALIDATION_TRIGGERS] }
        }
      }
    },
    citedSignals: {
      type: "array",
      items: { type: "string" }
    },
    rationale: { type: "string" },
    confidenceBand: { enum: [...CONFIDENCE_BANDS] },
    isFallbackDirective: { type: "boolean" }
  }
} as const;

const validateDirective = ajv.compile(pedagogicalDirectiveSchema);

export interface DirectiveFieldError {
  path: string;
  message: string;
}

export interface DirectiveParseError {
  code:
    | "invalid_json"
    | "schema_validation_failed"
    | "hard_floor_violated";
  message: string;
  details: DirectiveFieldError[];
  partial: unknown | null;
}

export type ParseResult =
  | { directive: PedagogicalDirective }
  | { error: DirectiveParseError };

export interface ParseDirectiveOptions {
  context?: TeacherContext;
  telemetry?: TelemetrySink;
}

export interface RepairDirectiveOptions {
  telemetry?: TelemetrySink;
}

function toFieldErrors(errors: ErrorObject[] | null | undefined): DirectiveFieldError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "validation error"
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripMarkdownCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * Pulls the JSON object out of a model response: strips markdown fences, then
 * slices brace-to-brace so surrounding prose does not break the parse.
 *
 * Exported so measurement reads the response the same way parsing does -- a
 * second copy of this logic reported a healthy directive as truncated
 * (sugarmagic-latency-bkg).
 */
export function extractJsonObjectCandidate(text: string): string {
  const stripped = stripMarkdownCodeFences(text);
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return stripped;
  }
  return stripped.slice(firstBrace, lastBrace + 1).trim();
}

function normalizeProbeTriggerReason(
  value: unknown
): PedagogicalDirective["comprehensionCheck"]["triggerReason"] | undefined {
  if (!isOneOf(value, PROBE_REASONS)) {
    return undefined;
  }
  return value;
}

function normalizeAcceptableResponseForms(
  value: unknown
): PedagogicalDirective["comprehensionCheck"]["acceptableResponseForms"] | undefined {
  if (isOneOf(value, ACCEPTABLE_RESPONSE_FORMS)) {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.find((entry) => isOneOf(entry, ACCEPTABLE_RESPONSE_FORMS));
    return normalized as
      | PedagogicalDirective["comprehensionCheck"]["acceptableResponseForms"]
      | undefined;
  }
  return undefined;
}

function normalizeInvalidationTrigger(value: unknown): DirectiveLifetime["invalidateOn"][number] | null {
  if (isOneOf(value, INVALIDATION_TRIGGERS)) {
    return value;
  }

  if (value === "scene_change") {
    return "location_change";
  }

  return null;
}

/**
 * Accepts a Teacher that answered with bare strings -- `introduce: ["queso"]` --
 * and lifts them into the object shape the schema requires.
 *
 * `kind` IS PART OF THAT SHAPE. It was omitted until 2026-07-31, which made this
 * whole function self-defeating: the schema requires `["kind", "lemmaId",
 * "lang"]` (090.4 made a teachable a discriminated union, deliberately without a
 * default), so the leniency path produced precisely the object validation would
 * reject. A model answering in the simpler form did not get a helpful coercion,
 * it got a parse failure and a silent fall back to the deterministic policy.
 *
 * A bare string is always VOCABULARY. A competency cannot arrive this way --
 * there is no bare-string form of `{kind: "competency", competencyId}` -- so
 * defaulting here does not swallow one.
 */
function coerceLemmaArrayEntries(
  value: unknown,
  targetLanguage: string
): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return { kind: "vocabulary", lemmaId: entry.trim(), lang: targetLanguage };
    }
    return entry;
  });
}

function normalizeDirectiveShape(
  value: unknown,
  targetLanguage?: string
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = { ...value };

  if (targetLanguage && isRecord(normalized.targetVocab)) {
    const vocab: Record<string, unknown> = { ...normalized.targetVocab };
    for (const key of ["introduce", "reinforce", "avoid"] as const) {
      const coerced = coerceLemmaArrayEntries(vocab[key], targetLanguage);
      if (coerced) vocab[key] = coerced;
    }
    normalized.targetVocab = vocab;
  }

  if (isRecord(normalized.comprehensionCheck)) {
    const comprehensionCheck: Record<string, unknown> = {
      ...normalized.comprehensionCheck
    };
    const trigger =
      typeof comprehensionCheck.trigger === "boolean"
        ? comprehensionCheck.trigger
        : false;
    comprehensionCheck.trigger = trigger;

    if (!trigger) {
      comprehensionCheck.probeStyle = "none";
      if (!Array.isArray(comprehensionCheck.targetLemmas)) {
        comprehensionCheck.targetLemmas = [];
      }
    } else if (!isOneOf(comprehensionCheck.probeStyle, PROBE_STYLES)) {
      comprehensionCheck.probeStyle = "recognition";
    }

    const triggerReason = normalizeProbeTriggerReason(comprehensionCheck.triggerReason);
    if (trigger && triggerReason) {
      comprehensionCheck.triggerReason = triggerReason;
    } else {
      delete comprehensionCheck.triggerReason;
    }

    if (typeof comprehensionCheck.characterVoiceReminder !== "string") {
      delete comprehensionCheck.characterVoiceReminder;
    }

    const acceptableResponseForms = normalizeAcceptableResponseForms(
      comprehensionCheck.acceptableResponseForms
    );
    if (trigger && acceptableResponseForms) {
      comprehensionCheck.acceptableResponseForms = acceptableResponseForms;
    } else {
      delete comprehensionCheck.acceptableResponseForms;
    }

    normalized.comprehensionCheck = comprehensionCheck;
  }

  if (isRecord(normalized.directiveLifetime)) {
    const directiveLifetime: Record<string, unknown> = {
      ...normalized.directiveLifetime
    };
    if (Array.isArray(directiveLifetime.invalidateOn)) {
      directiveLifetime.invalidateOn = directiveLifetime.invalidateOn
        .map((entry) => normalizeInvalidationTrigger(entry))
        .filter((entry): entry is DirectiveLifetime["invalidateOn"][number] => entry !== null);
    }
    normalized.directiveLifetime = directiveLifetime;
  }

  return normalized;
}

/**
 * 090.4: sanitizes EITHER kind of teachable.
 *
 * A test caught this on its first run: repair silently dropped every competency,
 * because this function only understood the word shape and anything it did not
 * recognize returned null. That is the same disappearance the whole story is
 * about, reintroduced one layer down -- the slate could carry a competency, the
 * schema accepted it, and then repair quietly removed it again.
 */
function sanitizeTeachableRef(value: unknown): TeachableRef | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "competency") {
    const competencyId =
      typeof value.competencyId === "string" ? value.competencyId.trim() : "";
    const lang = typeof value.lang === "string" ? value.lang.trim() : "";
    if (!competencyId || !lang) {
      return null;
    }
    return { kind: "competency", competencyId, lang };
  }
  const lemma = sanitizeLemmaRef(value);
  return lemma ? { ...lemma, kind: "vocabulary" } : null;
}

function sanitizeLemmaRef(value: unknown): LemmaRef | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.lemmaId !== "string" || typeof value.lang !== "string") {
    return null;
  }
  const lemmaId = value.lemmaId.trim();
  const lang = value.lang.trim();
  if (!lemmaId || !lang) {
    return null;
  }

  const lemmaRef: LemmaRef = {
    lemmaId,
    lang
  };
  if (typeof value.surfaceForm === "string" && value.surfaceForm.trim()) {
    lemmaRef.surfaceForm = value.surfaceForm.trim();
  }
  return lemmaRef;
}

function getPrescriptionSet(lemmas: LemmaRef[]): Set<string> {
  return new Set(lemmas.map((lemma) => `${lemma.lang}:${lemma.lemmaId}`));
}

function buildQuestEssentialSet(context: TeacherContext): Set<string> {
  return new Set(
    resolveQuestEssentialLemmaRefs(context.situation, context.atlas, context.lang).map(
      (lemma) => `${lemma.lang}:${lemma.lemmaId}`
    )
  );
}

function hasQuestEssential(context: TeacherContext): boolean {
  return (
    resolveQuestEssentialLemmaRefs(context.situation, context.atlas, context.lang).length > 0
  );
}

/**
 * Sanitizes a lemma array, dropping quest-essential lemmas and duplicates.
 *
 * `allowed` is a membership gate that is now almost always `null` -- 090.4
 * removed prescription membership as a constraint on what the Teacher may name.
 * It is kept as a parameter rather than deleted because the contamination
 * telemetry below still needs to ask "which of these WOULD a given set have
 * excluded", and because a future caller may legitimately gate on something
 * else. `null` means "no membership constraint", which is deliberately NOT the
 * same as an empty set -- an empty set would exclude everything, and that
 * distinction is exactly the kind that has bitten this codebase repeatedly.
 */
function filterLemmaArray(
  value: unknown,
  allowed: Set<string> | null,
  questEssential: Set<string>
): TeachableRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: TeachableRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const lemma = sanitizeTeachableRef(entry);
    if (!lemma) {
      continue;
    }
    const key = teachableRefKey(lemma);
    if (allowed !== null && !allowed.has(key)) {
      continue;
    }
    if (questEssential.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(lemma);
  }
  return result;
}

function filterPendingTargets(value: unknown, context: TeacherContext): LemmaRef[] {
  const allowed = new Set(
    pacingSignals(context).pendingProvisionalLemmas.map(
      (pending) => `${pending.lemmaRef.lang}:${pending.lemmaRef.lemmaId}`
    )
  );
  // Probe targets are word-only -- you probe a word, not an act.
  return vocabularyRefs(filterLemmaArray(value, allowed, new Set<string>()));
}

function takeOldestPendingTargets(context: TeacherContext): LemmaRef[] {
  return [...pacingSignals(context).pendingProvisionalLemmas]
    .sort((left, right) => {
      if (left.turnsPending !== right.turnsPending) {
        return right.turnsPending - left.turnsPending;
      }
      return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
    })
    .slice(0, 3)
    .map((pending) => pending.lemmaRef);
}

function clampRatio(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

function getDefaultSupportPosture(context: TeacherContext): PedagogicalDirective["supportPosture"] {
  const confidence = context.learner.assessment.cefrConfidence;
  if (confidence < 0.3) {
    return "anchored";
  }
  if (confidence < 0.7) {
    return "supported";
  }
  return "target-dominant";
}

function getDefaultTargetLanguageRatio(
  supportPosture: PedagogicalDirective["supportPosture"]
): number {
  switch (supportPosture) {
    case "anchored":
      return 0.3;
    case "supported":
      return 0.65;
    case "target-dominant":
      return 0.85;
    case "target-only":
      return 1;
  }
}

function getDefaultInteractionStyle(
  context: TeacherContext
): PedagogicalDirective["interactionStyle"] {
  if (context.learner.assessment.status !== "evaluated") {
    return "listening_first";
  }
  if (context.learner.assessment.cefrConfidence < 0.7 || context.calibrationActive) {
    return "guided_dialogue";
  }
  return "natural_dialogue";
}

function getDefaultGlossingStrategy(
  context: TeacherContext,
  introduce: LemmaRef[]
): GlossingStrategy {
  if (hasQuestEssential(context)) {
    return "parenthetical";
  }
  if (introduce.length > 0) {
    return "inline";
  }
  return "hover-only";
}

function getDefaultSentenceComplexityCap(
  context: TeacherContext
): PedagogicalDirective["sentenceComplexityCap"] {
  switch (context.learner.estimatedCefrBand) {
    case "A1":
      return "single-clause";
    case "A2":
    case "B1":
      return "two-clause";
    case "B2":
    case "C1":
    case "C2":
      return "free";
  }
}

/**
 * 090.3b raised `maxTurns` from 3 to 20, because it stopped being the policy.
 *
 * At 3 it WAS the invalidation policy -- the Teacher re-ran every 3-4 turns
 * regardless of whether anything had changed. The situation key governs that
 * now, so a short countdown would just reintroduce the churn the key removes.
 *
 * It survives as a BACKSTOP for one specific failure: if the key is subtly
 * wrong and never moves, the Teacher silently stops running and the player
 * receives one directive forever, with no test failing and nothing logged. 20
 * bounds that without re-creating turn-based re-slating. Once the key is proven
 * in play this can go to zero meaning "never", or go entirely.
 */
function getDefaultDirectiveLifetime(): DirectiveLifetime {
  return {
    maxTurns: 20,
    invalidateOn: ["quest_stage_change", "location_change"]
  };
}

function maybeEmit(event: TelemetryEvent, telemetry: TelemetrySink): void {
  void emitTelemetry(telemetry, event);
}

function enforceDirectiveRequirements(
  directive: PedagogicalDirective,
  context: TeacherContext,
  telemetry: TelemetrySink
): DirectiveParseError | null {
  // DELETED 2026-07-31: the quest-essential GLOSSING rule.
  //
  // It rejected a directive whose glossingStrategy was "none" or "hover-only"
  // whenever the scene had quest-essential lemmas. The Teacher prompt offers
  // exactly ONE value for that field -- "none" -- so this rejected the only
  // answer the Teacher was ever told it could give: a deterministic parse
  // failure for every scene with a mustComprehend concept, from the day both
  // landed (same commit, 2026-04-12).
  //
  // Because SugarLangTeacher answers a TeacherInvocationError with the
  // deterministic fallback, that meant four months of quest-essential scenes
  // running on the fallback instead of the LLM Teacher, with nothing surfaced
  // anywhere. The build-time teach plan has no fallback, which is the only
  // reason it was ever noticed.
  //
  // HOVER IS SUFFICIENT (nikki, 2026-07-31). The parenthetical-gloss era is
  // over. Hovering is also the SIGNAL -- it becomes a hovered-introduce
  // observation, so a player who did not know a word tells us so. An inline
  // gloss would destroy that evidence as well as the prose.
  //
  // Quest-essential lemmas still matter everywhere else: still resolved, still
  // kept off the avoid list, still tracked. Only the glossing rule is gone.

  const probeFloorState = pacingSignals(context).probeFloorState;
  if (probeFloorState.hardFloorReached && !directive.comprehensionCheck.trigger) {
    maybeEmit(
      createTelemetryEvent("comprehension.teacher-hard-floor-violated", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: Date.now(),
        sceneId: context.situation?.sceneId ?? "unknown-scene",
        hardFloorReason: probeFloorState.hardFloorReason ?? null
      }),
      telemetry
    );
    return {
      code: "hard_floor_violated",
      message:
        "The Teacher'signored a hard-floor comprehension-check requirement and was rejected.",
      details: [
        {
          path: "/comprehensionCheck/trigger",
          message: "hard floor requires trigger=true"
        }
      ],
      partial: directive
    };
  }

  return null;
}

export function parseDirective(
  json: string,
  options: ParseDirectiveOptions = {}
): ParseResult {
  const telemetry = options.telemetry ?? createNoOpTelemetrySink();
  let parsed: unknown;
  const jsonCandidate = extractJsonObjectCandidate(json);
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (error) {
    return {
      error: {
        code: "invalid_json",
        message: error instanceof Error ? error.message : "Invalid JSON",
        details: [
          {
            path: "/",
            message: "JSON.parse failed"
          }
        ],
        partial: null
      }
    };
  }

  parsed = normalizeDirectiveShape(
    parsed,
    options.context?.lang.targetLanguage
  );

  if (!validateDirective(parsed)) {
    return {
      error: {
        code: "schema_validation_failed",
        message: "Teacher'soutput failed schema validation.",
        details: toFieldErrors(validateDirective.errors),
        partial: parsed
      }
    };
  }

  const directive = parsed as PedagogicalDirective;

  // 090.4: the ratio is GOVERNED, not merely validated.
  //
  // The schema accepts any number in [0,1], so a model answering "anchored" with
  // 0.4 passed straight through -- observed in play, against a table that says
  // anchored means 0.3. The old `clampRatio` only ran on the REPAIR path, so a
  // well-formed directive was never checked against the posture it claimed.
  //
  // One arithmetic, in band-envelope: see `clampRatioToPosture`.
  directive.targetLanguageRatio = clampRatioToPosture(
    directive.targetLanguageRatio,
    directive.supportPosture
  );

  if (options.context) {
    const enforcementError = enforceDirectiveRequirements(
      directive,
      options.context,
      telemetry
    );
    if (enforcementError) {
      return { error: enforcementError };
    }
  }

  return { directive };
}

/**
 * 090.4b: `prescription` is no longer a parameter. Once the membership filter
 * and the snap-back were removed, nothing in here read it -- keeping it would
 * have advertised an influence that no longer exists.
 */
export function repairDirective(
  partial: unknown,
  context: TeacherContext,
  options: RepairDirectiveOptions = {}
): PedagogicalDirective {
  const telemetry = options.telemetry ?? createNoOpTelemetrySink();
  const record = isRecord(partial) ? partial : {};
  const targetVocab = isRecord(record.targetVocab) ? record.targetVocab : {};
  const questEssential = buildQuestEssentialSet(context);

  // 090.4: PRESCRIPTION MEMBERSHIP NO LONGER FILTERS THE REPAIR.
  //
  // This was the SECOND fence, and the dangerous one. The prompt's version was
  // visible -- an instruction the model could be seen obeying. This one was
  // code: it filtered targetVocab against the prescription and then, if the
  // filter emptied the list, DEFAULTED BACK to the prescription's own lemmas.
  // So removing the prompt line alone would have changed nothing here; a
  // directive needing repair would silently snap back to the old pool and look
  // like the Teacher had simply agreed with the budgeter.
  //
  // Sanitization stays. What goes is membership: the Teacher may now name a
  // lemma the prescription never contained, which is the entire point.
  const introduce = filterLemmaArray(targetVocab.introduce, null, questEssential);
  const reinforce = filterLemmaArray(targetVocab.reinforce, null, questEssential);
  const avoid = filterLemmaArray(targetVocab.avoid, null, questEssential);

  const contaminatedLemmaIds = [
    ...filterLemmaArray(targetVocab.introduce, null, new Set<string>()),
    ...filterLemmaArray(targetVocab.reinforce, null, new Set<string>()),
    ...filterLemmaArray(targetVocab.avoid, null, new Set<string>())
  ]
    .filter(isVocabularyRef)
    .filter((lemma) => questEssential.has(`${lemma.lang}:${lemma.lemmaId}`))
    .map((lemma) => lemma.lemmaId);
  if (contaminatedLemmaIds.length > 0) {
    maybeEmit(
      createTelemetryEvent("quest-essential.teacher-targetvocab-contamination", {
        conversationId: context.conversationId,
        sessionId: context.telemetryContext?.sessionId,
        turnId: context.telemetryContext?.turnId,
        timestamp: Date.now(),
        sceneId: context.situation?.sceneId ?? "unknown-scene",
        contaminatedLemmas: contaminatedLemmaIds
      }),
      telemetry
    );
  }

  // 090.4: THE SNAP-BACK IS GONE.
  //
  // These three lines used to read `introduce.length > 0 ? introduce :
  // [...prescription.introduce]` -- when repair emptied a list, it refilled from
  // the prescription. Combined with the membership filter above, that made the
  // prescription the true author of every repaired directive while looking like
  // the Teacher's own output.
  //
  // An empty list is now an empty list. It means the Teacher named nothing
  // usable for this turn, which is a legitimate answer and must be legible as
  // one; refilling it invents a decision nobody made. The prescription is still
  // gone entirely from this function.
  const repairedIntroduce = introduce;
  const repairedReinforce = reinforce;
  const repairedAvoid = avoid;

  const supportPosture = isOneOf(record.supportPosture, SUPPORT_POSTURES)
    ? record.supportPosture
    : getDefaultSupportPosture(context);
  // 090.4: same governor as the validated path -- one arithmetic, one table.
  const targetLanguageRatio = clampRatioToPosture(
    typeof record.targetLanguageRatio === "number"
      ? record.targetLanguageRatio
      : Number.NaN,
    supportPosture
  );
  const interactionStyle = isOneOf(record.interactionStyle, INTERACTION_STYLES)
    ? record.interactionStyle
    : getDefaultInteractionStyle(context);
  const glossingStrategy = isOneOf(record.glossingStrategy, GLOSSING_STRATEGIES)
    ? record.glossingStrategy
    : getDefaultGlossingStrategy(context, vocabularyRefs(repairedIntroduce));
  const sentenceComplexityCap = isOneOf(
    record.sentenceComplexityCap,
    SENTENCE_COMPLEXITY_CAPS
  )
    ? record.sentenceComplexityCap
    : getDefaultSentenceComplexityCap(context);

  const rawComprehension = isRecord(record.comprehensionCheck)
    ? record.comprehensionCheck
    : {};
  const probeFloorState = pacingSignals(context).probeFloorState;
  const shouldTriggerProbe =
    typeof rawComprehension.trigger === "boolean"
      ? rawComprehension.trigger || probeFloorState.hardFloorReached
      : probeFloorState.hardFloorReached;
  let targetLemmas = shouldTriggerProbe
    ? filterPendingTargets(rawComprehension.targetLemmas, context)
    : [];
  if (
    shouldTriggerProbe &&
    targetLemmas.length === 0 &&
    (probeFloorState.softFloorReached || probeFloorState.hardFloorReached)
  ) {
    targetLemmas = takeOldestPendingTargets(context);
  }

  const probeStyle = shouldTriggerProbe
    ? isOneOf(rawComprehension.probeStyle, PROBE_STYLES) &&
      rawComprehension.probeStyle !== "none"
      ? rawComprehension.probeStyle
      : "recognition"
    : "none";
  const triggerReason = shouldTriggerProbe
    ? isOneOf(rawComprehension.triggerReason, PROBE_REASONS)
      ? rawComprehension.triggerReason
      : probeFloorState.hardFloorReached
        ? probeFloorState.hardFloorReason === "lemma-age"
          ? "hard-floor-lemma-age"
          : "hard-floor-turns"
        : probeFloorState.softFloorReached
          ? "soft-floor"
          : "teacher-discretion"
    : undefined;

  const rawDirectiveLifetime = isRecord(record.directiveLifetime)
    ? record.directiveLifetime
    : {};
  const defaultLifetime = getDefaultDirectiveLifetime();
  const directiveLifetime: DirectiveLifetime = {
    maxTurns:
      typeof rawDirectiveLifetime.maxTurns === "number" &&
      Number.isFinite(rawDirectiveLifetime.maxTurns)
        ? Math.max(1, Math.floor(rawDirectiveLifetime.maxTurns))
        : defaultLifetime.maxTurns,
    invalidateOn: Array.isArray(rawDirectiveLifetime.invalidateOn)
      ? Array.from(
          new Set(
            rawDirectiveLifetime.invalidateOn.filter((value) =>
              isOneOf(value, INVALIDATION_TRIGGERS)
            )
          )
        )
      : defaultLifetime.invalidateOn
  };

  return {
    targetVocab: {
      // 090.4: repair still parses word-shaped refs from the model. Competency
      // parsing is the next piece; lifting here keeps the union honest rather
      // than leaving a LemmaRef masquerading as a TeachableRef.
      introduce: repairedIntroduce,
      reinforce: repairedReinforce,
      avoid: repairedAvoid
    },
    supportPosture,
    targetLanguageRatio,
    interactionStyle,
    glossingStrategy:
      hasQuestEssential(context) &&
      (glossingStrategy === "hover-only" || glossingStrategy === "none")
        ? "parenthetical"
        : glossingStrategy,
    sentenceComplexityCap,
    comprehensionCheck: shouldTriggerProbe
      ? {
          trigger: true,
          probeStyle,
          targetLemmas,
          triggerReason,
          characterVoiceReminder:
            typeof rawComprehension.characterVoiceReminder === "string" &&
            rawComprehension.characterVoiceReminder.trim()
              ? rawComprehension.characterVoiceReminder.trim()
              : (context.situation?.npc ?? EMPTY_NPC_CONTEXT).displayName != null
                ? `Stay in ${(context.situation?.npc ?? EMPTY_NPC_CONTEXT).displayName}'s character voice.`
                : "Stay in the NPC's character voice.",
          acceptableResponseForms: isOneOf(
            rawComprehension.acceptableResponseForms,
            ACCEPTABLE_RESPONSE_FORMS
          )
            ? rawComprehension.acceptableResponseForms
            : "short-phrase"
        }
      : {
          trigger: false,
          probeStyle: "none",
          targetLemmas: []
        },
    directiveLifetime,
    citedSignals:
      Array.isArray(record.citedSignals) && record.citedSignals.length > 0
        ? record.citedSignals.filter((value): value is string => typeof value === "string")
        : ["schema-repaired"],
    rationale:
      typeof record.rationale === "string" && record.rationale.trim()
        ? record.rationale.trim()
        : "Schema repair - defaulted invalid Teacher'sfields to prescription-safe values.",
    confidenceBand: isOneOf(record.confidenceBand, CONFIDENCE_BANDS)
      ? record.confidenceBand
      : "medium",
    isFallbackDirective:
      typeof record.isFallbackDirective === "boolean"
        ? record.isFallbackDirective
        : false
  };
}

export function parseAndValidateDirective(
  json: string
): PedagogicalDirective {
  const result = parseDirective(json);
  if ("directive" in result) {
    return result.directive;
  }
  throw new Error(result.error.message);
}
