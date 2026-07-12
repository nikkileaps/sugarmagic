/**
 * Renderable load-completion decision tests.
 *
 * The authoring viewport judges every finished async glTF load with
 * this pure helper. The invariants under test shipped as bugs once
 * each: gating on a per-update generation counter discarded every
 * in-flight load during first scene load (nothing appeared until a
 * selection click), and checking only instanceId presence pinned a
 * stale model forever after a mid-flight representation swap.
 */

import { describe, expect, it } from "vitest";
import { resolveRenderableCompletion } from "@sugarmagic/studio";

describe("resolveRenderableCompletion", () => {
  it("adopts a load that is still wanted, across any amount of projection churn", () => {
    // Projection updates do NOT advance the generation -- only
    // teardown does. A load scheduled at gen 3 completing at gen 3
    // adopts no matter how many store ticks happened in between.
    expect(
      resolveRenderableCompletion({
        scheduledGeneration: 3,
        currentGeneration: 3,
        loadedRepresentationKey: "asset:lavender@1",
        desiredRepresentationKey: "asset:lavender@1"
      })
    ).toBe("adopt");
  });

  it("discards after a teardown generation bump", () => {
    expect(
      resolveRenderableCompletion({
        scheduledGeneration: 3,
        currentGeneration: 4,
        loadedRepresentationKey: "asset:lavender@1",
        desiredRepresentationKey: "asset:lavender@1"
      })
    ).toBe("discard");
  });

  it("discards when the instance is no longer in the desired set", () => {
    expect(
      resolveRenderableCompletion({
        scheduledGeneration: 3,
        currentGeneration: 3,
        loadedRepresentationKey: "asset:lavender@1",
        desiredRepresentationKey: null
      })
    ).toBe("discard");
  });

  it("reschedules when the representation changed while the load was in flight", () => {
    // The re-schedule at swap time was deduped by the pending guard;
    // completion must trigger it or the old model renders forever.
    expect(
      resolveRenderableCompletion({
        scheduledGeneration: 3,
        currentGeneration: 3,
        loadedRepresentationKey: "asset:lavender@1",
        desiredRepresentationKey: "asset:lavender@2"
      })
    ).toBe("reschedule");
  });
});
