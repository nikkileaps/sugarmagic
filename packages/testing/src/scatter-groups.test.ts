import { describe, expect, it } from "vitest";
import {
  createDefaultRegion,
  createPlacedAssetInstance,
  resolveHiddenAssetInstanceIds,
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

describe("070.3 — resolveHiddenAssetInstanceIds (folder visibility)", () => {
  const child = (folderId: string, parentFolderId: string): RegionSceneFolder => ({
    folderId,
    displayName: folderId,
    parentFolderId
  });

  it("empty hidden set -> empty result (no work, no allocation churn)", () => {
    const r = region([brushed("a1", "asset:lav", "f1")], [folder("f1", "Patch")]);
    expect(resolveHiddenAssetInstanceIds(r, []).size).toBe(0);
  });

  it("hides every placed asset directly under a hidden folder (brushed OR hand-placed)", () => {
    const hand = createPlacedAssetInstance({ instanceId: "h1", assetDefinitionId: "asset:rock", parentFolderId: "f1" });
    const r = region([brushed("a1", "asset:lav", "f1"), hand], [folder("f1", "Patch")]);
    expect([...resolveHiddenAssetInstanceIds(r, ["f1"])].sort()).toEqual(["a1", "h1"]);
  });

  it("hiding a folder hides its whole descendant subtree", () => {
    const r = region(
      [brushed("a1", "asset:lav", "f1"), brushed("a2", "asset:lav", "f2"), brushed("a3", "asset:lav", "f3")],
      [folder("f1", "Root"), child("f2", "f1"), child("f3", "f2")]
    );
    // Hiding f1 pulls in f2 and f3 (grandchild) transitively.
    expect([...resolveHiddenAssetInstanceIds(r, ["f1"])].sort()).toEqual(["a1", "a2", "a3"]);
    // Hiding only f2 leaves f1's own member visible.
    expect([...resolveHiddenAssetInstanceIds(r, ["f2"])].sort()).toEqual(["a2", "a3"]);
  });

  it("never hides instances outside the hidden folders (folderless / sibling)", () => {
    const r = region(
      [brushed("a1", "asset:lav", "f1"), brushed("b1", "asset:fern", null), brushed("c1", "asset:oak", "f2")],
      [folder("f1", "Hidden"), folder("f2", "Visible")]
    );
    expect([...resolveHiddenAssetInstanceIds(r, ["f1"])]).toEqual(["a1"]);
  });
});
