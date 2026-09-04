/**
 * The undo keystroke: which key combinations mean undo, and where the app
 * leaves the keystroke alone.
 */

import { describe, expect, it } from "vitest";
import { isTypingTarget, isUndoShortcut } from "@sugarmagic/studio";

function press(
  key: string,
  modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {}
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers
  };
}

describe("the undo shortcut", () => {
  it("is Cmd+Z", () => {
    expect(isUndoShortcut(press("z", { metaKey: true }))).toBe(true);
  });

  it("is Ctrl+Z too, for anyone not on a Mac", () => {
    expect(isUndoShortcut(press("z", { ctrlKey: true }))).toBe(true);
  });

  it("does not care whether the Z arrives capitalised", () => {
    expect(isUndoShortcut(press("Z", { metaKey: true }))).toBe(true);
  });

  it("is not a bare Z, which is a tool shortcut's business", () => {
    expect(isUndoShortcut(press("z"))).toBe(false);
  });

  it("leaves Cmd+Shift+Z alone, so redo stays available", () => {
    expect(isUndoShortcut(press("z", { metaKey: true, shiftKey: true }))).toBe(
      false
    );
  });

  it("is not Cmd+Alt+Z", () => {
    expect(isUndoShortcut(press("z", { metaKey: true, altKey: true }))).toBe(
      false
    );
  });

  it("is not some other Cmd chord", () => {
    expect(isUndoShortcut(press("s", { metaKey: true }))).toBe(false);
    expect(isUndoShortcut(press("y", { ctrlKey: true }))).toBe(false);
  });
});

/** An element as an event reports it, without needing a browser to make one. */
function element(tagName: string, isContentEditable = false): EventTarget {
  return { tagName, isContentEditable } as unknown as EventTarget;
}

describe("where undo keeps its hands off", () => {
  it("leaves a text input to its own undo", () => {
    expect(isTypingTarget(element("INPUT"))).toBe(true);
  });

  it("leaves a textarea to its own undo", () => {
    expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
  });

  it("leaves anything the author can type into to its own undo", () => {
    expect(isTypingTarget(element("DIV", true))).toBe(true);
  });

  it("takes the keystroke everywhere else", () => {
    expect(isTypingTarget(element("DIV"))).toBe(false);
    expect(isTypingTarget(element("BUTTON"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("does not depend on how the tag name is cased", () => {
    expect(isTypingTarget(element("input"))).toBe(true);
  });
});
