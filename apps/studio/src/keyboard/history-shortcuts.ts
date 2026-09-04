/**
 * The application-wide undo and redo keystrokes.
 *
 * Pure decisions only -- which history action a keystroke asks for, and whether
 * the author is somewhere that owns its own undo. The listener that acts on
 * them lives with the rest of the app's wiring.
 */

/** Which way through the session's history a keystroke asks to go. */
export type HistoryAction = "undo" | "redo";

/**
 * The history action this keystroke asks for, or null if it asks for neither.
 *
 * One function answers for both so the two can never claim the same chord: a
 * pair of separate predicates would only stay apart for as long as they went on
 * agreeing about Shift.
 *
 * Undo is Cmd+Z, or Ctrl+Z away from a Mac. Redo is the same chord with Shift,
 * and Ctrl+Y as well, which is what Windows authors reach for.
 */
export function historyShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): HistoryAction | null {
  const commandHeld = event.metaKey || event.ctrlKey;
  if (!commandHeld || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  // Ctrl+Y is a redo on Windows. Cmd+Y is taken on a Mac, so it stays Ctrl.
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}

/**
 * Whether the keystroke landed in something that keeps its own edit history --
 * a text field, or anything the author can type into.
 *
 * Undoing the region document while someone is partway through typing a name
 * would throw away a change they cannot see and leave the one they meant to
 * take back. The field's own undo is the right answer there, so this leaves
 * the keystroke alone for the browser to handle.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Read the element's shape rather than testing `instanceof HTMLInputElement`:
  // those checks compare against one window's classes and answer "no" for an
  // element belonging to another, and the tag and the content-editable flag are
  // what the browser is being asked about anyway.
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  } | null;
  if (!element) return false;
  const tagName =
    typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    element.isContentEditable === true
  );
}
