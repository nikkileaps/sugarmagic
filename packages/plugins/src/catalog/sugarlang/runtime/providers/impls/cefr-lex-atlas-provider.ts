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
  AtlasLemmaEntry,
  LexicalAtlasProvider,
  CEFRBand,
  LemmaRef
} from "../../types";

export class CefrLexAtlasProvider implements LexicalAtlasProvider {
  getLemma(_lemmaId: string, _lang: string): AtlasLemmaEntry | undefined {
    throw new Error("TODO: Epic 4/5");
  }

  getBand(_lemmaId: string, _lang: string): CEFRBand | undefined {
    throw new Error("TODO: Epic 4/5");
  }

  getFrequencyRank(_lemmaId: string, _lang: string): number | undefined {
    throw new Error("TODO: Epic 4/5");
  }

  listLemmasAtBand(_band: CEFRBand, _lang: string): LemmaRef[] {
    throw new Error("TODO: Epic 4/5");
  }

  getAtlasVersion(_lang: string): string {
    throw new Error("TODO: Epic 4/5");
  }
}
