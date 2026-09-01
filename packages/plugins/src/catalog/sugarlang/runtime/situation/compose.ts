/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/compose.ts
 *
 * Purpose: Builds a Situation from the compile half and whatever the runtime
 *   can currently tell us.
 *
 * TOTAL BY CONSTRUCTION
 *   `composeSituation` cannot fail. Every input is optional, every absent input
 *   produces an unavailable fact, and a call with NOTHING but a regionId returns
 *   a valid situation in which every field says "unavailable". That is a
 *   deliberate design constraint rather than defensive habit: the blackboard is
 *   raw untyped state and any field can be missing for reasons this module
 *   cannot see or fix, so treating absence as an error would make the Teacher
 *   unreachable whenever the world was mid-transition.
 *
 * IT DOES NOT REACH FOR ANYTHING
 *   The runtime context arrives ON the execution object the middleware is handed
 *   (runtime-core `ConversationExecution.runtimeContext`). This module reads what
 *   it is given and never imports another plugin -- there is no sugaragent
 *   dependency here, and there must not be one.
 *
 * Exports:
 *   - composeSituation, ComposeSituationInput
 *
 * Relationships:
 *   - Pure. No I/O, no store, no clock.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import type { ConversationRuntimeContext } from "@sugarmagic/runtime-core";
import type { SceneContextModel } from "../contracts/scene-context";
import { runtimeFact, unavailable } from "./runtime-fact";
import type {
  Situation,
  SituationRuntimeFacts,
  TeacherNpcContext,
  TeacherRecentTurn
} from "./situation";

export interface ComposeSituationInput {
  regionId: string;
  /** The built + seeded model, when the scene has one. */
  sceneContext?: SceneContextModel | null | undefined;
  /** Whatever the middleware was handed. Absent is legal. */
  runtimeContext?: ConversationRuntimeContext | null | undefined;
  /** 090.4: who the Teacher is talking to. Absent when there is no conversation. */
  npc?: TeacherNpcContext | null | undefined;
  /** 090.4: recent turns for conversational continuity. Absent is legal. */
  recentTurns?: TeacherRecentTurn[] | null | undefined;
  /** 090.4: conversation turns since the last comprehension probe. Absent reads as 0. */
  turnsSinceLastProbe?: number | null | undefined;
}

/** Every runtime fact unavailable -- the shape a situation takes with no live context. */
function noRuntimeFacts(): SituationRuntimeFacts {
  return {
    questObjectives: unavailable(),
    questStage: unavailable(),
    trackedQuest: unavailable(),
    timeOfDay: unavailable(),
    knownFacts: unavailable(),
    recentWorldEvents: unavailable()
  };
}

function readRuntimeFacts(
  context: ConversationRuntimeContext
): SituationRuntimeFacts {
  return {
    questObjectives: runtimeFact(context.activeQuestObjectives),
    questStage: runtimeFact(context.activeQuestStage),
    trackedQuest: runtimeFact(context.trackedQuest),
    timeOfDay: runtimeFact(context.timeOfDay),
    // NOTE: no `?? []` anywhere in this function, deliberately. An empty array
    // that arrives IS available and means "nothing learned yet"; a missing one
    // is not. Defaulting here is precisely the collapse RuntimeFact exists to
    // make impossible.
    knownFacts: runtimeFact(context.knownFacts),
    recentWorldEvents: runtimeFact(context.recentWorldEvents)
  };
}

export function composeSituation(input: ComposeSituationInput): Situation {
  return {
    regionId: input.regionId,
    sceneContext: runtimeFact(input.sceneContext),
    runtime: input.runtimeContext
      ? readRuntimeFacts(input.runtimeContext)
      : noRuntimeFacts(),
    ...(input.npc ? { npc: input.npc } : {}),
    ...(input.recentTurns ? { recentTurns: input.recentTurns } : {}),
    ...(input.turnsSinceLastProbe == null
      ? {}
      : { turnsSinceLastProbe: input.turnsSinceLastProbe })
  };
}
