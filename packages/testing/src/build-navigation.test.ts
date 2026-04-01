import { describe, expect, it } from "vitest";
import {
  createShellStore,
  deriveBuildWorkspaceId
} from "@sugarmagic/shell";

describe("Build navigation model", () => {
  it("derives workspace ID from kind and region", () => {
    expect(deriveBuildWorkspaceId("layout", "forest_north")).toBe(
      "build:layout:forest_north"
    );
    expect(deriveBuildWorkspaceId("environment", "forest_north")).toBe(
      "build:environment:forest_north"
    );
    expect(deriveBuildWorkspaceId("assets", "cave_01")).toBe(
      "build:assets:cave_01"
    );
  });

  it("returns null when no region is selected", () => {
    expect(deriveBuildWorkspaceId("layout", null)).toBeNull();
  });

  it("changing workspace kind preserves region and updates workspace ID", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");

    expect(store.getState().activeWorkspaceId).toBe("build:layout:forest_north");

    store.getState().setActiveBuildWorkspaceKind("environment");
    expect(store.getState().activeBuildWorkspaceKind).toBe("environment");
    expect(store.getState().activeRegionId).toBe("forest_north");
    expect(store.getState().activeWorkspaceId).toBe("build:environment:forest_north");
  });

  it("changing region preserves workspace kind and updates workspace ID", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setActiveBuildWorkspaceKind("assets");

    store.getState().setActiveRegionId("cave_01");
    expect(store.getState().activeBuildWorkspaceKind).toBe("assets");
    expect(store.getState().activeRegionId).toBe("cave_01");
    expect(store.getState().activeWorkspaceId).toBe("build:assets:cave_01");
  });

  it("clears selection and tool session on workspace kind change", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setSelection(["obj-1", "obj-2"]);

    store.getState().setActiveBuildWorkspaceKind("environment");
    expect(store.getState().selection.entityIds).toEqual([]);
    expect(store.getState().toolSession.isActive).toBe(false);
  });

  it("clears selection and tool session on region change", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setSelection(["obj-1"]);

    store.getState().setActiveRegionId("cave_01");
    expect(store.getState().selection.entityIds).toEqual([]);
  });

  it("defaults to layout workspace kind", () => {
    const store = createShellStore("build");
    expect(store.getState().activeBuildWorkspaceKind).toBe("layout");
  });
});
