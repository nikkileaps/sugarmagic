/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/tokenize.ts
 *
 * Purpose: Tokenizes generated text into deterministic word and number tokens.
 *
 * Exports:
 *   - tokenize
 *
 * Relationships:
 *   - Is consumed by lemmatization, coverage computation, and auto-simplify.
 *   - Preserves token offsets so later stages can report and rewrite exact spans.
 *
 * Implements: Proposal 001 §2. Envelope Classifier
 *
 * Status: active
 */

export type TokenKind = "word" | "punct" | "number" | "whitespace";

export interface Token {
  surface: string;
  start: number;
  end: number;
  kind: TokenKind;
}

const segmenterCache = new Map<string, Intl.Segmenter>();
const numberPattern = /^\p{Number}+$/u;
const wordPattern = /[\p{Letter}\p{Mark}]/u;

function getSegmenter(lang: string): Intl.Segmenter {
  const cached = segmenterCache.get(lang);
  if (cached) {
    return cached;
  }

  const segmenter = new Intl.Segmenter(lang, { granularity: "word" });
  segmenterCache.set(lang, segmenter);
  return segmenter;
}

function classifySegment(segment: string, isWordLike: boolean): TokenKind {
  if (/^\s+$/u.test(segment)) {
    return "whitespace";
  }
  if (numberPattern.test(segment)) {
    return "number";
  }
  if (isWordLike || wordPattern.test(segment)) {
    return "word";
  }

  return "punct";
}

export function tokenize(text: string, lang: string): Token[] {
  const normalizedText = text.normalize("NFC");
  if (normalizedText.length === 0) {
    return [];
  }

  const tokens: Token[] = [];
  const segmenter = getSegmenter(lang);

  for (const segment of segmenter.segment(normalizedText)) {
    const kind = classifySegment(segment.segment, segment.isWordLike ?? false);
    if (kind === "punct" || kind === "whitespace") {
      continue;
    }

    tokens.push({
      surface:
        kind === "word"
          ? segment.segment.toLocaleLowerCase(lang).normalize("NFC")
          : segment.segment.normalize("NFC"),
      start: segment.index,
      end: segment.index + segment.segment.length,
      kind
    });
  }

  return tokens;
}
