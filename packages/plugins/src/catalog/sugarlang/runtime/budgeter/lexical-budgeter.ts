/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/lexical-budgeter.ts
 *
 * Purpose: Implements the main Lexical Budgeter facade.
 *
 * Exports:
 *   - LexicalBudgeterOptions
 *   - LexicalBudgeter
 *
 * Relationships:
 *   - Depends on runtime/contracts for Budgeter inputs and outputs.
 *   - Is consumed by the context middleware as the read-only lexical scheduler.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  CEFRBand,
  LearnerPriorProvider,
  LemmaCard,
  LexicalAtlasProvider,
  LexicalPrescription,
  LexicalPrescriptionInput,
  SceneLemmaInfo
} from "../types";
import { CEFR_BAND_ORDER } from "../cefr";
import { seedCardFromAtlas } from "./fsrs-adapter";
import { buildLexicalRationale } from "./rationale";
import { scoreBatch, type LemmaScore } from "./scoring";

export interface LexicalBudgeterOptions {
  atlas: LexicalAtlasProvider;
  learnerPriorProvider: LearnerPriorProvider;
}

function getBandIndex(band: CEFRBand): number {
  return CEFR_BAND_ORDER.indexOf(band);
}

/**
 * Maximum number of NEW (never-seen) lemmas the budgeter will prescribe per
 * turn. This is the "introduce" budget — separate from reinforce, which has
 * its own cap of 4. Higher bands get more new words per turn because the
 * learner can handle denser input.
 */
function getLevelCap(band: CEFRBand): number {
  switch (band) {
    case "A1":
      return 3;
    case "A2":
      return 4;
    case "B1":
      return 5;
    case "B2":
    case "C1":
    case "C2":
      return 6;
  }
}

function toLemmaRef(lemmaId: string, lang: string) {
  return { lemmaId, lang };
}

const FUNCTIONAL_POS = new Set([
  "article", "determiner", "preposition", "pronoun",
  "conjunction", "auxiliary", "particle"
]);

/**
 * Returns true if the lemma is a function word (article, preposition, etc.)
 * that should not be prescribed as target vocabulary. These words are too
 * common and ambiguous across languages to be useful teaching targets.
 */
function isFunctionalLemma(
  lemma: SceneLemmaInfo,
  atlasEntry: AtlasLemmaEntry | undefined
): boolean {
  if (lemma.lemmaId.length <= 2) return true;
  // 090.2c: parts of speech come from the atlas rather than a stored copy. A
  // lemma the atlas does not know has no POS evidence at all, and `every` over
  // an empty list is vacuously true -- which would silently classify it as a
  // function word and drop it. Absent evidence must not read as evidence.
  if (!atlasEntry || atlasEntry.partsOfSpeech.length === 0) return false;
  return atlasEntry.partsOfSpeech.every((pos) =>
    FUNCTIONAL_POS.has(pos.toLowerCase())
  );
}

function resolveNowMs(input: LexicalPrescriptionInput): number {
  return typeof input.conversationState.nowMs === "number"
    ? input.conversationState.nowMs
    : input.learner.currentSession?.startedAt ?? 0;
}

function resolveCurrentSessionTurn(input: LexicalPrescriptionInput): number {
  return typeof input.conversationState.currentSessionTurn === "number"
    ? input.conversationState.currentSessionTurn
    : input.learner.currentSession?.turns ?? 0;
}

function compareScoresDescending(left: LemmaScore, right: LemmaScore): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.lemmaId.localeCompare(right.lemmaId);
}

function compareScoresAscending(left: LemmaScore, right: LemmaScore): number {
  if (left.score !== right.score) {
    return left.score - right.score;
  }
  return left.lemmaId.localeCompare(right.lemmaId);
}

/**
 * 090.2c deleted `buildFallbackAtlasEntry`. It fell back to the compiled copy of
 * `cefrPriorBand` when `atlas.getLemma` missed -- but that copy was written FROM
 * the atlas at compile time, and `atlasVersion` is part of the content hash, so
 * a miss meant the artifact was already stale and due for recompile. It was a
 * fallback for a state the cache key prevents, and it labelled the value
 * "human-override" when nothing had overridden anything.
 */
export class LexicalBudgeter {
  constructor(private readonly options: LexicalBudgeterOptions) {}

