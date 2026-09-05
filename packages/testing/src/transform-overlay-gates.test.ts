/**
 * Where viewport selection attaches, and what may be selected there.
 *
 * Both halves are pinned: the gate deciding where the gizmo attaches, and the
 * lock deciding what the Scene Composer lets an author touch once it has.
 */

import { describe, expect, it } from "vitest";
import {
  isSceneComposer,
  isSelectableHere,
  regionOwns,
  transformOverlayAttaches,
  type WorkspaceLocation
} from "@sugarmagic/studio";
import type { RegionDocument } from "@sugarmagic/domain";

function at(overrides: Partial<WorkspaceLocation>): WorkspaceLocation {
  return {
    activeProductMode: "build",
    activeBuildWorkspaceKind: "layout",
    activeStoryWorkspaceKind: "structure",
    ...overrides
  };
}

const BUILD_LAYOUT = at({});
const BUILD_LANDSCAPE = at({ activeBuildWorkspaceKind: "landscape" });
const BUILD_SPATIAL = at({ activeBuildWorkspaceKind: "spatial" });
const COMPOSER = at({
  activeProductMode: "story",
  activeStoryWorkspaceKind: "composer"
});
const STORY_STRUCTURE = at({ activeProductMode: "story" });

/**
 * A region owning one asset, one light, one NPC, one item and the player.
 *
 * `regionOwns` reads only these five collections, so the cast stands in for
 * the rest of a RegionDocument that no code under test looks at; spelling out
 * a whole document here would say less about what the rule depends on.
 */
const REGION = {
  placedAssets: [{ instanceId: "region:crate" }],
  placedLights: [{ instanceId: "region:hearth" }],
  npcPresences: [{ presenceId: "region:warden" }],
  itemPresences: [{ presenceId: "region:key" }],
  playerPresence: { presenceId: "region:player" }
} as unknown as RegionDocument;

describe("where viewport selection attaches", () => {
  it("attaches in Build > Layout", () => {
    expect(transformOverlayAttaches(BUILD_LAYOUT)).toBe(true);
  });

  it("attaches in the Scene Composer", () => {
    expect(transformOverlayAttaches(COMPOSER)).toBe(true);
  });

  it("stays away from the other Build workspaces", () => {
    expect(transformOverlayAttaches(BUILD_LANDSCAPE)).toBe(false);
    expect(transformOverlayAttaches(BUILD_SPATIAL)).toBe(false);
  });

  it("stays away from the rest of Story", () => {
    expect(transformOverlayAttaches(STORY_STRUCTURE)).toBe(false);
  });
});

describe("what the Scene Composer lets an author touch", () => {
  it("knows the composer from everywhere else", () => {
    expect(isSceneComposer(COMPOSER)).toBe(true);
    expect(isSceneComposer(BUILD_LAYOUT)).toBe(false);
    expect(isSceneComposer(STORY_STRUCTURE)).toBe(false);
  });

  it("locks every kind of object the region owns", () => {
    for (const owned of [
      "region:crate",
      "region:hearth",
      "region:warden",
      "region:key",
      "region:player"
    ]) {
      expect(regionOwns(REGION, owned)).toBe(true);
      expect(isSelectableHere(COMPOSER, REGION, owned)).toBe(false);
    }
  });

  it("leaves the Scene's own overlay content selectable", () => {
    expect(regionOwns(REGION, "scene:lantern")).toBe(false);
    expect(isSelectableHere(COMPOSER, REGION, "scene:lantern")).toBe(true);
  });

  it("locks nothing in Build, where every drawn object is editable", () => {
    expect(isSelectableHere(BUILD_LAYOUT, REGION, "region:crate")).toBe(true);
  });

  it("owns nothing when there is no region yet", () => {
    expect(regionOwns(null, "region:crate")).toBe(false);
    expect(isSelectableHere(COMPOSER, null, "region:crate")).toBe(true);
  });
});
