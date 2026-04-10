/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/providers.ts
 *
 * Purpose: Declares the ADR 010 provider interfaces and Director context types used across sugarlang.
 *
 * Exports:
 *   - AtlasLemmaEntry
 *   - PendingProvisional
 *   - ProbeFloorState
 *   - ActiveQuestEssentialLemma
 *   - DirectorNpcContext
 *   - DirectorRecentTurn
 *   - DirectorLanguageContext
 *   - DirectorContext
 *   - LexicalAtlasProvider
 *   - LearnerPriorProvider
 *   - DirectorPolicy
 *
 * Relationships:
 *   - Depends on the core contract types for learner state, compiled scene lexicons, prescriptions, and directives.
 *   - Is consumed by provider implementations and the Director, compiler, and budgeter stubs.
 *   - Preserves ADR 010 one-way boundaries: atlas does not import priors or director logic; priors do not import director logic; director may depend on both but never writes back into them.
 *
 * Implements: Proposal 001 §Relationship to Existing Proposals and ADRs / ADR 010 provider boundaries
 *
 * Status: active
 */

import type { PedagogicalDirective } from "./pedagogy";
import type { CEFRBand, LearnerProfile, LemmaCard } from "./learner-profile";
import type { CefrPosterior } from "./learner-profile";
import type { LemmaRef, LexicalPrescription } from "./lexical-prescription";
import type { CompiledSceneLexicon } from "./scene-lexicon";

/**
 * Canonical atlas entry returned by the lexical-atlas provider.
 *
 * Implements: ADR 010 provider boundaries / Proposal 001 §Why This Proposal Exists
 */
export interface AtlasLemmaEntry {
  lemmaId: string;
  lang: string;
  cefrPriorBand: CEFRBand;
  frequencyRank: number | null;
  partsOfSpeech: string[];
  gloss?: string;
  examples?: string[];
  cefrPriorSource?: string;
}

/**
 * Runtime-computed view of a lemma with uncommitted provisional evidence.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export interface PendingProvisional {
  lemmaRef: LemmaRef;
  evidenceAmount: number;
  turnsPending: number;
}

/**
 * Soft/hard-floor state used to govern comprehension-probe frequency.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export interface ProbeFloorState {
  turnsSinceLastProbe: number;
  totalPendingLemmas: number;
  softFloorReached: boolean;
  hardFloorReached: boolean;
  hardFloorReason?: "turns-since-probe" | "lemma-age";
}

/**
 * Active quest-essential lemma filtered down to currently active objectives.
 *
 * Implements: Proposal 001 §Quest-Essential Lemma Exemption
 */
export interface ActiveQuestEssentialLemma {
  lemmaRef: LemmaRef;
  sourceObjectiveNodeId: string;
  sourceObjectiveDisplayName: string;
  sourceQuestId: string;
  cefrBand: CEFRBand;
  supportLanguageGloss: string;
}

/**
 * NPC slice passed into the Director prompt builder and policy.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface DirectorNpcContext {
  npcDefinitionId: string | null;
  displayName: string | null;
  lorePageId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Recent turn summary passed into the Director for conversational continuity.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface DirectorRecentTurn {
  turnId: string;
  speaker: "player" | "npc";
  text: string;
  lang?: string;
}

/**
 * Language configuration passed into the Director.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface DirectorLanguageContext {
  targetLanguage: string;
  supportLanguage: string;
}

/**
 * Full Director invocation context owned by middleware assembly.
 *
 * Implements: Proposal 001 §3. Director / §Observer Latency Bias / §Quest-Essential Lemma Exemption
 */
export interface DirectorContext {
  conversationId: string;
  learner: LearnerProfile;
  scene: CompiledSceneLexicon;
  prescription: LexicalPrescription;
  npc: DirectorNpcContext;
  recentTurns: DirectorRecentTurn[];
  lang: DirectorLanguageContext;
  calibrationActive: boolean;
  pendingProvisionalLemmas: PendingProvisional[];
  probeFloorState: ProbeFloorState;
  activeQuestEssentialLemmas: ActiveQuestEssentialLemma[];
  selectionMetadata?: Record<string, unknown>;
}

/**
 * ADR 010 seam for CEFRLex-style lexical atlas lookups.
 *
 * Implements: ADR 010 provider boundaries
 */
export interface LexicalAtlasProvider {
  getLemma: (lemmaId: string, lang: string) => AtlasLemmaEntry | undefined;
  getBand: (lemmaId: string, lang: string) => CEFRBand | undefined;
  getFrequencyRank: (lemmaId: string, lang: string) => number | undefined;
  listLemmasAtBand: (band: CEFRBand, lang: string) => LemmaRef[];
  getAtlasVersion: (lang: string) => string;
}

/**
 * ADR 010 seam for learner-dependent priors and initial seeding.
 *
 * Implements: ADR 010 provider boundaries
 */
export interface LearnerPriorProvider {
  getInitialLemmaCard: (
    lemmaId: string,
    lang: string,
    learnerBand: CEFRBand
  ) => LemmaCard;
  getCefrInitialPosterior: (selfReportedBand?: CEFRBand) => CefrPosterior;
}

/**
 * ADR 010 seam for the LLM-backed director policy.
 *
 * Implements: ADR 010 provider boundaries / Proposal 001 §3. Director
 */
export interface DirectorPolicy {
  invoke: (context: DirectorContext) => Promise<PedagogicalDirective>;
}
