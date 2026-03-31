import { describe, expect, it } from "vitest";
import { productModes } from "@sugarmagic/productmodes";
import { createRuntimeHarness } from "./runtime-harness";
import { createPublishHarness } from "./publish-harness";

describe("bootstrap verification", () => {
  it("resolves the shared runtime and shell packages together", () => {
    const harness = createRuntimeHarness();

    expect(productModes.map((mode) => mode.id)).toEqual([
      "design",
      "build",
      "render"
    ]);
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
