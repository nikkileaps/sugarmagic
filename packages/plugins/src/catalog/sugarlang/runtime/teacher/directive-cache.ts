/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/directive-cache.ts
 *
 * Purpose: Implements the active-directive cache manager used by the Teacher'sfacade and middleware.
 *
 * Exports:
 *   - DirectiveCache
 *
 * Relationships:
 *   - Depends on runtime-core blackboard facts plus the PedagogicalDirective contract type.
 *   - Will be consumed by the Teacher'smiddleware in Epic 9 and Epic 10.
 *
 * Implements: Proposal 001 §3. Teacher's/ §End-to-End Turn Flow
 *
 * Status: active
 */

import {
  ENTITY_AFFECT_FACT,
  ENTITY_LOCATION_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  type BlackboardChangeEvent,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type { PedagogicalDirective } from "../types";
import {
  ACTIVE_DIRECTIVE_FACT,
  SUGARLANG_DIRECTOR_WRITER,
  createActiveDirectiveFactScope
} from "../learner/fact-definitions";

export type InvalidationReason =
  | "max_turns_exceeded"
  | "quest_stage_change"
  | "location_change"
  | "affective_shift"
  | "player_code_switch"
  | "manual";

export interface DirectiveCacheOptions {
  blackboard: RuntimeBlackboard;
  now?: () => number;
}

export class DirectiveCache {
  private readonly blackboard: RuntimeBlackboard;
  private readonly now: () => number;
  private readonly cachedConversationIds = new Set<string>();
  private readonly unsubscribe: (() => void) | null;

  constructor(options: DirectiveCacheOptions) {
    this.blackboard = options.blackboard;
    this.now = options.now ?? (() => Date.now());
    this.unsubscribe = this.blackboard.subscribe((event) => {
      this.handleBlackboardEvent(event);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  get(conversationId: string): PedagogicalDirective | null {
    const scope = createActiveDirectiveFactScope(conversationId);
    const envelope = this.blackboard.getFact(ACTIVE_DIRECTIVE_FACT, scope);
    if (!envelope) {
      this.cachedConversationIds.delete(conversationId);
      return null;
    }

    const current = envelope.value;
    if (current.turnsConsumed >= current.lifetime.maxTurns) {
      this.invalidate(conversationId, "max_turns_exceeded");
      return null;
    }

    this.blackboard.setFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope,
      sourceSystem: SUGARLANG_DIRECTOR_WRITER,
      value: {
        ...current,
        turnsConsumed: current.turnsConsumed + 1
      },
      updatedAtMs: this.now()
    });
    this.cachedConversationIds.add(conversationId);

    return current.directive;
  }

  set(conversationId: string, directive: PedagogicalDirective, now = this.now()): void {
    this.blackboard.setFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope: createActiveDirectiveFactScope(conversationId),
      sourceSystem: SUGARLANG_DIRECTOR_WRITER,
      value: {
        directive,
        issuedAtMs: now,
        lifetime: directive.directiveLifetime,
        turnsConsumed: 0
      },
      updatedAtMs: now
    });
    this.cachedConversationIds.add(conversationId);
  }

  invalidate(conversationId: string, _reason: InvalidationReason): void {
    this.blackboard.clearFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope: createActiveDirectiveFactScope(conversationId),
      sourceSystem: SUGARLANG_DIRECTOR_WRITER
    });
    this.cachedConversationIds.delete(conversationId);
  }

  private invalidateAll(reason: InvalidationReason): void {
    for (const conversationId of [...this.cachedConversationIds]) {
      this.invalidate(conversationId, reason);
    }
  }

  private handleBlackboardEvent(event: BlackboardChangeEvent): void {
    if (event.key === QUEST_ACTIVE_STAGE_FACT.key) {
      this.invalidateAll("quest_stage_change");
      return;
    }
    if (event.key === ENTITY_LOCATION_FACT.key) {
      this.invalidateAll("location_change");
      return;
    }
    if (event.key === ENTITY_AFFECT_FACT.key) {
      this.invalidateAll("affective_shift");
    }
  }
}
