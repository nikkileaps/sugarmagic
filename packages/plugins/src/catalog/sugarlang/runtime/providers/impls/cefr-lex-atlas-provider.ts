/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/cefr-lex-atlas-provider.ts
 *
 * Purpose: Reserves the data-backed lexical atlas provider implementation for sugarlang.
 *
 * Exports:
 *   - CefrLexAtlasProvider
 *
 * Relationships:
 *   - Implements the LexicalAtlasProvider contract.
 *   - Will read plugin-shipped language assets once Epic 4 and Epic 5 land.
 *
 * Implements: Proposal 001 §Why This Proposal Exists / ADR 010 provider boundaries
 *
 * Status: skeleton (no implementation yet; see Epic 4 and Epic 5)
 */

import type {
  LexicalAtlasEntry,
  LexicalAtlasProvider,
  LemmaRef
} from "../../types";

export class CefrLexAtlasProvider implements LexicalAtlasProvider {
  getLemmaEntry(_lemmaRef: LemmaRef): LexicalAtlasEntry | null {
    throw new Error("TODO: Epic 4/5");
  }
}
