/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/card-store.ts
 *
 * Purpose: Implements the lemma-card persistence stores used by learner-state save/load paths.
 *
 * Exports:
 *   - CARD_STORE_PAGE_SIZE
 *   - CardStorePage
 *   - CardStore
 *   - MemoryCardStore
 *   - IndexedDBCardStore
 *
 * Relationships:
 *   - Depends on learner-profile contract types only.
 *   - Is consumed by learner persistence, the reducer, and the read-side learner store.
 *
 * Implements: Proposal 001 §Learner State Model
 *
 * Status: active
 */

import type { LemmaCard } from "../types";

export const CARD_STORE_PAGE_SIZE = 250;

const DB_NAME_PREFIX = "sugarlang-card-store";
const CARD_STORE_NAME = "lemma-cards";

export interface CardStorePage {
  cards: LemmaCard[];
  nextCursor: string | null;
}

export interface CardStore {
  get: (lemmaId: string) => Promise<LemmaCard | undefined>;
  set: (card: LemmaCard) => Promise<void>;
  bulkGet: (lemmaIds: string[]) => Promise<Map<string, LemmaCard>>;
  bulkSet: (cards: LemmaCard[]) => Promise<void>;
  list: () => Promise<LemmaCard[]>;
  listPage: (cursor?: string | null, limit?: number) => Promise<CardStorePage>;
  count: () => Promise<number>;
  clear: () => Promise<void>;
}

function cloneCard(card: LemmaCard): LemmaCard {
  return { ...card };
}

function sortCards(cards: Iterable<LemmaCard>): LemmaCard[] {
  return Array.from(cards).sort((left, right) => left.lemmaId.localeCompare(right.lemmaId));
}

export class MemoryCardStore implements CardStore {
  private readonly cards = new Map<string, LemmaCard>();

  async get(lemmaId: string): Promise<LemmaCard | undefined> {
    const card = this.cards.get(lemmaId);
    return card ? cloneCard(card) : undefined;
  }

  async set(card: LemmaCard): Promise<void> {
    this.cards.set(card.lemmaId, cloneCard(card));
  }

  async bulkGet(lemmaIds: string[]): Promise<Map<string, LemmaCard>> {
    const results = new Map<string, LemmaCard>();
    for (const lemmaId of lemmaIds) {
      const card = this.cards.get(lemmaId);
      if (card) {
        results.set(lemmaId, cloneCard(card));
      }
    }
    return results;
  }

  async bulkSet(cards: LemmaCard[]): Promise<void> {
    for (const card of cards) {
      this.cards.set(card.lemmaId, cloneCard(card));
    }
  }

  async list(): Promise<LemmaCard[]> {
    return sortCards(this.cards.values()).map(cloneCard);
  }

  async listPage(cursor: string | null = null, limit = CARD_STORE_PAGE_SIZE): Promise<CardStorePage> {
    const sorted = sortCards(this.cards.values());
    const startIndex =
      cursor === null ? 0 : Math.max(0, sorted.findIndex((card) => card.lemmaId > cursor));
    const cards = sorted.slice(startIndex, startIndex + limit).map(cloneCard);
    const nextCursor =
      startIndex + limit < sorted.length ? sorted[startIndex + limit - 1]?.lemmaId ?? null : null;

    return { cards, nextCursor };
  }

  async count(): Promise<number> {
    return this.cards.size;
  }

  async clear(): Promise<void> {
    this.cards.clear();
  }
}

export interface IndexedDBCardStoreOptions {
  profileId: string;
  indexedDbFactory?: IDBFactory | null;
}

