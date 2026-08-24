import { describe, expect, it } from "vitest";
import { CORE_DESIGN_WORKSPACE_KINDS } from "@sugarmagic/shell";
import { designWorkspaceKinds } from "@sugarmagic/workspaces";

/**
 * The Design tab strip and the shell's list of core design workspaces are two
 * hand-written lists of the same thing. `DesignWorkspaceKind` widens to
 * `string` so plugins can contribute their own kinds, which means the compiler
 * cannot notice when the two disagree.
 *
 * When they do, App.tsx finds the clicked kind "unavailable" and resets the
 * selection to "player" -- so the tab is there, it is clickable, and it shows
 * somebody else's workspace.
 */
describe("design workspace kinds", () => {
  it("offers a tab for every core design workspace, and no orphans", () => {
    expect([...designWorkspaceKinds.map((item) => item.id)].sort()).toEqual(
      [...CORE_DESIGN_WORKSPACE_KINDS].sort()
    );
  });
});
