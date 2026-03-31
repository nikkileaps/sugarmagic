import { createBrowserRuntimeAdapter } from "@sugarmagic/runtime-web";
import { createShellModel, createShellStore } from "@sugarmagic/shell";
import { bootstrapFixtureIds } from "../fixtures";

export function createRuntimeHarness() {
  const shellStore = createShellStore("build");

  shellStore.getState().setActiveWorkspace(bootstrapFixtureIds.workspaceId);

  return {
    shellStore,
    shellModel: createShellModel({
      title: "Sugarmagic Harness",
      workspaceId: bootstrapFixtureIds.workspaceId,
      workspaceKind: "RegionWorkspace",
      subjectId: bootstrapFixtureIds.regionId,
      productModeId: "build"
    }),
    adapter: createBrowserRuntimeAdapter({
      hostKind: "studio",
      compileProfile: "authoring-preview",
      contentSource: "authored-game-root"
    })
  };
}
