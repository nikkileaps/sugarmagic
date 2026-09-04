/**
 * What is selected in the current workspace, and which one of those the author
 * touched last.
 *
 * The list is ordered because the order carries meaning: the active member is
 * whichever entity was selected or deselected most recently. Later work reads
 * the active member rather than the list -- it is what supplies the pivot in
 * Blender's Active Element mode and the axes in Local orientation, neither of
 * which this epic builds.
 *
 * Every transition below is a pure function from one selection to the next, so
 * the rules can be tested without a store.
 */
export interface ShellSelectionState {
  workspaceId: string | null;
  /** Selection order, oldest first. Never contains duplicates. */
  entityIds: string[];
  /**
   * The entity selected or deselected most recently, or null before the author
   * has selected anything. It names an entity of `workspaceId`, so changing
   * product mode or workspace kind drops it along with `entityIds` rather than
   * keeping a name the next workspace cannot resolve.
   */
  activeEntityId: string | null;
}

/**
 * A selection belonging to a workspace the author has just moved to. Nothing is
 * selected and there is no active member, because both would name entities the
 * previous workspace owned.
 *
 * [LAW:single-enforcer] Every navigation change builds its cleared selection
 * here, so what "cleared" means is decided once.
 */
export function emptySelection(
  workspaceId: string | null
): ShellSelectionState {
  return { workspaceId, entityIds: [], activeEntityId: null };
}

/**
 * Deselect everything without leaving the workspace -- clicking empty space in
 * the viewport. The active member survives, so an author who deselects all and
 * then transforms still has the reference Blender gives them.
 */
export function clearSelection(
  selection: ShellSelectionState
): ShellSelectionState {
  return replaceSelection(selection, []);
}

/**
 * Select exactly these entities, discarding whatever was selected before -- a
 * plain click, or restoring a saved selection. The last entity listed becomes
 * active; replacing with nothing leaves the previous active member alone, the
 * same way clearing does.
 */
export function replaceSelection(
  selection: ShellSelectionState,
  entityIds: readonly string[]
): ShellSelectionState {
  const ordered = [...new Set(entityIds)];
  return {
    ...selection,
    entityIds: ordered,
    activeEntityId: ordered.at(-1) ?? selection.activeEntityId
  };
}

/**
 * Add an entity to the selection and make it active. An entity already selected
 * keeps its place in the order and simply becomes active.
 */
export function addToSelection(
  selection: ShellSelectionState,
  entityId: string
): ShellSelectionState {
  const alreadySelected = selection.entityIds.includes(entityId);
  return {
    ...selection,
    entityIds: alreadySelected
      ? selection.entityIds
      : [...selection.entityIds, entityId],
    activeEntityId: entityId
  };
}

/**
 * Take an entity out of the selection. It still becomes active: Blender's rule
 * is that the active member is the last entity selected *or* deselected, which
 * is what lets an author deselect down to nothing and keep a reference point.
 */
export function removeFromSelection(
  selection: ShellSelectionState,
  entityId: string
): ShellSelectionState {
  return {
    ...selection,
    entityIds: selection.entityIds.filter((id) => id !== entityId),
    activeEntityId: entityId
  };
}

/**
 * Shift-click: an entity that is not selected joins the selection, and one that
 * is selected leaves it. Either way it becomes the active member.
 */
export function toggleSelection(
  selection: ShellSelectionState,
  entityId: string
): ShellSelectionState {
  return selection.entityIds.includes(entityId)
    ? removeFromSelection(selection, entityId)
    : addToSelection(selection, entityId);
}
