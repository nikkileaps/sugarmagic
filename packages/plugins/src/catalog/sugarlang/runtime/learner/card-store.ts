/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/card-store.ts
 *
 * Purpose: Reserves the indexed lemma-card store interfaces and IndexedDB-backed implementation.
 *
 * Exports:
 *   - CardStore
 *   - IndexedDBCardStore
 *
 * Relationships:
 *   - Depends on learner-profile contract types.
 *   - Will be consumed by learner persistence and Budgeter work once Epic 7 lands.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { LemmaCard } from "../types";

export interface CardStore {
  listCards: () => Promise<LemmaCard[]>;
  upsertCard: (card: LemmaCard) => Promise<void>;
  deleteCard: (lemmaId: string) => Promise<void>;
}

export class IndexedDBCardStore implements CardStore {
  async listCards(): Promise<LemmaCard[]> {
    throw new Error("TODO: Epic 7");
  }

  async upsertCard(_card: LemmaCard): Promise<void> {
    throw new Error("TODO: Epic 7");
  }

  async deleteCard(_lemmaId: string): Promise<void> {
    throw new Error("TODO: Epic 7");
  }
}
