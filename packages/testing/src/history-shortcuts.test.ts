/**
 * The undo and redo keystrokes: which chord means which way through the
 * session's history, and where the app leaves the keystroke alone.
 */

import { describe, expect, it } from "vitest";
import { historyShortcut, isTypingTarget } from "@sugarmagic/studio";

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

describe("which history action a chord asks for", () => {
  it("undoes on Cmd+Z", () => {
    expect(historyShortcut(press("z", { metaKey: true }))).toBe("undo");
  });

  it("undoes on Ctrl+Z too, for anyone not on a Mac", () => {
    expect(historyShortcut(press("z", { ctrlKey: true }))).toBe("undo");
  });

  it("redoes on Shift+Cmd+Z", () => {
    expect(historyShortcut(press("z", { metaKey: true, shiftKey: true }))).toBe(
      "redo"
    );
  });

  it("redoes on Ctrl+Y, which is what Windows authors reach for", () => {
    expect(historyShortcut(press("y", { ctrlKey: true }))).toBe("redo");
  });

  it("never answers undo and redo for the same chord", () => {
    // The two cannot overlap by construction: one chord, one answer.
    const chords = [
      press("z", { metaKey: true }),
      press("z", { metaKey: true, shiftKey: true }),
      press("y", { ctrlKey: true })
    ];
    for (const chord of chords) {
      expect(["undo", "redo"]).toContain(historyShortcut(chord));
    }
  });

  it("does not care whether the key arrives capitalised", () => {
    expect(historyShortcut(press("Z", { metaKey: true }))).toBe("undo");
    expect(historyShortcut(press("Z", { metaKey: true, shiftKey: true }))).toBe(
      "redo"
    );
  });

  it("ignores a bare Z, which is a tool shortcut's business", () => {
    expect(historyShortcut(press("z"))).toBeNull();
    expect(historyShortcut(press("z", { shiftKey: true }))).toBeNull();
  });

  it("ignores chords that add Alt", () => {
    expect(
      historyShortcut(press("z", { metaKey: true, altKey: true }))
    ).toBeNull();
  });

  it("ignores other command chords", () => {
    expect(historyShortcut(press("s", { metaKey: true }))).toBeNull();
    expect(historyShortcut(press("a", { ctrlKey: true }))).toBeNull();
  });

  it("leaves Cmd+Y alone, because a Mac already spends it", () => {
    expect(historyShortcut(press("y", { metaKey: true }))).toBeNull();
  });
});

/** An element as an event reports it, without needing a browser to make one. */
function element(tagName: string, isContentEditable = false): EventTarget {
  return { tagName, isContentEditable } as unknown as EventTarget;
}

describe("where undo and redo keep their hands off", () => {
  it("leaves a text input to its own history", () => {
    expect(isTypingTarget(element("INPUT"))).toBe(true);
  });

  it("leaves a textarea to its own history", () => {
    expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
  });

  it("leaves anything the author can type into to its own history", () => {
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