  async prescribe(
    input: LexicalPrescriptionInput
  ): Promise<LexicalPrescription> {
    const lang = input.learner.targetLanguage;
    const nowMs = resolveNowMs(input);
    const currentSessionTurn = resolveCurrentSessionTurn(input);
    const levelCap = getLevelCap(input.learner.estimatedCefrBand);
    const questEssentialExclusionLemmaIds = new Set(
      (input.activeQuestEssentialLemmas ?? []).map((lemma) => lemma.lemmaId)
    );
    // 090.2c: every atlas fact is resolved ONCE here, by lemmaId, and carried
    // alongside the scene entry. The artifact no longer stores its own copy, so
    // this is the single point where the two are joined.
    const candidateLemmas = Object.values(input.sceneLexicon.lemmas)
      .map((lemma) => ({
        lemma,
        atlasEntry: this.options.atlas.getLemma(lemma.lemmaId, lang)
      }))
      .filter(
        ({ lemma, atlasEntry }) =>
          !questEssentialExclusionLemmaIds.has(lemma.lemmaId) &&
          !isFunctionalLemma(lemma, atlasEntry)
      );

    const learnerBandIndex = getBandIndex(input.learner.estimatedCefrBand);
    const scoredCandidates = candidateLemmas.map(({ lemma, atlasEntry }) => {
      const card =
        input.learner.lemmaCards[lemma.lemmaId] ??
        this.options.learnerPriorProvider.getInitialLemmaCard(
          lemma.lemmaId,
          lang,
          input.learner.estimatedCefrBand
        ) ??
        (atlasEntry
          ? seedCardFromAtlas(
              lemma.lemmaId,
              lang,
              atlasEntry,
              input.learner.estimatedCefrBand
            )
          : undefined);

      return { lemma, atlasEntry, card };
    });

    // A lemma the atlas cannot band is not prescribable -- there is no evidence
    // to place it against the learner's level. Previously this could not happen,
    // because the compiled copy always carried a band.
    const bandable = scoredCandidates.filter(
      (
        candidate
      ): candidate is typeof candidate & {
        card: LemmaCard;
        atlasEntry: AtlasLemmaEntry;
      } => candidate.card !== undefined && candidate.atlasEntry !== undefined
    );

    const survivors = bandable.filter(
      ({ atlasEntry }) =>
        getBandIndex(atlasEntry.cefrPriorBand) <= learnerBandIndex + 1
    );
    const rejects = bandable.filter(
      ({ atlasEntry }) =>
        getBandIndex(atlasEntry.cefrPriorBand) > learnerBandIndex + 1
    );

    const scoringContext = {
      nowMs,
      currentSessionTurn,
      currentNpcDefinitionId: input.npcDefinitionId ?? null
    };
    const survivorScores = scoreBatch(survivors, input.sceneLexicon, scoringContext)
      .sort(compareScoresDescending);
    const rejectScores = scoreBatch(rejects, input.sceneLexicon, scoringContext)
      .sort(compareScoresAscending);

    const survivorCardsByLemmaId = new Map(
      survivors.map(({ card }) => [card.lemmaId, card] as const)
    );
    const introduce = survivorScores
      .filter((score) => (survivorCardsByLemmaId.get(score.lemmaId)?.reviewCount ?? 0) === 0)
      .slice(0, levelCap)
      .map((score) => toLemmaRef(score.lemmaId, lang));
    const reinforce = survivorScores
      .filter((score) => (survivorCardsByLemmaId.get(score.lemmaId)?.reviewCount ?? 0) > 0)
      .slice(0, 4)
      .map((score) => toLemmaRef(score.lemmaId, lang));
    const avoid = rejectScores
      .slice(0, 12)
      .map((score) => toLemmaRef(score.lemmaId, lang));
    const anchorScore = survivorScores.find((score) =>
      input.sceneLexicon.anchors.includes(score.lemmaId)
    );
    const rationale = buildLexicalRationale(input, {
      candidateSetSize: candidateLemmas.length,
      envelopeSurvivorCount: survivors.length,
      levelCap,
      chosenIntroduce: introduce,
      chosenReinforce: reinforce,
      droppedByEnvelope: avoid,
      priorityScores: survivorScores,
      questEssentialExclusionLemmaIds: Array.from(questEssentialExclusionLemmaIds).sort()
    });

    return {
      introduce,
      reinforce,
      avoid,
      anchor: anchorScore ? toLemmaRef(anchorScore.lemmaId, lang) : undefined,
      budget: {
        newItemsAllowed: levelCap,
        turnSeconds:
          typeof input.conversationState.turnSeconds === "number"
            ? input.conversationState.turnSeconds
            : undefined
      },
      rationale
    };
  }
}
