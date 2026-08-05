/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/chunk-matcher.ts
 *
 * Purpose: Builds the deterministic lexical-chunk matcher used by the classifier pre-pass.
 *
 * Exports:
 *   - ChunkMatch
 *   - ChunkMatcher
 *   - createChunkMatcher
 *
 * Relationships:
 *   - Depends on lexical chunk contracts and tokenizer token offsets.
 *   - Is consumed by coverage.ts and EnvelopeClassifier as the single chunk-scan implementation.
 *
 * Implements: Proposal 001 §Lexical Chunk Awareness
 *
 * Status: active
 */

import type { LexicalChunk } from "../types";
import type { Token } from "./tokenize";
import { tokenize } from "./tokenize";

/**
 * Minimum shape the matcher needs. No id: the matcher scans surface forms and
 * hands back whatever it was given, so a scene chunk keeps its `chunkId` and a
 * competency's exponent keeps its `exponentId` instead of one borrowing the
 * other's name.
 */
export type ChunkSpec = Pick<
  LexicalChunk,
  "normalizedForm" | "surfaceForms" | "cefrBand" | "constituentLemmas"
>;

interface ChunkTrieNode<T extends ChunkSpec> {
  children: Map<string, ChunkTrieNode<T>>;
  terminals: T[];
}

export interface ChunkMatch<T extends ChunkSpec = ChunkSpec> {
  /** The item as supplied -- a LexicalChunk, or an Exponent. */
  item: T;
  normalizedForm: string;
  surfaceMatched: string;
  start: number;
  end: number;
  cefrBand: ChunkSpec["cefrBand"];
  constituentLemmaIds: string[];
  tokenIndexes: number[];
}

export interface ChunkMatcher<T extends ChunkSpec = ChunkSpec> {
  /** Pass the same source text that was tokenized, so surfaceMatched slices are accurate. */
  match: (tokens: Token[], sourceText: string) => ChunkMatch<T>[];
}

function createTrieNode<T extends ChunkSpec>(): ChunkTrieNode<T> {
  return {
    children: new Map(),
    terminals: []
  };
}

function normalizeChunkTokens(surface: string, lang: string): string[] {
  return tokenize(surface, lang)
    .filter((token) => token.kind === "word" || token.kind === "number")
    .map((token) => token.surface.normalize("NFC").toLocaleLowerCase(lang));
}

/**
 * Builds a trie-based chunk matcher for the given chunks and language.
 * sourceText is NOT a constructor argument -- pass it to match() per call
 * so a cached matcher works correctly across different turn texts.
 */
export function createChunkMatcher<T extends ChunkSpec>(
  items: T[] | undefined,
  lang: string
): ChunkMatcher<T> {
  const root = createTrieNode<T>();

  for (const chunk of items ?? []) {
    const patterns = new Set<string>();
    for (const surface of [chunk.normalizedForm, ...chunk.surfaceForms]) {
      const normalizedTokens = normalizeChunkTokens(surface, lang);
      if (normalizedTokens.length === 0) {
        continue;
      }

      const patternKey = normalizedTokens.join("\u0000");
      if (patterns.has(patternKey)) {
        continue;
      }
      patterns.add(patternKey);

      let cursor = root;
      for (const token of normalizedTokens) {
        const next = cursor.children.get(token) ?? createTrieNode<T>();
        cursor.children.set(token, next);
        cursor = next;
      }
      cursor.terminals.push(chunk);
    }
  }

  return {
    match(tokens: Token[], sourceText: string): ChunkMatch<T>[] {
      const normalizedSourceText = sourceText.normalize("NFC");
      const matches: ChunkMatch<T>[] = [];
      let index = 0;

      while (index < tokens.length) {
        let cursor: ChunkTrieNode<T> | undefined = root;
        let candidate:
          | {
              item: T;
              endIndex: number;
            }
          | undefined;
        let walkIndex = index;

        while (cursor && walkIndex < tokens.length) {
          const token = tokens[walkIndex];
          if (!token) {
            break;
          }

          cursor = cursor.children.get(
            token.surface.normalize("NFC").toLocaleLowerCase(lang)
          );
          if (!cursor) {
            break;
          }

          const terminal = [...cursor.terminals].sort((left, right) => {
            const leftLength = left.normalizedForm.length;
            const rightLength = right.normalizedForm.length;
            if (leftLength !== rightLength) {
              return rightLength - leftLength;
            }
            // normalizedForm is unique within a language, so it is a stable
            // tiebreak and costs the matcher no knowledge of what it holds.
            return left.normalizedForm.localeCompare(right.normalizedForm);
          })[0];

          if (terminal) {
            candidate = {
              item: terminal,
              endIndex: walkIndex
            };
          }

          walkIndex += 1;
        }

        if (!candidate) {
          index += 1;
          continue;
        }

        const startToken = tokens[index]!;
        const endToken = tokens[candidate.endIndex]!;
        matches.push({
          item: candidate.item,
          normalizedForm: candidate.item.normalizedForm,
          surfaceMatched: normalizedSourceText.slice(startToken.start, endToken.end),
          start: startToken.start,
          end: endToken.end,
          cefrBand: candidate.item.cefrBand,
          constituentLemmaIds: [...candidate.item.constituentLemmas],
          tokenIndexes: Array.from(
            { length: candidate.endIndex - index + 1 },
            (_, offset) => index + offset
          )
        });

        index = candidate.endIndex + 1;
      }

      return matches;
    }
  };
}
