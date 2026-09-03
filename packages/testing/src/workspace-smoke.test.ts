import { describe, expect, it } from "vitest";
import { productModes } from "@sugarmagic/productmodes";
import { createRuntimeHarness } from "./runtime-harness";

describe("bootstrap verification", () => {
  it("resolves the shared runtime and shell packages together", () => {
    const harness = createRuntimeHarness();

    // Canonical order: definitions, then the story built from them,
    // then the places it happens, then rendering and publishing.
    // Story mode arrived with epic #226.
    expect(productModes.map((mode) => mode.id)).toEqual([
      "design",
      "story",
      "build",
      "render",
      "publish"
    ]);
    expect(productModes.find((mode) => mode.id === "publish")).toMatchObject({
      id: "publish",
      label: "Publish",
      workspaceKinds: ["package"]
    });
    expect(harness.adapter.boot.runtimeFamily).toBe("sugarmagic-shared-runtime");
    expect(harness.shellModel.workspaceHost.workspaceKind).toBe("RegionWorkspace");
    expect(harness.shellStore.getState().activeWorkspaceId).toBe(
      "build:region:bootstrap"
    );
  });

});
