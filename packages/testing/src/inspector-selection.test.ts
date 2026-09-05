/**
 * What decides that the Inspector has something to show.
 *
 * The panel used to read its own header text: a selection with no name, or a
 * kind nobody had added to the name list, rendered as "Nothing selected" while
 * the gizmo sat on the object in the viewport. Selection is a list of ids, so
 * that is what answers the question; the name is only what the header says.
 */

import { describe, expect, it } from "vitest";
import { inspectorShowsSelection } from "@sugarmagic/ui";

describe("whether the Inspector shows a selection", () => {
  it("shows one that has no name yet", () => {
    expect(inspectorShowsSelection(true, null)).toBe(true);
  });

  it("shows one whose name is blank", () => {
    expect(inspectorShowsSelection(true, "")).toBe(true);
  });

  it("shows nothing when nothing is selected, named or not", () => {
    expect(inspectorShowsSelection(false, "Lantern")).toBe(false);
    expect(inspectorShowsSelection(false, null)).toBe(false);
  });

  it("falls back to the name for callers that never had a selection to give", () => {
    // Every panel that shows one fixed thing passes a label and no selection.
    expect(inspectorShowsSelection(undefined, "Mechanics")).toBe(true);
    expect(inspectorShowsSelection(undefined, null)).toBe(false);
  });
});
