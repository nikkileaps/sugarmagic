/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/providers.ts
 *
 * Purpose: Declares the ADR 010 provider interfaces and Director context types used across sugarlang.
 *
 * Exports:
 *   - LexicalAtlasEntry
 *   - PendingProvisionalLemma
 *   - ProbeFloorState
 *   - ActiveQuestEssentialLemma
 *   - DirectorContext
 *   - LexicalAtlasProvider
 *   - LearnerPriorProvider
 *   - DirectorPolicy
 *
 * Relationships:
 *   - Depends on the core contract types for learner state, compiled scene lexicons, prescriptions, and directives.
 *   - Is consumed by provider implementations and the Director, compiler, and budgeter stubs.
 *
 * Implements: Proposal 001 §Relationship to Existing Proposals and ADRs / ADR 010 provider boundaries
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

import type { PedagogicalDirective } from "./pedagogy";
import type { CEFRBand, LearnerProfile, LemmaCard } from "./learner-profile";
import type { LemmaRef, LexicalPrescription } from "./lexical-prescription";
import type { CompiledSceneLexicon } from "./scene-lexicon";

export interface LexicalAtlasEntry {
  lemmaRef: LemmaRef;
  cefrBand: CEFRBand;
  frequencyRank?: number | null;
}

export interface PendingProvisionalLemma {
  lemmaRef: LemmaRef;
  evidenceAmount: number;
  turnsPending: number;
}

export interface ProbeFloorState {
  turnsSinceLastProbe: number;
  totalPendingLemmaCount: number;
  requiresProbe: boolean;
}

export interface ActiveQuestEssentialLemma {
  lemmaRef: LemmaRef;
  sourceObjectiveNodeId: string;
  sourceObjectiveDisplayName: string;
  supportLanguageGloss: string;
}

export interface DirectorContext {
  learner: LearnerProfile;
  sceneLexicon: CompiledSceneLexicon;
  prescription: LexicalPrescription;
  pendingProvisionalLemmas: PendingProvisionalLemma[];
  probeFloorState?: ProbeFloorState;
  activeQuestEssentialLemmas?: ActiveQuestEssentialLemma[];
  selectionMetadata?: Record<string, unknown>;
}

export interface LexicalAtlasProvider {
  getLemmaEntry: (lemmaRef: LemmaRef) => LexicalAtlasEntry | null;
}

export interface LearnerPriorProvider {
  buildInitialCard: (lemmaRef: LemmaRef, learner: LearnerProfile) => LemmaCard;
}

export interface DirectorPolicy {
  buildDirective: (context: DirectorContext) => Promise<PedagogicalDirective>;
}
