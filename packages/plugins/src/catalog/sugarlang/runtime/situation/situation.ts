/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/situation.ts
 *
 * Purpose: SITUATION -- what the Teacher is handed. The cached, scene-scoped
 *   half composed with the runtime facts only the live game knows.
 *
 * THE TWO HALVES
 *   `SceneContextModel` is compile-time and scene-scoped: what this scene's
 *   authored content is ABOUT, cached on a content hash and identical on every
 *   visit. It is NOT the situation, and treating it as one is the mistake this
 *   type exists to prevent -- it is why the same scene can teach differently on
 *   a second visit, and why a cached model alone cannot know what the player is
 *   in the middle of.
 *
 *     SceneContextModel        compile, cached on content hash
 *       + quest node, time of day, learned facts, recent events
 *       -----------------------------------------------------
 *     = SITUATION              what the Teacher reads
 *
 * WHAT IS DELIBERATELY ABSENT: WHO IS STANDING THERE
 *   Presence is NOT filtered (Plan 090.3, nikki's call). A `RegionNPCPresence`
 *   is a placement with an optional condition, so "has left the scene" and "is
 *   gated behind a world flag" are the same mechanism -- and the shared
 *   evaluator returns false for any flag clause when no flag predicate is
 *   supplied, which the plugin-visible runtime context does not have. Filtering
 *   would make an NPC who IS standing there vanish, silently. So a situation may
 *   name an NPC who has left; that is a known, accepted, and VISIBLE wrongness,
 *   chosen over an invisible one.
 *
 * EVERY RUNTIME FIELD IS A `RuntimeFact`
 *   Not `T | undefined`. See ./runtime-fact -- the blackboard guarantees
 *   nothing, and "no facts learned" must never render the same as "we could not
 *   read what the player has learned".
 *
 * Exports:
 *   - Situation, SituationRuntimeFacts
 *
 * Relationships:
 *   - Composed by ./compose from a SceneContextModel and a
 *     ConversationRuntimeContext.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import type {
  QuestActiveObjectivesFact,
  QuestActiveStageFact,
  TrackedQuestFact
} from "@sugarmagic/runtime-core";
import type { SceneContextModel } from "../contracts/scene-context";
import type { RuntimeFact } from "./runtime-fact";

/**
 * NPC slice passed into the teacher prompt builder and policy.
 *
 * 090.4: moved here from contracts/providers.ts -- who the Teacher is talking
 * to is situation content, one of the two doors, not a third TeacherContext
 * field.
 *
 * Implements: Proposal 001 §3. Teacher
 */
export interface TeacherNpcContext {
  npcDefinitionId: string | null;
  displayName: string | null;
  lorePageId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Recent turn summary passed into the teacher for conversational continuity.
 *
 * 090.4: moved here from contracts/providers.ts, same reason as
 * `TeacherNpcContext`.
 *
 * Implements: Proposal 001 §3. Teacher
 */
export interface TeacherRecentTurn {
  turnId: string;
  speaker: "player" | "npc";
  text: string;
  lang?: string;
}

/** An NPC-less, turn-less default -- composeSituation's shape with no conversation. */
export const EMPTY_NPC_CONTEXT: TeacherNpcContext = {
  npcDefinitionId: null,
  displayName: null,
  lorePageId: null
};

/**
 * The live half. Each field is independently unavailable -- they come from
 * different writers and go missing independently, so one absent field must
 * never invalidate the rest of the situation.
 */
export interface SituationRuntimeFacts {
  /** The current quest node -- objectives the player is working on now. */
  questObjectives: RuntimeFact<QuestActiveObjectivesFact>;
  questStage: RuntimeFact<QuestActiveStageFact>;
  trackedQuest: RuntimeFact<TrackedQuestFact>;
  /** World-clock band. */
  timeOfDay: RuntimeFact<string>;
  /**
   * Display texts of facts the player has LEARNED this session.
   *
   * An empty array is meaningful and different from unavailable: it says the
   * player has learned nothing yet, which the Teacher may act on. Unavailable
   * says we could not read it, which it may not.
   */
  knownFacts: RuntimeFact<string[]>;
  /** Human-readable recent world events, capped upstream at 10. */
  recentWorldEvents: RuntimeFact<string[]>;
}

export interface Situation {
  sceneId: string;
  /**
   * The compile half. Unavailable when the scene was never built, or was edited
   * since the last build so its content hash no longer matches -- both normal,
   * neither an error. A situation with no scene context is still a situation:
   * the runtime half alone is worth handing to the Teacher.
   */
  sceneContext: RuntimeFact<SceneContextModel>;
  runtime: SituationRuntimeFacts;
  /**
   * 090.4: who the Teacher is talking to, if there is a conversation at all.
   * Absent when composed with no conversation (e.g. an item view reading a
   * situation via the slate store, per 090.3c). NOT part of `situationKey` --
   * a different NPC delivering the same scene content is not a different
   * teaching situation.
   */
  npc?: TeacherNpcContext;
  /**
   * 090.4: recent turns, for conversational continuity in the prompt.
   * Deliberately excluded from `situationKey`, the same treatment as
   * `runtime.knownFacts` / `runtime.recentWorldEvents` -- it changes every
   * turn and reaches the Teacher through the prompt without invalidating a
   * decision that is still correct.
   */
  recentTurns?: TeacherRecentTurn[];
  /**
   * 090.4: turns elapsed in THIS conversation since the last comprehension
   * probe. Conversation state, read off the execution -- not learner state and
   * not on the profile -- so it rides here beside `recentTurns` rather than
   * being carried as a fourth argument everywhere.
   *
   * It is the one non-learner input to the probe-floor signals
   * (learner/pacing-signals.ts). Absent reads as 0, matching
   * `getTurnsSinceLastProbe`'s own default for an execution that has never
   * probed. Excluded from `situationKey` for the same reason `recentTurns` is:
   * it moves every turn and must not re-slate on its own.
   */
  turnsSinceLastProbe?: number;
}
