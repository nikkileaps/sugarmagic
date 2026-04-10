/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/coverage.ts
 *
 * Purpose: Computes deterministic token coverage against learner state and atlas priors.
 *
 * Exports:
 *   - computeCoverage
 *
 * Relationships:
 *   - Depends on tokenization, lemmatization, learner profiles, and the lexical atlas.
 *   - Is consumed by EnvelopeClassifier before rule evaluation.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

import type {
  CEFRBand,
  CoverageProfile,
  LexicalChunk,
  LearnerProfile,
  LexicalAtlasProvider
} from "../types";
import type { MorphologyDataFile } from "./morphology-loader";
import { MorphologyLoader } from "./morphology-loader";
import { compareCefrBands, isBandAbove } from "./cefr-band-utils";
import type { ChunkMatcher } from "./chunk-matcher";
import { lemmatize } from "./lemmatize";
import type { Token } from "./tokenize";

function createBandHistogram(): Record<CEFRBand, number> {
  return {
    A1: 0,
    A2: 0,
    B1: 0,
    B2: 0,
    C1: 0,
    C2: 0
  };
}

function normalizeLookup(values: Iterable<string>): Set<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    normalized.add(value.normalize("NFC").toLocaleLowerCase());
  }

  return normalized;
}

export function computeCoverage(
  tokens: Token[],
  learner: LearnerProfile,
  atlas: LexicalAtlasProvider,
  knownEntities: Set<string> = new Set(),
  morphologyIndex?:
    | MorphologyDataFile
    | MorphologyLoader
    | Record<string, string>,
  questEssentialLemmas: Set<string> = new Set(),
  chunkMatcher?: ChunkMatcher | null,
  sceneChunks?: LexicalChunk[]
): CoverageProfile {
  const learnerBand = learner.estimatedCefrBand;
  const bandHistogram = createBandHistogram();
  const outOfEnvelopeLemmas = new Map<string, CoverageProfile["outOfEnvelopeLemmas"][number]>();
  const ceilingExceededLemmas = new Map<string, CoverageProfile["ceilingExceededLemmas"][number]>();
  const matchedQuestEssentialLemmas = new Set<string>();
  const matchedChunks = new Map<string, LexicalChunk>();
  const normalizedKnownEntities = normalizeLookup(knownEntities);
  const normalizedQuestEssentialLemmas = normalizeLookup(questEssentialLemmas);
  const chunkMatches = chunkMatcher?.match(tokens) ?? [];
  const consumedTokenIndexes = new Set<number>();

  for (const match of chunkMatches) {
    matchedChunks.set(match.chunk.chunkId, match.chunk);
    for (const tokenIndex of match.tokenIndexes) {
      consumedTokenIndexes.add(tokenIndex);
    }
  }

  let totalTokens = 0;
  let knownTokens = 0;
  let inBandTokens = 0;
  let unknownTokens = 0;

  for (const chunkToken of chunkMatches) {
    totalTokens += 1;
    bandHistogram[chunkToken.cefrBand] += 1;

    if (compareCefrBands(chunkToken.cefrBand, learnerBand) <= 0) {
      knownTokens += 1;
      inBandTokens += 1;
      continue;
    }

    const lemmaRef = {
      lemmaId: chunkToken.normalizedForm,
      lang: learner.targetLanguage,
      surfaceForm: chunkToken.surfaceMatched
    };
    outOfEnvelopeLemmas.set(lemmaRef.lemmaId, lemmaRef);
    if (isBandAbove(chunkToken.cefrBand, learnerBand, 1)) {
      ceilingExceededLemmas.set(lemmaRef.lemmaId, lemmaRef);
    }
  }

  for (const [tokenIndex, token] of tokens.entries()) {
    if (consumedTokenIndexes.has(tokenIndex)) {
      continue;
    }

    if (token.kind !== "word" && token.kind !== "number") {
      continue;
    }

    totalTokens += 1;

    if (token.kind === "number") {
      knownTokens += 1;
      inBandTokens += 1;
      bandHistogram[learnerBand] += 1;
      continue;
    }

    if (normalizedKnownEntities.has(token.surface.normalize("NFC").toLocaleLowerCase())) {
      knownTokens += 1;
      inBandTokens += 1;
      bandHistogram[learnerBand] += 1;
      continue;
    }

    const lemma = lemmatize(token, learner.targetLanguage, morphologyIndex);
    if (!lemma) {
      unknownTokens += 1;
      continue;
    }

    if (normalizedQuestEssentialLemmas.has(lemma.lemmaId.normalize("NFC").toLocaleLowerCase())) {
      matchedQuestEssentialLemmas.add(lemma.lemmaId);
    }

    const band = atlas.getBand(lemma.lemmaId, lemma.lang);
    if (!band) {
      unknownTokens += 1;
      continue;
    }

    bandHistogram[band] += 1;

    const learnerCard = learner.lemmaCards[lemma.lemmaId];
    if (learnerCard && learnerCard.stability > 0) {
      knownTokens += 1;
      continue;
    }

    if (compareCefrBands(band, learnerBand) <= 0) {
      knownTokens += 1;
      inBandTokens += 1;
      continue;
    }

    outOfEnvelopeLemmas.set(lemma.lemmaId, lemma);
    if (isBandAbove(band, learnerBand, 1)) {
      ceilingExceededLemmas.set(lemma.lemmaId, lemma);
    }
  }

  return {
    totalTokens,
    knownTokens,
    inBandTokens,
    unknownTokens,
    bandHistogram,
    outOfEnvelopeLemmas: Array.from(outOfEnvelopeLemmas.values()),
    ceilingExceededLemmas: Array.from(ceilingExceededLemmas.values()),
    questEssentialLemmasMatched: Array.from(matchedQuestEssentialLemmas.values()),
    matchedChunks:
      sceneChunks?.filter((chunk) => matchedChunks.has(chunk.chunkId)) ??
      Array.from(matchedChunks.values()),
    matchedChunkTokens: chunkMatches.map((match) => ({
      chunkId: match.chunk.chunkId,
      normalizedForm: match.normalizedForm,
      surfaceMatched: match.surfaceMatched,
      start: match.start,
      end: match.end,
      cefrBand: match.cefrBand,
      constituentLemmaIds: [...match.constituentLemmaIds]
    })),
    coverageRatio: totalTokens === 0 ? 1 : knownTokens / totalTokens
  };
}
