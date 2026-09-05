/**
 * Placed lights in the Scene Explorer, and which rows offer an on/off control.
 *
 * The control is the point of this: a light's is authored state that ships
 * with the game, while a folder's eye only hides things while you work. Every
 * other kind of row must not offer one at all, because a control that appears
 * where nothing handles it looks exactly like a control that works.
 */

import { describe, expect, it } from "vitest";
import { buildSceneTree } from "@sugarmagic/workspaces";
import type { SceneExplorerEntity, SceneExplorerNode } from "@sugarmagic/ui";
import {
  composeRegionContents,
  createDefaultRegion,
  createPlacedAssetInstance,
  createPlacedLight,
  createRegionMarker,
  resolveHiddenAssetInstanceIds,
  type RegionDocument
} from "@sugarmagic/domain";

const REGION_ID = "region:hollow";

function treeFor(region: RegionDocument): SceneExplorerNode[] {
  return buildSceneTree(
    region,
    composeRegionContents(region, null),
    new Set(),
    new Set(),
    [],
    null,
    [],
    [],
    [],
    new Set()
  );
}

/** The folder with this name, wherever it sits. Everything hangs under a root
 *  folder named after the region, so nothing interesting is at the top. */
function findFolder(
  rows: SceneExplorerNode[],
  displayName: string
): SceneExplorerNode | null {
  for (const row of rows) {
    if (row.type !== "folder") continue;
    if (row.displayName === displayName) return row;
    const nested = findFolder(row.children, displayName);
    if (nested) return nested;
  }
  return null;
}

/** Every entity row in the tree, however deeply foldered. */
function entityRows(rows: SceneExplorerNode[]): SceneExplorerEntity[] {
  return rows.flatMap((row) => {
    if (row.type === "folder") return entityRows(row.children);
    return row.type === "entity" ? [row] : [];
  });
}

function lightRows(region: RegionDocument): SceneExplorerEntity[] {
  return entityRows(treeFor(region)).filter(
    (row) => row.entityKind === "light"
  );
}

function regionWith(overrides: Partial<RegionDocument>): RegionDocument {
  return {
    ...createDefaultRegion({ regionId: REGION_ID, displayName: "Hollow" }),
    ...overrides
  };
}

describe("lights in the Scene Explorer", () => {
  it("gives every placed light a row", () => {
    const region = regionWith({
      placedLights: [
        createPlacedLight({ instanceId: "l1", displayName: "Lantern" }),
        createPlacedLight({ instanceId: "l2", displayName: "Candle" })
      ]
    });

    expect(lightRows(region).map((row) => row.displayName)).toEqual([
      "Lantern",
      "Candle"
    ]);
  });

  it("puts a light in the folder it was placed in", () => {
    const region = regionWith({
      folders: [
        {
          folderId: "folder:shrine",
          displayName: "Shrine",
          parentFolderId: null
        }
      ],
      placedLights: [
        createPlacedLight({ instanceId: "l1", parentFolderId: "folder:shrine" })
      ]
    });

    const shrine = findFolder(treeFor(region), "Shrine");
    expect(shrine?.type).toBe("folder");
    expect(
      entityRows(shrine?.type === "folder" ? shrine.children : []).map(
        (row) => row.instanceId
      )
    ).toEqual(["l1"]);
  });

  it("shows the row as off when the light is switched off", () => {
    const region = regionWith({
      placedLights: [createPlacedLight({ instanceId: "l1", enabled: false })]
    });

    expect(lightRows(region)[0]?.visible).toBe(false);
  });
});

describe("which rows offer an on/off control", () => {
  it("offers one on a light row", () => {
    const region = regionWith({
      placedLights: [createPlacedLight({ instanceId: "l1" })]
    });

    expect(lightRows(region)[0]?.canToggleVisibility).toBe(true);
  });

  it("offers none on any other kind of row", () => {
    const region = regionWith({
      placedAssets: [
        createPlacedAssetInstance({
          instanceId: "a1",
          assetDefinitionId: "asset:crate"
        })
      ],
      markers: [createRegionMarker({ displayName: "Spot" })],
      placedLights: [createPlacedLight({ instanceId: "l1" })]
    });

    const others = entityRows(treeFor(region)).filter(
      (row) => row.entityKind !== "light"
    );
    expect(others.length).toBeGreaterThan(0);
    for (const row of others) {
      expect(row.canToggleVisibility ?? false).toBe(false);
    }
  });
});

describe("a folder the author has hidden", () => {
  it("hides the lights inside it, not only the props", () => {
    const region = regionWith({
      folders: [
        {
          folderId: "folder:shrine",
          displayName: "Shrine",
          parentFolderId: null
        }
      ],
      placedAssets: [
        createPlacedAssetInstance({
          instanceId: "a1",
          assetDefinitionId: "asset:crate",
          parentFolderId: "folder:shrine"
        })
      ],
      placedLights: [
        createPlacedLight({ instanceId: "l1", parentFolderId: "folder:shrine" })
      ]
    });

    const hidden = resolveHiddenAssetInstanceIds(
      composeRegionContents(region, null),
      ["folder:shrine"]
    );

    // A light left out would keep drawing inside a folder the author closed.
    expect([...hidden].sort()).toEqual(["a1", "l1"]);
  });
});
