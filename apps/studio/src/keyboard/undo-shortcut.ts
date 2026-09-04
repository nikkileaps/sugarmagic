/**
 * The application-wide undo keystroke.
 *
 * Pure decisions only -- whether a keystroke asks for undo, and whether the
 * author is somewhere that owns its own undo. The listener that acts on them
 * lives with the rest of the app's wiring.
 */

/**
 * Whether this keystroke is the undo shortcut: Cmd+Z on a Mac, Ctrl+Z
 * elsewhere.
 *
 * Shift is excluded rather than ignored, so Cmd+Shift+Z stays free to mean
 * redo. Reading it as undo would make redo impossible to add without changing
 * what undo means.
 */
export function isUndoShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "z"
  );
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
