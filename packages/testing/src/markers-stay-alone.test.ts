import { describe, expect, it } from "vitest";
import { markersStayAlone } from "@sugarmagic/workspaces";
import type { SceneObject } from "@sugarmagic/runtime-core";

/** A region where anything named spawn* is a marker and the rest are assets. */
const kindOf = (instanceId: string): SceneObject["kind"] | null =>
  instanceId.startsWith("spawn") ? "marker" : "asset";

describe("markers stay alone in a selection", () => {
  it("lets two ordinary objects toggle together", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "prop_b" },
        ["prop_a"],
        kindOf
      )
    ).toEqual({ kind: "toggle", instanceId: "prop_b" });
  });

  it("lets an ordinary object join a larger selection", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "prop_c" },
        ["prop_a", "prop_b"],
        kindOf
      )
    ).toEqual({ kind: "toggle", instanceId: "prop_c" });
  });

  it("replaces rather than extends when the clicked object is a marker", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "spawn_1" },
        ["prop_a"],
        kindOf
      )
    ).toEqual({ kind: "replace", instanceId: "spawn_1" });
  });

  it("replaces rather than extends when a marker is already selected", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "prop_a" },
        ["spawn_1"],
        kindOf
      )
    ).toEqual({ kind: "replace", instanceId: "prop_a" });
  });

  it("replaces when a marker sits anywhere in the selection", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "prop_c" },
        ["prop_a", "spawn_1", "prop_b"],
        kindOf
      )
    ).toEqual({ kind: "replace", instanceId: "prop_c" });
  });

  it("still selects a marker on its own", () => {
    expect(
      markersStayAlone({ kind: "replace", instanceId: "spawn_1" }, [], kindOf)
    ).toEqual({ kind: "replace", instanceId: "spawn_1" });
  });

  it("leaves a clear alone whatever is selected", () => {
    expect(markersStayAlone({ kind: "clear" }, ["spawn_1"], kindOf)).toEqual({
      kind: "clear"
    });
  });

  it("treats an object it cannot resolve as not a marker", () => {
    expect(
      markersStayAlone(
        { kind: "toggle", instanceId: "prop_b" },
        ["gone"],
        () => null
      )
    ).toEqual({ kind: "toggle", instanceId: "prop_b" });
  });
});
