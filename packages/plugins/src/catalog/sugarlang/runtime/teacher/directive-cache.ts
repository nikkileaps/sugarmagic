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
  noteTurnFact,
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
  SUGARLANG_TEACHER_WRITER,
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

  /**
   * rf6.4.1: NO BLACKBOARD SUBSCRIPTION.
   *
   * This used to subscribe, filter to two fact keys, and then do nothing --
   * `// Intentionally no invalidation here.` So it held a live listener that
   * could not affect anything, and told every reader that blackboard events
   * drive cache lifetime. They do not.
   *
   * Invalidation happens on READ instead: `peek` compares the situation key and
   * the learner key per conversation, with a max-turns backstop. That is
   * strictly better than the events were -- the old subscription called
   * `invalidateAll`, dropping EVERY conversation's directive on ANY quest-stage
   * or location event while watching only those two facts, so it
   * over-invalidated and under-covered at the same time. The situation key
   * subsumes both: it carries scene, quest, stage, objective nodes and time of
   * day.
   *
   * `dispose()` went with it -- there was nothing left to dispose and no caller.
   */
  constructor(options: DirectiveCacheOptions) {
    this.blackboard = options.blackboard;
    this.now = options.now ?? (() => Date.now());
    this.telemetry = options.telemetry;
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
      noteTurnFact("teacherCache", "miss:situation_change");
      this.invalidate(conversationId, "situation_change");
      return null;
    }

    // The learner half. This is what closes the loop that already ran end to
    // end and had nobody listening: produce a word -> observe -> FSRS -> the
    // item's ItemProgress flips -> this key moves -> re-slate against what
    // they now know.
    if (
      keysNow?.learnerKey !== undefined &&
      current.learnerKey !== undefined &&
      current.learnerKey !== keysNow.learnerKey
    ) {
      noteTurnFact("teacherCache", "miss:learner_change");
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
    noteTurnFact("teacherCache", "hit");
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
      sourceSystem: SUGARLANG_TEACHER_WRITER,
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
      sourceSystem: SUGARLANG_TEACHER_WRITER,
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
      sourceSystem: SUGARLANG_TEACHER_WRITER
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


}
