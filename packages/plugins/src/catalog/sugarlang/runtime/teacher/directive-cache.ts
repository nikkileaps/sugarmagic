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
  ENTITY_LOCATION_FACT,
  QUEST_ACTIVE_STAGE_FACT,
  type BlackboardChangeEvent,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type { PedagogicalDirective } from "../types";
import {
  createTelemetryEvent,
  emitTelemetry,
  type TelemetrySink
} from "../telemetry/telemetry";
import {
  ACTIVE_DIRECTIVE_FACT,
  SUGARLANG_DIRECTOR_WRITER,
  createActiveDirectiveFactScope
} from "../learner";

export type InvalidationReason =
  | "max_turns_exceeded"
  | "situation_change"
  | "learner_change"
  | "quest_stage_change"
  | "location_change"
  | "player_code_switch"
  | "manual";

export interface DirectiveCacheOptions {
  blackboard: RuntimeBlackboard;
  now?: () => number;
  telemetry?: TelemetrySink;
}

export class DirectiveCache {
  private readonly blackboard: RuntimeBlackboard;
  private readonly now: () => number;
  private readonly telemetry: TelemetrySink | undefined;
  private readonly cachedConversationIds = new Set<string>();
  private readonly unsubscribe: (() => void) | null;

  constructor(options: DirectiveCacheOptions) {
    this.blackboard = options.blackboard;
    this.now = options.now ?? (() => Date.now());
    this.telemetry = options.telemetry;
    this.unsubscribe = this.blackboard.subscribe((event) => {
      this.handleBlackboardEvent(event);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  /**
   * Reads the live directive WITHOUT ageing it.
   *
   * 090.3b split this out of `get`. `turnsConsumed` used to be incremented
   * inside the read, so merely LOOKING at the directive spent a turn the player
   * never took -- fine while exactly one caller existed, a trap the moment a
   * debug readout or an inspector wanted to display it. Anything that is not
   * taking a turn must call this.
   */
  peek(
    conversationId: string,
    keysNow?: { situationKey?: string; learnerKey?: string }
  ): PedagogicalDirective | null {
    const envelope = this.blackboard.getFact(
      ACTIVE_DIRECTIVE_FACT,
      createActiveDirectiveFactScope(conversationId)
    );
    if (!envelope) {
      this.cachedConversationIds.delete(conversationId);
      return null;
    }

    const current = envelope.value;

    // TWO AXES, CHECKED SEPARATELY (090.4).
    //
    // A decision is valid while the WORLD it was made for still holds AND the
    // LEARNER it was made for still holds. Those change for entirely unrelated
    // reasons -- a quest advances, or a word finally lands -- and merging them
    // into one key would make "the player learned something" indistinguishable
    // from "the player walked somewhere".
    if (
      keysNow?.situationKey !== undefined &&
      current.situationKey !== undefined &&
      current.situationKey !== keysNow.situationKey
    ) {
      this.invalidate(conversationId, "situation_change");
      return null;
    }

    // The learner half. This is what closes the loop that already ran end to
    // end and had nobody listening: produce a word -> observe -> FSRS -> the
    // item's LearningStatus flips -> this key moves -> re-slate against what
    // they now know.
    if (
      keysNow?.learnerKey !== undefined &&
      current.learnerKey !== undefined &&
      current.learnerKey !== keysNow.learnerKey
    ) {
      this.invalidate(conversationId, "learner_change");
      return null;
    }

    // maxTurns survives as a BACKSTOP, not as the policy. If the situation key
    // is subtly wrong and never moves, the Teacher silently stops running and
    // the player gets one directive forever -- no test fails, nothing logs. This
    // bounds that. It is deliberately long; see the lifetime default.
    if (current.turnsConsumed >= current.lifetime.maxTurns) {
      this.invalidate(conversationId, "max_turns_exceeded");
      return null;
    }

    this.cachedConversationIds.add(conversationId);
    return current.directive;
  }

  /**
   * Reads the directive AND spends a turn on it. For the turn path only.
   */
  get(
    conversationId: string,
    keysNow?: { situationKey?: string; learnerKey?: string }
  ): PedagogicalDirective | null {
    const directive = this.peek(conversationId, keysNow);
    if (!directive) {
      return null;
    }

    const scope = createActiveDirectiveFactScope(conversationId);
    const envelope = this.blackboard.getFact(ACTIVE_DIRECTIVE_FACT, scope);
    if (!envelope) {
      return directive;
    }

    this.blackboard.setFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope,
      sourceSystem: SUGARLANG_DIRECTOR_WRITER,
      value: {
        ...envelope.value,
        turnsConsumed: envelope.value.turnsConsumed + 1
      },
      updatedAtMs: this.now()
    });

    return directive;
  }

  set(
    conversationId: string,
    directive: PedagogicalDirective,
    options: { situationKey?: string; learnerKey?: string; now?: number } = {}
  ): void {
    const now = options.now ?? this.now();
    this.blackboard.setFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope: createActiveDirectiveFactScope(conversationId),
      sourceSystem: SUGARLANG_DIRECTOR_WRITER,
      value: {
        directive,
        issuedAtMs: now,
        lifetime: directive.directiveLifetime,
        turnsConsumed: 0,
        ...(options.situationKey === undefined
          ? {}
          : { situationKey: options.situationKey }),
        ...(options.learnerKey === undefined
          ? {}
          : { learnerKey: options.learnerKey })
      },
      updatedAtMs: now
    });
    this.cachedConversationIds.add(conversationId);
  }

  invalidate(conversationId: string, reason: InvalidationReason): void {
    this.blackboard.clearFact({
      definition: ACTIVE_DIRECTIVE_FACT,
      scope: createActiveDirectiveFactScope(conversationId),
      sourceSystem: SUGARLANG_DIRECTOR_WRITER
    });
    this.cachedConversationIds.delete(conversationId);
    if (this.telemetry) {
      void emitTelemetry(
        this.telemetry,
        createTelemetryEvent("directive-cache.invalidated", {
          timestamp: this.now(),
          conversationId,
          reason
        })
      );
    }
  }

  private invalidateAll(reason: InvalidationReason): void {
    for (const conversationId of [...this.cachedConversationIds]) {
      this.invalidate(conversationId, reason);
    }
  }

  /**
   * 090.3b: these events no longer invalidate anything by themselves.
   *
   * They used to call `invalidateAll`, dropping EVERY conversation's directive
   * on ANY quest-stage or location event, comparing nothing -- so it
   * over-invalidated (an unrelated quest advancing elsewhere retired a perfectly
   * good decision) while also under-covering, since only these two facts were
   * watched and nothing re-slated on a time-of-day change.
   *
   * The situation key subsumes both: it contains scene, quest, stage, objective
   * nodes and time of day, and is compared per conversation at read time. A
   * subscription is kept only so the cache still learns when the blackboard
   * moves; deciding is `peek`'s job now.
   */
  private handleBlackboardEvent(event: BlackboardChangeEvent): void {
    if (
      event.key !== QUEST_ACTIVE_STAGE_FACT.key &&
      event.key !== ENTITY_LOCATION_FACT.key
    ) {
      return;
    }
    // Intentionally no invalidation here.
  }
}
