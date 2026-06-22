import { describe, expect, it } from "vitest";
import { productModes } from "@sugarmagic/productmodes";
import { createRuntimeHarness } from "./runtime-harness";
import { createPublishHarness } from "./publish-harness";

describe("bootstrap verification", () => {
  it("resolves the shared runtime and shell packages together", () => {
    const harness = createRuntimeHarness();

    // Story 46.1 — Publish productmode lands at the end of the
    // canonical order alongside Design / Build / Render.
    expect(productModes.map((mode) => mode.id)).toEqual([
      "design",
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

  it("builds publish harness outputs from io contracts", () => {
    const publishHarness = createPublishHarness({
      rootPath: "/tmp/bootstrap-root",
      targetKind: "published-web"
    });

    expect(publishHarness.manifestPath).toBe(
      "/tmp/bootstrap-root/publish/manifest.json"
    );
  });
});
