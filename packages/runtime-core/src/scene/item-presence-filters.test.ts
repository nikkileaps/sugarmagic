/**
 * packages/runtime-core/src/scene/item-presence-filters.test.ts
 *
 * Purpose: Pins the semantics of the shared item-presence
 * filter helper. Runtime callers (visual mesh spawn in
 * target-web's runtimeHost, ECS Interactable spawn in
 * gameplay-session) both call this helper with a filters
 * object of identical shape. Any future filter added here
 * flows to both automatically.
 *
 * Implements: Plan 057 tests
 *
 * Status: active
 */

import { describe, expect, it, vi } from "vitest";
import type { RegionItemPresence } from "@sugarmagic/domain";
import { iterateActiveItemPresences } from "./item-presence-filters";

function makePresence(id: string): RegionItemPresence {
  return {
    presenceId: id,
    itemDefinitionId: `def:${id}`,
    quantity: 1,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    },
    shaderParameterOverrides: []
  };
}

describe("iterateActiveItemPresences", () => {
  it("invokes onEach for every presence when the filter matches nothing", () => {
    const presences = [
      makePresence("p1"),
      makePresence("p2"),
      makePresence("p3")
    ];
    const seen: string[] = [];
    iterateActiveItemPresences(
      presences,
      { shouldSkip: () => false },
      (presence) => {
        seen.push(presence.presenceId);
      }
    );
    expect(seen).toEqual(["p1", "p2", "p3"]);
  });

  it("skips presences for which shouldSkip returns true", () => {
    const presences = [
      makePresence("keep"),
      makePresence("drop"),
      makePresence("keep-2")
    ];
    const seen: string[] = [];
    iterateActiveItemPresences(
      presences,
      { shouldSkip: (id) => id === "drop" },
      (presence) => {
        seen.push(presence.presenceId);
      }
    );
    expect(seen).toEqual(["keep", "keep-2"]);
  });

  it("invokes onEach zero times when the filter matches every presence", () => {
    const onEach = vi.fn();
    iterateActiveItemPresences(
      [makePresence("a"), makePresence("b")],
      { shouldSkip: () => true },
      onEach
    );
    expect(onEach).not.toHaveBeenCalled();
  });

  it("iterates an empty presence list without invoking onEach", () => {
    const onEach = vi.fn();
    iterateActiveItemPresences([], { shouldSkip: () => false }, onEach);
    expect(onEach).not.toHaveBeenCalled();
  });

  it("preserves iteration order of the input array", () => {
    const presences = [
      makePresence("z"),
      makePresence("a"),
      makePresence("m")
    ];
    const seen: string[] = [];
    iterateActiveItemPresences(
      presences,
      { shouldSkip: () => false },
      (presence) => {
        seen.push(presence.presenceId);
      }
    );
    expect(seen).toEqual(["z", "a", "m"]);
  });

  it("passes the full presence object to onEach, not just the id", () => {
    const only = makePresence("only");
    let captured: RegionItemPresence | null = null;
    iterateActiveItemPresences(
      [only],
      { shouldSkip: () => false },
      (presence) => {
        captured = presence;
      }
    );
    expect(captured).toBe(only);
  });
});
