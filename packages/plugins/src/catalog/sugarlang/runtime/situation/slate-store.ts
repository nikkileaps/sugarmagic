/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/slate-store.ts
 *
 * Purpose: Holds the current slate, keyed on the SITUATION rather than on a
 *   conversation.
 *
 * WHY NOT JUST USE THE DIRECTIVE CACHE
 *   `DirectiveCache` keys on `conversationId`. Item views render before any
 *   conversation exists (runtime-services.ts:392-402), so when realization asks
 *   "which of the slate's words does this item body teach", there is no
 *   conversation to look it up under. Keying on the situation is what makes the
 *   slate readable from the item path at all -- which is the whole reason 090.8
 *   depends on this store existing.
 *
 * ABSENT IS A LEGAL STATE, AND IT IS LEGIBLE
 *   `read` distinguishes three outcomes rather than returning `Slate | null`:
 *   nothing has been decided yet, something was decided for a DIFFERENT
 *   situation, or here it is. The middle case is the one that matters -- it is
 *   the difference between "the Teacher has not run" and "the Teacher ran and
 *   the world has since moved", and a bare null makes them identical. Same
 *   empty-vs-missing discipline as the rest of this module.
 *
 * SESSION-SCOPED, IN MEMORY
 *   A slate is a decision about right now; it has no meaning after a reload, so
 *   it is deliberately not persisted. Restoring one would also resurrect a
 *   decision made against a world state that no longer exists.
 *
 * Exports:
 *   - SlateReadResult, SlateStore
 *
 * Relationships:
 *   - Written by the Teacher (090.4), read by realization (090.8) and by any
 *     surface that wants to show what is currently being taught.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import type { Slate } from "./slate";

export type SlateReadResult =
  /** No slate has been decided at all this session. */
  | { readonly status: "none" }
  /**
   * A slate exists, but for a different situation. The caller must not use it;
   * it is surfaced rather than swallowed so "we are between decisions" is
   * visible instead of looking like "nothing was ever decided".
   */
  | { readonly status: "stale"; readonly decidedForKey: string }
  | { readonly status: "current"; readonly slate: Slate };

export class SlateStore {
  private slate: Slate | null = null;

  /**
   * Reads the slate for a situation. Takes no conversation -- that is the point.
   */
  read(situationKey: string): SlateReadResult {
    if (!this.slate) {
      return { status: "none" };
    }
    if (this.slate.situationKey !== situationKey) {
      return { status: "stale", decidedForKey: this.slate.situationKey };
    }
    return { status: "current", slate: this.slate };
  }

  /**
   * One slate at a time.
   *
   * A slate describes what the learner is working on NOW, so keeping a map of
   * them by situation would let a stale decision be served after the world moved
   * back to a situation it happens to have a key for -- a cache that gets more
   * wrong the longer it runs. Replacing is the honest model.
   */
  write(slate: Slate): void {
    this.slate = slate;
  }

  clear(): void {
    this.slate = null;
  }
}
