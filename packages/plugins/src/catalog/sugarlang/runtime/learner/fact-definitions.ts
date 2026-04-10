/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/fact-definitions.ts
 *
 * Purpose: Declares the blackboard facts owned by sugarlang learner state and directive state.
 *
 * Exports:
 *   - SUGARLANG_LEARNER_STATE_WRITER
 *   - SUGARLANG_PLACEMENT_WRITER
 *   - SUGARLANG_DIRECTOR_WRITER
 *   - SUGARLANG_OBSERVER_WRITER
 *   - SugarlangPlacementStatus
 *   - ActiveDirectiveFactValue
 *   - DEFAULT_SUGARLANG_PLACEMENT_STATUS
 *   - LEARNER_PROFILE_FACT
 *   - SUGARLANG_PLACEMENT_STATUS_FACT
 *   - LEMMA_OBSERVATION_FACT
 *   - ACTIVE_DIRECTIVE_FACT
 *   - SUGARLANG_BLACKBOARD_FACT_DEFINITIONS
 *   - createLearnerProfileFactScope
 *   - createSugarlangPlacementStatusScope
 *   - createActiveDirectiveFactScope
 *   - createLemmaObservationFactScope
 *   - getSugarlangPlacementStatus
 *
 * Relationships:
 *   - Depends on runtime-core blackboard definitions plus sugarlang contracts.
 *   - Is consumed by runtime blackboard creation, the learner reducer, and the read-side learner store.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §Cold Start Sequence / §End-to-End Turn Flow
 *
 * Status: active
 */

import {
  createBlackboardScope,
  defineBlackboardFact,
  type BlackboardFactDefinition,
  type BlackboardScopeRef,
  type RuntimeBlackboard
} from "@sugarmagic/runtime-core";
import type {
  CEFRBand,
  LearnerProfile,
  LemmaObservation,
  PedagogicalDirective
} from "../types";
import type { DirectiveLifetime } from "../types";

export const SUGARLANG_LEARNER_STATE_WRITER = "sugarlang.learner-state";
export const SUGARLANG_PLACEMENT_WRITER = "sugarlang.placement";
export const SUGARLANG_DIRECTOR_WRITER = "sugarlang.directive";
export const SUGARLANG_OBSERVER_WRITER = "sugarlang.observer";

export interface SugarlangPlacementStatus {
  status: "not-started" | "in-progress" | "completed";
  cefrBand?: CEFRBand;
  confidence?: number;
  completedAt?: number;
}

export interface ActiveDirectiveFactValue {
  directive: PedagogicalDirective;
  issuedAtMs: number;
  lifetime: DirectiveLifetime;
  turnsConsumed: number;
}

export const DEFAULT_SUGARLANG_PLACEMENT_STATUS: SugarlangPlacementStatus = {
  status: "not-started"
};

export const LEARNER_PROFILE_FACT: BlackboardFactDefinition<LearnerProfile> =
  defineBlackboardFact({
    key: "sugarlang.learner-profile",
    ownerSystem: SUGARLANG_LEARNER_STATE_WRITER,
    allowedScopeKinds: ["entity"],
    lifecycle: { kind: "persistent" }
  });

export const SUGARLANG_PLACEMENT_STATUS_FACT:
  BlackboardFactDefinition<SugarlangPlacementStatus> = defineBlackboardFact({
    key: "sugarlang.placement-status",
    ownerSystem: SUGARLANG_PLACEMENT_WRITER,
    allowedScopeKinds: ["global"],
    lifecycle: { kind: "persistent" }
  });

export const LEMMA_OBSERVATION_FACT: BlackboardFactDefinition<LemmaObservation[]> =
  defineBlackboardFact({
    key: "sugarlang.lemma-observation",
    ownerSystem: SUGARLANG_OBSERVER_WRITER,
    allowedScopeKinds: ["conversation"],
    lifecycle: { kind: "frame" }
  });

export const ACTIVE_DIRECTIVE_FACT: BlackboardFactDefinition<ActiveDirectiveFactValue> =
  defineBlackboardFact({
    key: "sugarlang.active-directive",
    ownerSystem: SUGARLANG_DIRECTOR_WRITER,
    allowedScopeKinds: ["conversation"],
    lifecycle: { kind: "session" }
  });

export const SUGARLANG_BLACKBOARD_FACT_DEFINITIONS = [
  LEARNER_PROFILE_FACT,
  SUGARLANG_PLACEMENT_STATUS_FACT,
  LEMMA_OBSERVATION_FACT,
  ACTIVE_DIRECTIVE_FACT
] as const satisfies readonly BlackboardFactDefinition<unknown>[];

export function createLearnerProfileFactScope(playerEntityId: string): BlackboardScopeRef {
  return createBlackboardScope("entity", playerEntityId);
}

export function createSugarlangPlacementStatusScope(profileId: string): BlackboardScopeRef {
  return createBlackboardScope("global", profileId);
}

export function createActiveDirectiveFactScope(conversationId: string): BlackboardScopeRef {
  return createBlackboardScope("conversation", conversationId);
}

export function createLemmaObservationFactScope(conversationId: string): BlackboardScopeRef {
  return createBlackboardScope("conversation", conversationId);
}

export function getSugarlangPlacementStatus(
  blackboard: RuntimeBlackboard,
  profileId: string
): SugarlangPlacementStatus {
  return (
    blackboard.getFact(
      SUGARLANG_PLACEMENT_STATUS_FACT,
      createSugarlangPlacementStatusScope(profileId)
    )?.value ?? DEFAULT_SUGARLANG_PLACEMENT_STATUS
  );
}
