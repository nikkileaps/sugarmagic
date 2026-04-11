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
  LexicalAtlasProvider,
  LexicalPrescription,
  LexicalPrescriptionInput,
  SceneLemmaInfo
} from "../types";
import { CEFR_BAND_ORDER } from "../learner/cefr-posterior";
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
function isFunctionalLemma(lemma: SceneLemmaInfo): boolean {
  if (lemma.lemmaId.length <= 2) return true;
  return lemma.partsOfSpeech.every((pos) =>
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

function buildFallbackAtlasEntry(lemma: SceneLemmaInfo): Pick<AtlasLemmaEntry, "cefrPriorBand" | "cefrPriorSource"> {
  return {
    cefrPriorBand: lemma.cefrPriorBand,
    cefrPriorSource: "human-override"
  };
}

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
    const candidateLemmas = Object.values(input.sceneLexicon.lemmas).filter(
      (lemma) =>
        !questEssentialExclusionLemmaIds.has(lemma.lemmaId) &&
        !isFunctionalLemma(lemma)
    );

    const learnerBandIndex = getBandIndex(input.learner.estimatedCefrBand);
    const scoredCandidates = candidateLemmas.map((lemma) => {
      const card =
        input.learner.lemmaCards[lemma.lemmaId] ??
        this.options.learnerPriorProvider.getInitialLemmaCard(
          lemma.lemmaId,
          lang,
          input.learner.estimatedCefrBand
        ) ??
        seedCardFromAtlas(
          lemma.lemmaId,
          lang,
          this.options.atlas.getLemma(lemma.lemmaId, lang) ??
            buildFallbackAtlasEntry(lemma),
          input.learner.estimatedCefrBand
        );

      return { lemma, card };
    });

    const survivors = scoredCandidates.filter(
      ({ lemma }) => getBandIndex(lemma.cefrPriorBand) <= learnerBandIndex + 1
    );
    const rejects = scoredCandidates.filter(
      ({ lemma }) => getBandIndex(lemma.cefrPriorBand) > learnerBandIndex + 1
    );

    const survivorScores = scoreBatch(survivors, input.sceneLexicon, {
      nowMs,
      currentSessionTurn
    }).sort(compareScoresDescending);
    const rejectScores = scoreBatch(rejects, input.sceneLexicon, {
      nowMs,
      currentSessionTurn
    }).sort(compareScoresAscending);

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
