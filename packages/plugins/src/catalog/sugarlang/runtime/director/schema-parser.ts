/**
 * packages/plugins/src/catalog/sugarlang/runtime/director/schema-parser.ts
 *
 * Purpose: Parses, validates, repairs, and enforces hard Director output constraints.
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
 *   - Will be consumed by ClaudeDirectorPolicy and fallback handling in Epic 9.
 *
 * Implements: Proposal 001 §3. Director
 *
 * Status: active
 */

import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import type {
  DirectiveLifetime,
  DirectorContext,
  GlossingStrategy,
  LemmaRef,
  LexicalPrescription,
  PedagogicalDirective
} from "../types";
import type { TelemetrySink } from "../telemetry/telemetry";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false
});

const NO_OP_TELEMETRY: TelemetrySink = {
  emit() {
    return undefined;
  }
};

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
  "director-discretion",
  "soft-floor",
  "hard-floor-turns",
  "hard-floor-lemma-age",
  "director-deferred-override"
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
  "location_change",
  "affective_shift"
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
        introduce: { type: "array", items: lemmaRefSchema },
        reinforce: { type: "array", items: lemmaRefSchema },
        avoid: { type: "array", items: lemmaRefSchema }
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
    | "hard_floor_violated"
    | "quest_essential_glossing_required";
  message: string;
  details: DirectiveFieldError[];
  partial: unknown | null;
}

export type ParseResult =
  | { directive: PedagogicalDirective }
  | { error: DirectiveParseError };

export interface ParseDirectiveOptions {
  context?: DirectorContext;
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

function buildQuestEssentialSet(context: DirectorContext): Set<string> {
  return new Set(
    context.activeQuestEssentialLemmas.map(
      (lemma) => `${lemma.lemmaRef.lang}:${lemma.lemmaRef.lemmaId}`
    )
  );
}

function filterLemmaArray(
  value: unknown,
  allowed: Set<string>,
  questEssential: Set<string>
): LemmaRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: LemmaRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const lemma = sanitizeLemmaRef(entry);
    if (!lemma) {
      continue;
    }
    const key = `${lemma.lang}:${lemma.lemmaId}`;
    if (!allowed.has(key) || questEssential.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(lemma);
  }
  return result;
}

function filterPendingTargets(value: unknown, context: DirectorContext): LemmaRef[] {
  const allowed = new Set(
    context.pendingProvisionalLemmas.map(
      (pending) => `${pending.lemmaRef.lang}:${pending.lemmaRef.lemmaId}`
    )
  );
  return filterLemmaArray(value, allowed, new Set<string>());
}

