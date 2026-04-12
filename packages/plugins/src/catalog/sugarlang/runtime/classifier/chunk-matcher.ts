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

interface ChunkTrieNode {
  children: Map<string, ChunkTrieNode>;
  terminals: LexicalChunk[];
}

export interface ChunkMatch {
  chunk: LexicalChunk;
  normalizedForm: string;
  surfaceMatched: string;
  start: number;
  end: number;
  cefrBand: LexicalChunk["cefrBand"];
  constituentLemmaIds: string[];
  tokenIndexes: number[];
}

export interface ChunkMatcher {
  match: (tokens: Token[]) => ChunkMatch[];
}

function createTrieNode(): ChunkTrieNode {
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

export function createChunkMatcher(
  chunks: LexicalChunk[] | undefined,
  lang: string,
  sourceText: string
): ChunkMatcher {
  const normalizedSourceText = sourceText.normalize("NFC");
  const root = createTrieNode();

  for (const chunk of chunks ?? []) {
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
        const next = cursor.children.get(token) ?? createTrieNode();
        cursor.children.set(token, next);
        cursor = next;
      }
      cursor.terminals.push(chunk);
    }
  }

  return {
    match(tokens: Token[]): ChunkMatch[] {
      const matches: ChunkMatch[] = [];
      let index = 0;

      while (index < tokens.length) {
        let cursor: ChunkTrieNode | undefined = root;
        let candidate:
          | {
              chunk: LexicalChunk;
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
            return left.chunkId.localeCompare(right.chunkId);
          })[0];

          if (terminal) {
            candidate = {
              chunk: terminal,
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
          chunk: candidate.chunk,
          normalizedForm: candidate.chunk.normalizedForm,
          surfaceMatched: normalizedSourceText.slice(startToken.start, endToken.end),
          start: startToken.start,
          end: endToken.end,
          cefrBand: candidate.chunk.cefrBand,
          constituentLemmaIds: [...candidate.chunk.constituentLemmas],
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
