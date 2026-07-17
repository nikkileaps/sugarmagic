/**
 * NavMesh artifact is a file-backed asset (Plan 069.8 persistence fix).
 *
 * Regression guard: `collectFileBackedAssetPaths` — the single collector that
 * decides which files re-load into the asset-source store on project open (and
 * ship to deployed games) — MUST include `region.navMesh.assetPath`. Omitting
 * it made NPC pathfinding silently fall back to straight-line after a restart
 * (the artifact URL was unresolvable), even though the bake persisted fine.
 */

import { describe, expect, it } from "vitest";
import {
  collectFileBackedAssetPaths,
  createDefaultRegion,
  createEmptyContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";

function regionWithNavMesh(): RegionDocument {
  const region = createDefaultRegion({
    regionId: "region-1",
    displayName: "R"
  });
  region.navMesh = {
    assetPath: "assets/navmesh/region-1.navmesh.bin",
    inputHash: "abc",
    agentRadius: 0.35
  };
  return region;
}

describe("069.8 — navmesh artifact is file-backed", () => {
  it("collects the region navmesh path so it re-loads on open + deploys", () => {
    const paths = collectFileBackedAssetPaths({
      contentLibrary: createEmptyContentLibrarySnapshot("test"),
      regions: [regionWithNavMesh()]
    });
    expect(paths).toContain("assets/navmesh/region-1.navmesh.bin");
  });

  it("omits regions with no bake", () => {
    const paths = collectFileBackedAssetPaths({
      contentLibrary: createEmptyContentLibrarySnapshot("test"),
      regions: [createDefaultRegion({ regionId: "r", displayName: "R" })]
    });
    expect(paths.some((p) => p.includes("navmesh"))).toBe(false);
  });
});