function takeOldestPendingTargets(context: DirectorContext): LemmaRef[] {
  return [...context.pendingProvisionalLemmas]
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

function getDefaultSupportPosture(context: DirectorContext): PedagogicalDirective["supportPosture"] {
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
  context: DirectorContext
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
  context: DirectorContext,
  introduce: LemmaRef[]
): GlossingStrategy {
  if (context.activeQuestEssentialLemmas.length > 0) {
    return "parenthetical";
  }
  if (introduce.length > 0) {
    return "inline";
  }
  return "hover-only";
}

function getDefaultSentenceComplexityCap(
  context: DirectorContext
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

function getDefaultDirectiveLifetime(): DirectiveLifetime {
  return {
    maxTurns: 3,
    invalidateOn: ["quest_stage_change", "location_change"]
  };
}

function maybeEmit(
  telemetry: TelemetrySink,
  eventName: string,
  payload: Record<string, unknown>
): void {
  void telemetry.emit(eventName, payload);
}

function enforceDirectiveRequirements(
  directive: PedagogicalDirective,
  context: DirectorContext,
  telemetry: TelemetrySink
): DirectiveParseError | null {
  if (
    context.activeQuestEssentialLemmas.length > 0 &&
    (directive.glossingStrategy === "hover-only" ||
      directive.glossingStrategy === "none")
  ) {
    maybeEmit(telemetry, "quest-essential.director-forced-glossing", {
      conversationId: context.conversationId,
      originalGlossingStrategy: directive.glossingStrategy,
      correctedGlossingStrategy: "parenthetical",
      questEssentialLemmaCount: context.activeQuestEssentialLemmas.length,
      timestamp: Date.now()
    });
    return {
      code: "quest_essential_glossing_required",
      message:
        "Quest-essential lemmas require inline or parenthetical glossing from the Director.",
      details: [
        {
          path: "/glossingStrategy",
          message: "quest-essential context forbids hover-only/none glossing"
        }
      ],
      partial: directive
    };
  }

  if (context.probeFloorState.hardFloorReached && !directive.comprehensionCheck.trigger) {
    maybeEmit(telemetry, "comprehension.director-hard-floor-violated", {
      conversationId: context.conversationId,
      hardFloorReason: context.probeFloorState.hardFloorReason ?? null,
      timestamp: Date.now()
    });
    return {
      code: "hard_floor_violated",
      message:
        "The Director ignored a hard-floor comprehension-check requirement and was rejected.",
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
  const telemetry = options.telemetry ?? NO_OP_TELEMETRY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
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

  if (!validateDirective(parsed)) {
    return {
      error: {
        code: "schema_validation_failed",
        message: "Director output failed schema validation.",
        details: toFieldErrors(validateDirective.errors),
        partial: parsed
      }
    };
  }

  const directive = parsed as PedagogicalDirective;
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

export function repairDirective(
  partial: unknown,
  prescription: LexicalPrescription,
  context: DirectorContext,
  options: RepairDirectiveOptions = {}
): PedagogicalDirective {
  const telemetry = options.telemetry ?? NO_OP_TELEMETRY;
  const record = isRecord(partial) ? partial : {};
  const targetVocab = isRecord(record.targetVocab) ? record.targetVocab : {};
  const questEssential = buildQuestEssentialSet(context);
  const introduceAllowed = getPrescriptionSet(prescription.introduce);
  const reinforceAllowed = getPrescriptionSet(prescription.reinforce);
  const avoidAllowed = getPrescriptionSet(prescription.avoid);

  const introduce = filterLemmaArray(
    targetVocab.introduce,
    introduceAllowed,
    questEssential
  );
  const reinforce = filterLemmaArray(
    targetVocab.reinforce,
    reinforceAllowed,
    questEssential
  );
  const avoid = filterLemmaArray(targetVocab.avoid, avoidAllowed, questEssential);

  const contaminatedLemmaIds = [
    ...filterLemmaArray(targetVocab.introduce, introduceAllowed, new Set<string>()),
    ...filterLemmaArray(targetVocab.reinforce, reinforceAllowed, new Set<string>()),
    ...filterLemmaArray(targetVocab.avoid, avoidAllowed, new Set<string>())
  ]
    .filter((lemma) => questEssential.has(`${lemma.lang}:${lemma.lemmaId}`))
    .map((lemma) => lemma.lemmaId);
  if (contaminatedLemmaIds.length > 0) {
    maybeEmit(telemetry, "quest-essential.director-targetvocab-contamination", {
      conversationId: context.conversationId,
      lemmaIds: contaminatedLemmaIds,
      timestamp: Date.now()
    });
  }

  const repairedIntroduce = introduce.length > 0 ? introduce : [...prescription.introduce];
  const repairedReinforce =
    reinforce.length > 0 ? reinforce : [...prescription.reinforce];
  const repairedAvoid = avoid.length > 0 ? avoid : [...prescription.avoid];

  const supportPosture = isOneOf(record.supportPosture, SUPPORT_POSTURES)
    ? record.supportPosture
    : getDefaultSupportPosture(context);
  const targetLanguageRatio = clampRatio(
    record.targetLanguageRatio,
    getDefaultTargetLanguageRatio(supportPosture)
  );
  const interactionStyle = isOneOf(record.interactionStyle, INTERACTION_STYLES)
    ? record.interactionStyle
    : getDefaultInteractionStyle(context);
  const glossingStrategy = isOneOf(record.glossingStrategy, GLOSSING_STRATEGIES)
    ? record.glossingStrategy
    : getDefaultGlossingStrategy(context, repairedIntroduce);
  const sentenceComplexityCap = isOneOf(
    record.sentenceComplexityCap,
    SENTENCE_COMPLEXITY_CAPS
  )
    ? record.sentenceComplexityCap
    : getDefaultSentenceComplexityCap(context);

  const rawComprehension = isRecord(record.comprehensionCheck)
    ? record.comprehensionCheck
    : {};
  const shouldTriggerProbe =
    typeof rawComprehension.trigger === "boolean"
      ? rawComprehension.trigger || context.probeFloorState.hardFloorReached
      : context.probeFloorState.hardFloorReached;
  let targetLemmas = shouldTriggerProbe
    ? filterPendingTargets(rawComprehension.targetLemmas, context)
    : [];
  if (
    shouldTriggerProbe &&
    targetLemmas.length === 0 &&
    (context.probeFloorState.softFloorReached || context.probeFloorState.hardFloorReached)
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
      : context.probeFloorState.hardFloorReached
        ? context.probeFloorState.hardFloorReason === "lemma-age"
          ? "hard-floor-lemma-age"
          : "hard-floor-turns"
        : context.probeFloorState.softFloorReached
          ? "soft-floor"
          : "director-discretion"
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
      introduce: repairedIntroduce,
      reinforce: repairedReinforce,
      avoid: repairedAvoid
    },
    supportPosture,
    targetLanguageRatio,
    interactionStyle,
    glossingStrategy:
      context.activeQuestEssentialLemmas.length > 0 &&
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
              : context.npc.displayName != null
                ? `Stay in ${context.npc.displayName}'s character voice.`
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
        : "Schema repair - defaulted invalid Director fields to prescription-safe values.",
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