export class IndexedDBCardStore implements CardStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly indexedDbFactory: IDBFactory;

  constructor(private readonly options: IndexedDBCardStoreOptions) {
    const indexedDbFactory =
      "indexedDbFactory" in options
        ? options.indexedDbFactory ?? null
        : globalThis.indexedDB ?? null;
    if (!indexedDbFactory) {
      throw new Error("IndexedDBCardStore requires an IndexedDB implementation.");
    }
    this.indexedDbFactory = indexedDbFactory;
  }

  async get(lemmaId: string): Promise<LemmaCard | undefined> {
    const request = this.getObjectStore("readonly", (store) => store.get(lemmaId));
    const card = await this.awaitRequest<LemmaCard | undefined>(request);
    return card ? cloneCard(card) : undefined;
  }

  async set(card: LemmaCard): Promise<void> {
    await this.awaitRequest(
      this.getObjectStore("readwrite", (store) => store.put(cloneCard(card)))
    );
  }

  async bulkGet(lemmaIds: string[]): Promise<Map<string, LemmaCard>> {
    const db = await this.getDatabase();
    const transaction = db.transaction(CARD_STORE_NAME, "readonly");
    const store = transaction.objectStore(CARD_STORE_NAME);
    const requests = lemmaIds.map(async (lemmaId) => {
      const card = await this.awaitRequest<LemmaCard | undefined>(store.get(lemmaId));
      return card ? [lemmaId, cloneCard(card)] : null;
    });

    const results = await Promise.all(requests);
    await this.awaitTransaction(transaction);
    return new Map(results.filter((entry): entry is [string, LemmaCard] => entry !== null));
  }

  async bulkSet(cards: LemmaCard[]): Promise<void> {
    if (cards.length === 0) {
      return;
    }

    const db = await this.getDatabase();
    const transaction = db.transaction(CARD_STORE_NAME, "readwrite");
    const store = transaction.objectStore(CARD_STORE_NAME);
    for (const card of cards) {
      store.put(cloneCard(card));
    }
    await this.awaitTransaction(transaction);
  }

  async list(): Promise<LemmaCard[]> {
    const cards: LemmaCard[] = [];
    let cursor: string | null = null;

    while (true) {
      const page = await this.listPage(cursor);
      cards.push(...page.cards);
      if (!page.nextCursor) {
        return cards;
      }
      cursor = page.nextCursor;
    }
  }

  async listPage(cursor: string | null = null, limit = CARD_STORE_PAGE_SIZE): Promise<CardStorePage> {
    const db = await this.getDatabase();
    const transaction = db.transaction(CARD_STORE_NAME, "readonly");
    const store = transaction.objectStore(CARD_STORE_NAME);
    const range = cursor ? IDBKeyRange.lowerBound(cursor, true) : undefined;
    const page = await new Promise<CardStorePage>((resolve, reject) => {
      const cards: LemmaCard[] = [];
      let nextCursor: string | null = null;
      const request = store.openCursor(range);

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to read IndexedDB card page."));
      };

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve({ cards, nextCursor });
          return;
        }

        if (cards.length >= limit) {
          nextCursor = cards[cards.length - 1]?.lemmaId ?? null;
          resolve({ cards, nextCursor });
          return;
        }

        cards.push(cloneCard(result.value as LemmaCard));
        result.continue();
      };
    });
    await this.awaitTransaction(transaction);

    return page;
  }

  async count(): Promise<number> {
    return this.awaitRequest<number>(this.getObjectStore("readonly", (store) => store.count()));
  }

  async clear(): Promise<void> {
    await this.awaitRequest(this.getObjectStore("readwrite", (store) => store.clear()));
  }

  private async getObjectStore<TValue>(
    mode: IDBTransactionMode,
    select: (store: IDBObjectStore) => IDBRequest<TValue>
  ): Promise<IDBRequest<TValue>> {
    const db = await this.getDatabase();
    const transaction = db.transaction(CARD_STORE_NAME, mode);
    return select(transaction.objectStore(CARD_STORE_NAME));
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.indexedDbFactory.open(
          `${DB_NAME_PREFIX}:${this.options.profileId}`,
          1
        );

        request.onerror = () => {
          reject(request.error ?? new Error("Failed to open IndexedDB card store."));
        };
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CARD_STORE_NAME)) {
            db.createObjectStore(CARD_STORE_NAME, { keyPath: "lemmaId" });
          }
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
      });
    }

    return this.dbPromise;
  }
  private async awaitRequest<TValue>(
    requestOrPromise: IDBRequest<TValue> | Promise<IDBRequest<TValue>>
  ): Promise<TValue> {
    const request = await requestOrPromise;
    return new Promise<TValue>((resolve, reject) => {
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB request failed."));
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  private async awaitTransaction(transaction: IDBTransaction): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      };
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
      };
    });
  }
}
