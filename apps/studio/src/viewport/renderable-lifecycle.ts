/**
 * Pure decision logic for async renderable load completion.
 *
 * Extracted from the authoring viewport's load callback so the
 * invariant is unit-testable (the surrounding .then() mutates the
 * THREE scene graph and can't run under vitest/node).
 *
 * The invariant (see docs/api, /apps/studio): a finished load is
 * judged against the CURRENT desired scene set -- both that the
 * instanceId is still wanted AND that the loaded representation still
 * matches. It must never be gated on a per-update generation counter:
 * projection emits happen on any store tick, so a counter bump per
 * update silently discarded every in-flight load during first scene
 * load. The generation only advances on teardown (unmount / region
 * cleared), when every in-flight load must be discarded.
 */

export type RenderableCompletionDecision = "adopt" | "discard" | "reschedule";

export function resolveRenderableCompletion(input: {
  scheduledGeneration: number;
  currentGeneration: number;
  loadedRepresentationKey: string;
  desiredRepresentationKey: string | null;
}): RenderableCompletionDecision {
  if (input.scheduledGeneration !== input.currentGeneration) {
    return "discard";
  }
  if (input.desiredRepresentationKey === null) {
    return "discard";
  }
  // The object changed representation (model swap) while this load
  // was in flight; the re-schedule at that moment was deduped away by
  // the pending guard, so completion must trigger it or the stale
  // model would render forever.
  if (input.desiredRepresentationKey !== input.loadedRepresentationKey) {
    return "reschedule";
  }
  return "adopt";
}
