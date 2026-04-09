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
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { CEFRBand } from "./learner-profile";
import type { LemmaRef, LexicalPrescription } from "./lexical-prescription";

export type SupportPosture =
  | "anchored"
  | "supported"
  | "target-dominant"
  | "target-only";

export type InteractionStyle =
  | "listening_first"
  | "guided_dialogue"
  | "natural_dialogue"
  | "recast_mode"
  | "elicitation_mode";

export type GlossingStrategy = "inline" | "parenthetical" | "hover-only" | "none";

export type SentenceComplexityCap = "single-clause" | "two-clause" | "free";

export type ProbeTriggerReason =
  | "director-discretion"
  | "soft-floor"
  | "hard-floor-turns"
  | "hard-floor-lemma-age"
  | "director-deferred-override";

export interface ComprehensionCheckSpec {
  trigger: boolean;
  probeStyle: "recall" | "recognition" | "production" | "none";
  targetLemmas: LemmaRef[];
  triggerReason?: ProbeTriggerReason;
  characterVoiceReminder?: string;
  acceptableResponseForms?: "any" | "single-word" | "short-phrase" | "full-sentence";
}

export interface DirectiveLifetime {
  maxTurns: number;
  invalidateOn: Array<
    | "player_code_switch"
    | "quest_stage_change"
    | "location_change"
    | "affective_shift"
  >;
}

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
