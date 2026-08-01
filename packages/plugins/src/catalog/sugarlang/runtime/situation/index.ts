/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/index.ts
 *
 * Purpose: The situation module's public surface.
 *
 * The SITUATION is what the Teacher reads: the cached scene-scoped half
 * (`SceneContextModel`) composed with the runtime facts only the live game
 * knows. Everything outside this directory imports from here.
 *
 * Exports: the Situation types, the composer, and the RuntimeFact helpers
 *   callers need in order to render a fact without collapsing empty into
 *   missing.
 *
 * Relationships:
 *   - Depends on `runtime/contracts/scene-context` and runtime-core's
 *     conversation + blackboard fact types. Never on another plugin.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

export type {
  Situation,
  SituationRuntimeFacts,
  TeacherNpcContext,
  TeacherRecentTurn
} from "./situation";
export { EMPTY_NPC_CONTEXT } from "./situation";
export { composeSituation } from "./compose";
export type { ComposeSituationInput } from "./compose";
export { situationKey } from "./situation-key";
export type { Slate, SlateAction, SlateItem } from "./slate";
export { factValue, isAvailable, runtimeFact, unavailable } from "./runtime-fact";
export type { RuntimeFact } from "./runtime-fact";
