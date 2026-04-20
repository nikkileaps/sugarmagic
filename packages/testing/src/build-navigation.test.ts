import { describe, expect, it } from "vitest";
import {
  createShellStore,
  deriveBuildWorkspaceId,
  deriveDesignWorkspaceId
} from "@sugarmagic/shell";

describe("Build navigation model", () => {
  it("derives workspace ID from workspace context", () => {
    expect(deriveBuildWorkspaceId("layout", "forest_north")).toBe(
      "build:layout:forest_north"
    );
    expect(deriveBuildWorkspaceId("landscape", "forest_north")).toBe(
      "build:landscape:forest_north"
    );
    expect(deriveBuildWorkspaceId("spatial", "forest_north")).toBe(
      "build:spatial:forest_north"
    );
    expect(deriveBuildWorkspaceId("behavior", "forest_north")).toBe(
      "build:behavior:forest_north"
    );
    expect(deriveBuildWorkspaceId("environment", "env_default")).toBe(
      "build:environment:env_default"
    );
    expect(deriveBuildWorkspaceId("materials", "ignored")).toBe(
      "build:materials:library"
    );
    expect(deriveBuildWorkspaceId("assets", "cave_01")).toBe(
      "build:assets:cave_01"
    );
  });

  it("returns null when no workspace context is selected", () => {
    expect(deriveBuildWorkspaceId("layout", null)).toBeNull();
  });

  it("derives design workspace IDs without region context", () => {
    expect(deriveDesignWorkspaceId("player")).toBe("design:player");
    expect(deriveDesignWorkspaceId("npcs")).toBe("design:npcs");
    expect(deriveDesignWorkspaceId("dialogues")).toBe("design:dialogues");
  });

  it("changing to environment workspace uses environment context, not region context", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setActiveEnvironmentId("env_default");

    expect(store.getState().activeWorkspaceId).toBe("build:layout:forest_north");

    store.getState().setActiveBuildWorkspaceKind("environment");
    expect(store.getState().activeBuildWorkspaceKind).toBe("environment");
    expect(store.getState().activeRegionId).toBe("forest_north");
    expect(store.getState().activeEnvironmentId).toBe("env_default");
    expect(store.getState().activeWorkspaceId).toBe("build:environment:env_default");
  });

  it("changing environment preserves workspace kind and updates workspace ID", () => {
    const store = createShellStore("build");
    store.getState().setActiveEnvironmentId("env_default");
    store.getState().setActiveBuildWorkspaceKind("environment");

    store.getState().setActiveEnvironmentId("env_night");
    expect(store.getState().activeBuildWorkspaceKind).toBe("environment");
    expect(store.getState().activeEnvironmentId).toBe("env_night");
    expect(store.getState().activeWorkspaceId).toBe("build:environment:env_night");
  });

  it("project-scoped material workspace uses its shared library context", () => {
    const store = createShellStore("build");
    store.getState().setActiveBuildWorkspaceKind("materials");

    expect(store.getState().activeBuildWorkspaceKind).toBe("materials");
    expect(store.getState().activeWorkspaceId).toBe("build:materials:library");
  });

  it("changing region preserves workspace kind and updates workspace ID for region-scoped workspaces", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setActiveBuildWorkspaceKind("landscape");

    store.getState().setActiveRegionId("cave_01");
    expect(store.getState().activeBuildWorkspaceKind).toBe("landscape");
    expect(store.getState().activeRegionId).toBe("cave_01");
    expect(store.getState().activeWorkspaceId).toBe("build:landscape:cave_01");
  });

  it("clears selection and tool session on workspace kind change", () => {
    const store = createShellStore("build");
    store.getState().setActiveRegionId("forest_north");
    store.getState().setActiveEnvironmentId("env_default");
    store.getState().setSelection(["obj-1", "obj-2"]);

    store.getState().setActiveBuildWorkspaceKind("environment");
    expect(store.getState().selection.entityIds).toEqual([]);
    expect(store.getState().toolSession.isActive).toBe(false);
  });

  it("clears selection and tool session on region change in region-scoped workspaces", () => {
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

  it("switching to design mode activates the player workspace", () => {
    const store = createShellStore("build");
    store.getState().setActiveProductMode("design");

    expect(store.getState().activeDesignWorkspaceKind).toBe("player");
    expect(store.getState().activeWorkspaceId).toBe("design:player");
  });

  it("switching design workspace kind updates the design workspace ID", () => {
    const store = createShellStore("design");
    store.getState().setActiveDesignWorkspaceKind("npcs");

    expect(store.getState().activeDesignWorkspaceKind).toBe("npcs");
    expect(store.getState().activeWorkspaceId).toBe("design:npcs");
  });
});
