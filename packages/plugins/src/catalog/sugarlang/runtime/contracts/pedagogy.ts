/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/pedagogy.ts
 *
 * Purpose: Declares the pedagogical directive and constraint types shared across sugarlang runtime systems.
 *
 * Exports:
 *   - SupportPosture
 *   - InteractionStyle
 *   - GlossingStrategy
 *   - SentenceComplexityCap
 *   - ProbeTriggerReason
 *   - ComprehensionCheckSpec
 *   - DirectiveLifetime
 *   - PedagogicalDirective
 *   - SugarlangConstraint
 *
 * Relationships:
 *   - Depends on lexical-prescription and learner-profile contract types.
 *   - Is consumed by the Director, middleware, and SugarAgent integration seams.
 *
 * Implements: Proposal 001 §3. Director / §Observer Latency Bias and In-Character Comprehension Checks
 *
 * Status: active
 */

import type { CEFRBand } from "./learner-profile";
import type { LemmaRef, LexicalPrescription } from "./lexical-prescription";

/**
 * High-level support posture the Director chooses for a turn.
 *
 * Implements: Proposal 001 §3. Director
 */
export type SupportPosture =
  | "anchored"
  | "supported"
  | "target-dominant"
  | "target-only";

/**
 * Conversational interaction style selected by the Director.
 *
 * Implements: Proposal 001 §3. Director / §Receptive vs. Productive Knowledge
 */
export type InteractionStyle =
  | "listening_first"
  | "guided_dialogue"
  | "natural_dialogue"
  | "recast_mode"
  | "elicitation_mode";

/**
 * Glossing mode authorized for the Generator.
 *
 * Implements: Proposal 001 §3. Director
 */
export type GlossingStrategy = "inline" | "parenthetical" | "hover-only" | "none";

/**
 * Sentence-complexity ceiling the Generator should honor for this turn.
 *
 * Implements: Proposal 001 §3. Director
 */
export type SentenceComplexityCap = "single-clause" | "two-clause" | "free";

/**
 * Reason why a comprehension probe was triggered or forced.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export type ProbeTriggerReason =
  | "director-discretion"
  | "soft-floor"
  | "hard-floor-turns"
  | "hard-floor-lemma-age"
  | "director-deferred-override";

/**
 * Full comprehension-check specification emitted by the Director.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export interface ComprehensionCheckSpec {
  trigger: boolean;
  probeStyle: "recall" | "recognition" | "production" | "none";
  targetLemmas: LemmaRef[];
  triggerReason?: ProbeTriggerReason;
  characterVoiceReminder?: string;
  acceptableResponseForms?: "any" | "single-word" | "short-phrase" | "full-sentence";
}

/**
 * Cache lifetime and invalidation triggers for a pedagogical directive.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface DirectiveLifetime {
  maxTurns: number;
  invalidateOn: Array<
    | "player_code_switch"
    | "quest_stage_change"
    | "location_change"
    | "affective_shift"
  >;
}

/**
 * Raw Director output prior to merging with the lexical prescription.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface PedagogicalDirective {
  targetVocab: {
    introduce: LemmaRef[];
    reinforce: LemmaRef[];
    avoid: LemmaRef[];
  };
  supportPosture: SupportPosture;
  targetLanguageRatio: number;
  interactionStyle: InteractionStyle;
  glossingStrategy: GlossingStrategy;
  sentenceComplexityCap: SentenceComplexityCap;
  comprehensionCheck: ComprehensionCheckSpec;
  directiveLifetime: DirectiveLifetime;
  citedSignals: string[];
  rationale: string;
  confidenceBand: "high" | "medium" | "low";
  isFallbackDirective: boolean;
}

/**
 * Final merged constraint written into `execution.annotations["sugarlang.constraint"]`.
 *
 * Implements: Proposal 001 §3. Director / §Pre-Placement Opening Dialog Policy / §Quest-Essential Lemma Exemption
 */
export interface SugarlangConstraint {
  targetVocab: {
    introduce: LemmaRef[];
    reinforce: LemmaRef[];
    avoid: LemmaRef[];
  };
  supportPosture: SupportPosture;
  targetLanguageRatio: number;
  interactionStyle: InteractionStyle;
  glossingStrategy: GlossingStrategy;
  sentenceComplexityCap: SentenceComplexityCap;
  targetLanguage: string;
  learnerCefr: CEFRBand;
  comprehensionCheckInFlight?: {
    active: true;
    probeStyle: "recall" | "recognition" | "production";
    targetLemmas: LemmaRef[];
    characterVoiceReminder: string;
    triggerReason: ProbeTriggerReason;
  };
  questEssentialLemmas?: Array<{
    lemmaRef: LemmaRef;
    sourceObjectiveDisplayName: string;
    supportLanguageGloss: string;
  }>;
  // Pre-placement opening-dialog bypass field. When present, the Generator
  // must skip normal prompt assembly and return the authored line verbatim.
  prePlacementOpeningLine?: {
    text: string;
    lang: string;
    lineId: string;
  };
  rawPrescription: LexicalPrescription;
}
