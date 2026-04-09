/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/fact-definitions.ts
 *
 * Purpose: Reserves the Blackboard fact definitions owned by sugarlang learner state.
 *
 * Exports:
 *   - SugarlangPlacementStatus
 *   - LEARNER_PROFILE_FACT
 *   - SUGARLANG_PLACEMENT_STATUS_FACT
 *   - LEMMA_OBSERVATION_FACT
 *   - ACTIVE_DIRECTIVE_FACT
 *
 * Relationships:
 *   - Depends on runtime-core blackboard fact-definition types and sugarlang contracts.
 *   - Will be consumed by learner state, director caching, and middleware work in later epics.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / §Cold Start Sequence / §End-to-End Turn Flow
 *
 * Status: skeleton (no implementation yet; see Epic 7)
 */

import type { BlackboardFactDefinition } from "@sugarmagic/runtime-core";
import type {
  LearnerProfile,
  LemmaObservation,
  PedagogicalDirective
} from "../types";

export interface SugarlangPlacementStatus {
  status: "not-started" | "in-progress" | "completed";
  cefrBand?: string;
  confidence?: number;
  completedAt?: number;
}

export const LEARNER_PROFILE_FACT: BlackboardFactDefinition<LearnerProfile> = {
  key: "sugarlang.learner-profile",
  ownerSystem: "sugarlang",
  allowedScopeKinds: ["global"],
  lifecycle: { kind: "session" }
};

export const SUGARLANG_PLACEMENT_STATUS_FACT:
  BlackboardFactDefinition<SugarlangPlacementStatus> = {
    key: "sugarlang.placement-status",
    ownerSystem: "sugarlang",
    allowedScopeKinds: ["global"],
    lifecycle: { kind: "session" }
  };

export const LEMMA_OBSERVATION_FACT: BlackboardFactDefinition<LemmaObservation[]> = {
  key: "sugarlang.lemma-observation",
  ownerSystem: "sugarlang",
  allowedScopeKinds: ["conversation"],
  lifecycle: { kind: "frame" }
};

export const ACTIVE_DIRECTIVE_FACT:
  BlackboardFactDefinition<PedagogicalDirective | null> = {
    key: "sugarlang.active-directive",
    ownerSystem: "sugarlang",
    allowedScopeKinds: ["conversation"],
    lifecycle: { kind: "session" }
  };
