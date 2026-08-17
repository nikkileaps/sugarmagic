/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/directive-cache.ts
 *
 * Purpose: Holds the Teacher's current pedagogical directive in memory, and
 *   says whether it still applies to the world and the learner right now.
 *
 * ONE ENTRY, SHARED BY EVERY NPC
 *   The entry is identified by the pair of keys it was planned against --
 *   the situation key and the learner key. Neither key has an NPC in it, so
 *   one directive is the right answer for every NPC in the region and there
 *   is one slot rather than one per conversation.
 *
 *   A cache value must be a function of its key. The keys carry no NPC, so
 *   nothing planned into the entry may depend on which NPC asked for it:
 *   every write is planned from the shared view of the situation, with no
 *   NPC, no recent turns and no per-conversation turn counts. `SugarLangTeacher`
 *   is the one place that strips those before planning.
 *
 *   REVISIT TRIGGER: if the Teacher is ever given the NPC's lore page or is
 *   otherwise made to plan differently per NPC, this entry stops being shared
 *   and gains an NPC axis -- which means one Teacher call per NPC per
 *   situation, and the cost question that a single region-wide call currently
 *   avoids comes back with it.
 *
 *   REVISIT TRIGGER: turns since the last comprehension probe are conversation
 *   state, so a shared entry cannot carry them and the probe floors that count
 *   turns do not apply when planning. The floor that ages pending lemmas still
 *   does. If `comprehension.probe-fired` telemetry shows probes drying up in
 *   play, probe pacing has to move out of plan time and into turn time.
 *
 * TWO AXES, CHECKED SEPARATELY
 *   A decision holds while the WORLD it was made for holds AND the LEARNER it
 *   was made for holds. Those move for unrelated reasons -- a quest advances,
 *   or a word finally lands -- so merging them into one key would make "the
 *   player learned something" indistinguishable from "the player walked
 *   somewhere". Situation is checked first, so a directive stale on both is
 *   reported as the world reason.
 *
 * A KEY THE ENTRY NEVER RECORDED CANNOT BE CHECKED
 *   Absent is not "matches". An entry written without a key falls through to
 *   the turn backstop rather than being assumed to still apply.
 *
 * Exports:
 *   - DirectiveCache
 *   - DirectiveKeys
 *   - DirectiveInspection
 *   - InvalidationReason
 *
 * Status: active
 */

import { noteTurnFact } from "@sugarmagic/runtime-core";
import type { DirectiveLifetime, PedagogicalDirective } from "../types";

export type InvalidationReason =
  | "max_turns_exceeded"
  | "situation_change"
  | "learner_change"
  | "quest_stage_change"
  | "location_change"
  | "player_code_switch"
  | "manual";

/** What a directive was planned against, and what it is checked against. */
export interface DirectiveKeys {
  situationKey?: string;
  learnerKey?: string;
}

/**
 * What is held, and whether it still applies.
 *
 * `peek` answers "is there a usable directive" by destroying the one that is
 * not, which is right for a caller about to re-plan and useless for one that
 * wants to serve the outgoing directive while a replacement is written. This
 * says what is there and why it is stale, and changes nothing.
 */
export interface DirectiveInspection {
  directive: PedagogicalDirective;
  /** null when the directive still applies to the keys it was asked about. */
  staleness: InvalidationReason | null;
  /** The keys this directive was planned against. */
  plannedFor: DirectiveKeys;
}

interface DirectiveEntry {
  directive: PedagogicalDirective;
  lifetime: DirectiveLifetime;
  turnsConsumed: number;
  keys: DirectiveKeys;
}

export class DirectiveCache {
  private entry: DirectiveEntry | null = null;
  private disposed = false;

  /**
   * Says what is held and whether it still applies, without changing anything
   * -- no invalidation, no turn facts, no ageing.
   *
   * This holds the staleness rules; `peek` is the destructive reading of the
   * same answer. One implementation, because two would drift and the whole
   * point of the two-axis check is that the axes stay distinguishable.
   */
  inspect(keysNow?: DirectiveKeys): DirectiveInspection | null {
    const entry = this.entry;
    if (!entry) {
      return null;
    }

    const inspection = (staleness: InvalidationReason | null): DirectiveInspection => ({
      directive: entry.directive,
      staleness,
      plannedFor: { ...entry.keys }
    });

    if (
      keysNow?.situationKey !== undefined &&
      entry.keys.situationKey !== undefined &&
      entry.keys.situationKey !== keysNow.situationKey
    ) {
      return inspection("situation_change");
    }

    // The learner half. This is what closes the loop that already runs end to
    // end: produce a word -> observe -> FSRS -> the item's ItemProgress flips
    // -> this key moves -> re-slate against what they now know.
    if (
      keysNow?.learnerKey !== undefined &&
      entry.keys.learnerKey !== undefined &&
      entry.keys.learnerKey !== keysNow.learnerKey
    ) {
      return inspection("learner_change");
    }

    // maxTurns is a BACKSTOP, not the policy. If the situation key is subtly
    // wrong and never moves, the Teacher silently stops running and the player
    // gets one directive forever -- no test fails, nothing logs. This bounds
    // that. Turns are counted across every NPC the entry serves, so the
    // backstop measures the entry's life rather than any one conversation's.
    if (entry.turnsConsumed >= entry.lifetime.maxTurns) {
      return inspection("max_turns_exceeded");
    }

    return inspection(null);
  }

  /** Reads the live directive WITHOUT ageing it. */
  peek(keysNow?: DirectiveKeys): PedagogicalDirective | null {
    const inspection = this.inspect(keysNow);
    if (!inspection) {
      return null;
    }

    if (inspection.staleness) {
      noteTurnFact("teacherCache", `miss:${inspection.staleness}`);
      this.invalidate();
      return null;
    }

    noteTurnFact("teacherCache", "hit");
    return inspection.directive;
  }

  /**
   * Ages the live directive by one turn. Split out of `get` so a caller that
   * served a STALE directive can still spend the turn it was used for.
   */
  spendTurn(): void {
    if (!this.entry) {
      return;
    }
    this.entry = {
      ...this.entry,
      turnsConsumed: this.entry.turnsConsumed + 1
    };
  }

  /** Reads the directive AND spends a turn on it. For the turn path only. */
  get(keysNow?: DirectiveKeys): PedagogicalDirective | null {
    const directive = this.peek(keysNow);
    if (!directive) {
      return null;
    }
    this.spendTurn();
    return directive;
  }

  /**
   * Writes the directive planned for these keys.
   *
   * A write after `dispose` is DROPPED. A Teacher call takes about ten seconds,
   * so one started before the region unloaded can land after everything it was
   * planned for is gone; the store is what stops that result from becoming the
   * next region's teaching.
   */
  set(directive: PedagogicalDirective, options: DirectiveKeys = {}): void {
    if (this.disposed) {
      return;
    }
    this.entry = {
      directive,
      lifetime: directive.directiveLifetime,
      turnsConsumed: 0,
      keys: {
        ...(options.situationKey === undefined
          ? {}
          : { situationKey: options.situationKey }),
        ...(options.learnerKey === undefined ? {} : { learnerKey: options.learnerKey })
      }
    };
  }

  invalidate(): void {
    this.entry = null;
  }

  /**
   * Drops what is held and refuses later writes, for a region unloading or a
   * session ending.
   */
  dispose(): void {
    this.disposed = true;
    this.entry = null;
  }
}
