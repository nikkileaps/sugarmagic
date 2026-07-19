import { describe, expect, it } from "vitest";
import {
  createDefaultRegion,
  createPlacedAssetInstance,
  resolveScatterGroups,
  type PlacedAssetInstance,
  type RegionSceneFolder
} from "@sugarmagic/domain";

// Plan 070.3 (#349): ScatterGroup is DERIVED from placed assets by folder
// identity, with a folderless synthetic-per-asset fallback so the derivation
// is TOTAL over the schema. These lock that contract.

function region(
  placedAssets: PlacedAssetInstance[],
  folders: RegionSceneFolder[]
) {
  return {
    ...createDefaultRegion({ regionId: "r", displayName: "R" }),
    placedAssets,
    folders
  };
}
function brushed(instanceId: string, assetDefinitionId: string, parentFolderId: string | null) {
  // The brush executor sets `brushed` directly (not via the factory, which
  // omits it), so mirror that here.
  return { ...createPlacedAssetInstance({ instanceId, assetDefinitionId, parentFolderId }), brushed: true };
}
function folder(folderId: string, displayName: string): RegionSceneFolder {
  return { folderId, displayName, parentFolderId: null };
}

describe("070.3 — resolveScatterGroups (derived)", () => {
  it("groups a stroke's brushed members by their patch folder", () => {
    const groups = resolveScatterGroups(
      region(
        [
          brushed("a1", "asset:lav", "f1"),
          brushed("a2", "asset:lav", "f1"),
          brushed("a3", "asset:lav", "f1")
        ],
        [folder("f1", "Lavender patch")]
      )
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      groupId: "f1",
      displayName: "Lavender patch",
      assetDefinitionId: "asset:lav",
      folderBacked: true
    });
    expect(groups[0]!.memberInstanceIds.sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("never groups hand-placed (non-brushed) instances", () => {
    const hand = createPlacedAssetInstance({ instanceId: "h1", assetDefinitionId: "asset:rock", parentFolderId: "f1" });
    const groups = resolveScatterGroups(region([hand, brushed("b1", "asset:lav", "f1")], [folder("f1", "Mix")]));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberInstanceIds).toEqual(["b1"]); // hand-placed excluded
  });

  it("folderless brushed instances bucket by assetDefinitionId (synthetic group)", () => {
    const groups = resolveScatterGroups(
      region(
        [brushed("a1", "asset:lav", null), brushed("a2", "asset:lav", null), brushed("b1", "asset:fern", null)],
        []
      )
    );
    const byId = Object.fromEntries(groups.map((g) => [g.groupId, g]));
    expect(byId["scatter:asset:lav"]).toMatchObject({ folderBacked: false, assetDefinitionId: "asset:lav" });
    expect(byId["scatter:asset:lav"]!.memberInstanceIds.sort()).toEqual(["a1", "a2"]);
    expect(byId["scatter:asset:fern"]!.memberInstanceIds).toEqual(["b1"]);
  });

  it("a DANGLING folder ref (folder deleted) falls into the folderless bucket, never stranded", () => {
    // brushed instance points at f-gone which isn't in region.folders.
    const groups = resolveScatterGroups(region([brushed("a1", "asset:lav", "f-gone")], []));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupId: "scatter:asset:lav", folderBacked: false });
    expect(groups[0]!.memberInstanceIds).toEqual(["a1"]);
  });

  it("a mixed-asset folder yields assetDefinitionId = null", () => {
    const groups = resolveScatterGroups(
      region([brushed("a1", "asset:lav", "f1"), brushed("b1", "asset:fern", "f1")], [folder("f1", "Mixed")])
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.assetDefinitionId).toBeNull();
    expect(groups[0]!.memberInstanceIds.sort()).toEqual(["a1", "b1"]);
  });

  it("no brushed instances -> no groups", () => {
    const hand = createPlacedAssetInstance({ instanceId: "h1", assetDefinitionId: "asset:rock" });
    expect(resolveScatterGroups(region([hand], []))).toEqual([]);
  });
});
