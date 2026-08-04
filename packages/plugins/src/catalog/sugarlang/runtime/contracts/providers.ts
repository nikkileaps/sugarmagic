/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/providers.ts
 *
 * Purpose: Declares the ADR 010 provider interfaces and teacher context types used across sugarlang.
 *
 * Exports:
 *   - AtlasLemmaEntry
 *   - ActiveQuestEssentialLemma
 *   - TeacherLanguageContext
 *   - TeacherContext
 *   - LexicalAtlasProvider
 *   - LearnerPriorProvider
 *   - TeacherPolicy
 *
 * Relationships:
 *   - Depends on the core contract types for learner state, compiled scene lexicons, prescriptions, and directives.
 *   - Is consumed by provider implementations and the teacher, compiler, and budgeter stubs.
 *   - Preserves ADR 010 one-way boundaries: atlas does not import priors or teacher logic; priors do not import teacher logic; teacher may depend on both but never writes back into them.
 *
 * Implements: Proposal 001 §Relationship to Existing Proposals and ADRs / ADR 010 provider boundaries
 *
 * Status: active
 */

import type { PedagogicalDirective } from "./pedagogy";
import type { CEFRBand } from "../cefr";
import type { LearnerProfile, LearnerProgress, LemmaCard } from "../learner";
import type { CefrPosterior } from "../learner";
import type { Situation } from "../situation";
import type { LemmaRef } from "./lexical-prescription";
import type {
  FormsSource,
  WordForms
} from "../classifier/word-forms";

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
  glosses?: Record<string, string>;
  examples?: string[];
  cefrPriorSource?: string;
  /**
   * The word's inflected forms, shaped by part of speech. Absent for entries
   * that do not inflect, and for the ones nobody has filled in yet -- absence
   * is a normal state, not an error.
   *
   * Read them through `runtime/classifier/word-forms.ts`; the arrays are
   * positional and indexing them by hand is how a person miscounts a person.
   */
  forms?: WordForms;
  /** Where `forms` came from, so review is a queue rather than a guess. */
  formsSource?: FormsSource;
}

/**
 * Active quest-essential lemma filtered down to currently active objectives.
 *
 * 090.4: DELETED from TeacherContext -- see ../teacher/quest-essential.ts.
 * This type survives only for the OLDER `sceneLexicon.questEssentialLemmas`
 * annotation pipeline that the VERIFIER still reads
 * (middlewares/shared.ts, sugar-lang-verify-middleware.ts) to check whether a
 * rendered line glossed a quest-critical word. That is a different consumer
 * checking rendered output, not the Teacher's input, and is out of this
 * story's scope.
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
 * Language configuration passed into the teacher.
 *
 * Implements: Proposal 001 §3. Director
 */
export interface TeacherLanguageContext {
  targetLanguage: string;
  supportLanguage: string;
}

/**
 * Full teacher invocation context owned by middleware assembly.
 *
 * TWO CONTENT DOORS (090.4). `TeacherContext` used to carry learner, scene,
 * prescription, npc, recentTurns, calibrationActive, pendingProvisionalLemmas,
 * probeFloorState, activeQuestEssentialLemmas, selectionMetadata -- eleven
 * ways in for what is really two questions: what is this moment (`situation`)
 * and where does this learner stand (`learner`).
 *
 * Three different fixes got the count down, and the distinction between them is
 * the useful part:
 *
 *   MOVED    `scene`, `npc`, `recentTurns` are facts about the moment, so they
 *            are on the SITUATION (../situation/situation.ts). So is
 *            `turnsSinceLastProbe`, which is conversation state.
 *   DERIVED  `pendingProvisionalLemmas` and `probeFloorState` are SIGNALS --
 *            pure functions of the learner's own cards plus a turn count
 *            (../learner/pacing-signals.ts). `activeQuestEssentialLemmas` is
 *            likewise a function of the situation's concepts
 *            (../teacher/quest-essential.ts). A derived value carried as a
 *            field is a copy that can disagree with what it came from, so none
 *            of the three is a field any more.
 *   DELETED  `prescription` (090.4b) and `selectionMetadata`, whose only use
 *            -- formatGameMoment -- gave its shape no documented meaning.
 *
 * `learner` is therefore plain `LearnerProfile` again: everything that was
 * wrapped around it either was not learner state or did not need storing.
 *
 * What survives alongside the two doors is plumbing, not content:
 * `conversationId` and `situationKey` are cache/identity keys, and `atlas` is
 * a stateless ADR-010 lookup service (the same category as any other
 * provider), not information about the learner or the world.
 *
 * Implements: Proposal 001 §3. Director / §Observer Latency Bias / §Quest-Essential Lemma Exemption
 */
export interface TeacherContext {
  conversationId: string;
  telemetryContext?: {
    turnId: string;
    sessionId: string;
  };
  learner: LearnerProfile;
  /**
   * 090.2c/090.4: a stateless lookup service (ADR 010 provider), not
   * situational content -- used for lemma-formatting lookups and for
   * resolving scene teachables (resolveSceneTeachables), the same role atlas
   * plays everywhere else in this stack.
   */
  atlas: LexicalAtlasProvider;
  /**
   * 090.3b: identity of the situation this decision is being made FOR.
   *
   * The directive cache compares it and retires a decision made for a different
   * situation. Optional while the producer lands in 090.3d -- absent means the
   * cached decision cannot be checked, which the cache treats as unverifiable
   * rather than as valid.
   */
  situationKey?: string;
  /**
   * 090.3d/090.4: the live half -- what is true in the world right now, who
   * the Teacher is talking to, and what was just said.
   *
   * Optional because a caller may have none (a test, or a path with no runtime
   * context). Absent renders as "(unknown)" in the prompt rather than as an
   * empty situation, because those are different claims.
   */
  situation?: Situation;
  /**
   * Where the learner stands on the curriculum: competencies met and how often
   * they have recurred, competencies never met, cards that have decayed.
   *
   * Facts, never a ranking. The Teacher weighs them against the situation and
   * decides; nothing upstream is allowed to decide for it. Optional because a
   * caller may have none, and absent is not the same claim as "nothing met".
   */
  learnerProgress?: LearnerProgress;
  lang: TeacherLanguageContext;
  calibrationActive: boolean;
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
  getGloss: (lemmaId: string, lang: string, supportLang: string) => string | undefined;
  /**
   * The word's inflected forms, or undefined when it has none stored.
   *
   * Undefined is ordinary: closed-class words do not inflect here, and 584
   * higher-band verbs have no paradigm yet. Callers fall back to the citation
   * form rather than treating it as a failure.
   */
  getForms: (lemmaId: string, lang: string) => WordForms | undefined;
  resolveFromGloss: (glossWord: string, lang: string, supportLang: string) => AtlasLemmaEntry[];
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
 * ADR 010 seam for the LLM-backed teacher policy.
 *
 * Implements: ADR 010 provider boundaries / Proposal 001 §3. Director
 */
export interface TeacherPolicy {
  invoke: (context: TeacherContext) => Promise<PedagogicalDirective>;
}
