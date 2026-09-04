/**
 * What the shell holds as selected, and which member of it is active.
 *
 * The transitions are pure functions, so the rules are tested directly; the
 * store is exercised for the actions Studio actually calls and for the
 * navigation changes that reset a selection.
 */

import { describe, expect, it } from "vitest";
import {
  addToSelection,
  clearSelection,
  createShellStore,
  emptySelection,
  removeFromSelection,
  replaceSelection,
  toggleSelection
} from "@sugarmagic/shell";

function selectionOf(store: ReturnType<typeof createShellStore>) {
  return store.getState().selection;
}

/** A selection holding these entities, the last of them active. */
function holding(...entityIds: string[]) {
  return replaceSelection(emptySelection("workspace"), entityIds);
}

describe("selection transitions", () => {
  it("keeps entities in the order they were selected", () => {
    let selection = emptySelection("workspace");
    selection = addToSelection(selection, "prop_a");
    selection = addToSelection(selection, "prop_b");
    selection = addToSelection(selection, "prop_c");

    expect(selection.entityIds).toEqual(["prop_a", "prop_b", "prop_c"]);
  });

  it("does not select the same entity twice", () => {
    let selection = holding("prop_a", "prop_b");
    selection = addToSelection(selection, "prop_a");

    expect(selection.entityIds).toEqual(["prop_a", "prop_b"]);
  });

  it("makes the most recently selected entity active", () => {
    const selection = addToSelection(holding("prop_a"), "prop_b");
    expect(selection.activeEntityId).toBe("prop_b");
  });

  it("makes a deselected entity active, not just a selected one", () => {
    const selection = removeFromSelection(
      holding("prop_a", "prop_b"),
      "prop_a"
    );

    expect(selection.entityIds).toEqual(["prop_b"]);
    expect(selection.activeEntityId).toBe("prop_a");
  });

  it("toggles an unselected entity in and a selected entity out", () => {
    let selection = toggleSelection(emptySelection("workspace"), "prop_a");
    selection = toggleSelection(selection, "prop_b");
    expect(selection.entityIds).toEqual(["prop_a", "prop_b"]);

    selection = toggleSelection(selection, "prop_a");
    expect(selection.entityIds).toEqual(["prop_b"]);
    expect(selection.activeEntityId).toBe("prop_a");
  });

  it("keeps the active member when the selection is cleared", () => {
    const selection = clearSelection(holding("prop_a", "prop_b"));

    expect(selection.entityIds).toEqual([]);
    expect(selection.activeEntityId).toBe("prop_b");
  });

  it("treats replacing with nothing the same as clearing", () => {
    const selection = holding("prop_a");
    expect(replaceSelection(selection, [])).toEqual(clearSelection(selection));
  });

  it("has nothing selected and no active member in a fresh workspace", () => {
    const selection = emptySelection("workspace");
    expect(selection.entityIds).toEqual([]);
    expect(selection.activeEntityId).toBeNull();
  });
});

describe("selection through the shell store", () => {
  it("starts empty with no active member", () => {
    const store = createShellStore();
    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBeNull();
  });

  it("replaces the whole selection and makes the last entity active", () => {
    const store = createShellStore();
    store.getState().setSelection(["prop_x", "prop_y"]);

    expect(selectionOf(store).entityIds).toEqual(["prop_x", "prop_y"]);
    expect(selectionOf(store).activeEntityId).toBe("prop_y");
  });

  it("toggles an entity in and back out", () => {
    const store = createShellStore();
    store.getState().toggleSelection("prop_a");
    store.getState().toggleSelection("prop_b");
    expect(selectionOf(store).entityIds).toEqual(["prop_a", "prop_b"]);

    store.getState().toggleSelection("prop_a");
    expect(selectionOf(store).entityIds).toEqual(["prop_b"]);
  });

  it("keeps the active member when the selection is cleared", () => {
    const store = createShellStore();
    store.getState().setSelection(["prop_a", "prop_b"]);
    store.getState().clearSelection();

    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBe("prop_b");
  });

  it("drops the active member when the author moves to another workspace", () => {
    const store = createShellStore();
    store.getState().setSelection(["prop_a"]);
    store.getState().setActiveBuildWorkspaceKind("landscape");

    expect(selectionOf(store).entityIds).toEqual([]);
    expect(selectionOf(store).activeEntityId).toBeNull();
  });
});
