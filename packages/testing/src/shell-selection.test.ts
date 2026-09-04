import { describe, expect, it } from "vitest";
import { createShellStore } from "@sugarmagic/shell";

function selectionOf(store: ReturnType<typeof createShellStore>) {
  return store.getState().selection;
}

describe("Shell selection", () => {
  it("starts empty with no active member", () => {
    const store = createShellStore();
    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBeNull();
  });

  it("keeps entities in the order they were selected", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().addSelection("prop_b");
    store.getState().addSelection("prop_c");

    expect(selectionOf(store).entityIds).toEqual([
      "prop_a",
      "prop_b",
      "prop_c"
    ]);
  });

  it("does not select the same entity twice", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().addSelection("prop_b");
    store.getState().addSelection("prop_a");

    expect(selectionOf(store).entityIds).toEqual(["prop_a", "prop_b"]);
  });

  it("makes the most recently selected entity active", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    expect(selectionOf(store).activeEntityId).toBe("prop_a");

    store.getState().addSelection("prop_b");
    expect(selectionOf(store).activeEntityId).toBe("prop_b");
  });

  it("makes a deselected entity active, not just a selected one", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().addSelection("prop_b");
    store.getState().removeSelection("prop_a");

    expect(selectionOf(store).entityIds).toEqual(["prop_b"]);
    expect(selectionOf(store).activeEntityId).toBe("prop_a");
  });

  it("toggles an unselected entity in and a selected entity out", () => {
    const store = createShellStore();
    store.getState().toggleSelection("prop_a");
    store.getState().toggleSelection("prop_b");
    expect(selectionOf(store).entityIds).toEqual(["prop_a", "prop_b"]);

    store.getState().toggleSelection("prop_a");
    expect(selectionOf(store).entityIds).toEqual(["prop_b"]);
    expect(selectionOf(store).activeEntityId).toBe("prop_a");
  });

  it("keeps the active member when the selection is cleared", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().addSelection("prop_b");
    store.getState().clearSelection();

    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBe("prop_b");
  });

  it("replaces the whole selection and makes the last entity active", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().setSelection(["prop_x", "prop_y"]);

    expect(selectionOf(store).entityIds).toEqual(["prop_x", "prop_y"]);
    expect(selectionOf(store).activeEntityId).toBe("prop_y");
  });

  it("treats replacing with nothing the same as clearing", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().setSelection([]);

    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBe("prop_a");
  });

  it("drops the active member when the author moves to another workspace", () => {
    const store = createShellStore();
    store.getState().addSelection("prop_a");
    store.getState().setActiveBuildWorkspaceKind("landscape");

    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBeNull();
  });
});
