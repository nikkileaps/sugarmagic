/**
 * Asset collider domain (Plan 069.1).
 *
 * Kind-aware defaults, collider normalization, and the load-time backfill
 * through normalizeContentLibrarySnapshot. Bounds (a THREE.Box3) are
 * baked studio-side; this file covers the domain SHAPE + backfill only.
 */

import { describe, expect, it } from "vitest";
import {
  assetDefinitionsNeedingColliderBake,
  classifyAssetColliderBake,
  createEmptyContentLibrarySnapshot,
  defaultAssetColliderForKind,
  getAssetDefinition,
  normalizeAssetCollider,
  normalizeContentLibrarySnapshot,
  type AssetCollider,
  type AssetDefinition
} from "@sugarmagic/domain";

function assetDef(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "asset:test",
    definitionKind: "asset",
    displayName: "Test",
    assetKind: "model",
    surfaceSlots: [],
    deform: null,
    effect: null,
    source: {
      relativeAssetPath: "assets/imported/test.glb",
      fileName: "test.glb",
      mimeType: null
    },
    ...overrides
  };
}

describe("defaultAssetColliderForKind", () => {
  it("models default to an auto-box, foliage to none; bounds null either way", () => {
    expect(defaultAssetColliderForKind("model")).toEqual({
      shape: "auto-box",
      localBounds: null
    });
    expect(defaultAssetColliderForKind("foliage")).toEqual({
      shape: "none",
      localBounds: null
    });
  });
});

describe("normalizeAssetCollider", () => {
  it("backfills the kind default when absent", () => {
    expect(normalizeAssetCollider(undefined, "model").shape).toBe("auto-box");
    expect(normalizeAssetCollider(null, "foliage").shape).toBe("none");
  });

  it("preserves an existing collider (shape + baked bounds)", () => {
    const existing: AssetCollider = {
      shape: "sphere",
      localBounds: { min: [-1, -1, -1], max: [1, 1, 1] }
    };
    expect(normalizeAssetCollider(existing, "model")).toEqual(existing);
  });
});

describe("normalizeContentLibrarySnapshot — collider backfill", () => {
  function normalizedAsset(definition: AssetDefinition): AssetDefinition {
    const library = createEmptyContentLibrarySnapshot("proj");
    library.assetDefinitions.push(definition);
    const result = normalizeContentLibrarySnapshot(library, "proj");
    const normalized = getAssetDefinition(result, definition.definitionId);
    expect(normalized).not.toBeNull();
    return normalized!;
  }

  it("backfills a model asset with an auto-box collider (bounds null, studio fills)", () => {
    const normalized = normalizedAsset(assetDef({ assetKind: "model" }));
    expect(normalized.collider).toEqual({ shape: "auto-box", localBounds: null });
  });

  it("backfills a foliage asset with a 'none' collider", () => {
    const normalized = normalizedAsset(assetDef({ assetKind: "foliage" }));
    expect(normalized.collider).toEqual({ shape: "none", localBounds: null });
  });

  it("preserves an already-baked collider through load", () => {
    const baked: AssetCollider = {
      shape: "auto-box",
      localBounds: { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] }
    };
    const normalized = normalizedAsset(assetDef({ collider: baked }));
    expect(normalized.collider).toEqual(baked);
  });

  it("is idempotent (round-trip)", () => {
    const once = normalizedAsset(assetDef({ assetKind: "model" }));
    const library = createEmptyContentLibrarySnapshot("proj");
    library.assetDefinitions.push(once);
    const twice = getAssetDefinition(
      normalizeContentLibrarySnapshot(library, "proj"),
      once.definitionId
    );
    expect(twice!.collider).toEqual(once.collider);
  });
});

describe("which assets still need collider bounds baked", () => {
  const BOUNDS = { min: [-1, 0, -1] as [number, number, number], max: [1, 2, 1] as [number, number, number] };

  it("a shaped collider with no bounds is pending, and carries its collider", () => {
    // The caller writes the measurement back onto this collider, so the
    // classification hands over the one it judged rather than making the
    // caller re-read a field that may have changed underneath it.
    const state = classifyAssetColliderBake(
      assetDef({ collider: { shape: "auto-box", localBounds: null } })
    );

    expect(state.kind).toBe("pending");
    expect(state.kind === "pending" && state.collider.shape).toBe("auto-box");
  });

  it("a none-shaped collider is walk-through, not pending", () => {
    expect(
      classifyAssetColliderBake(
        assetDef({ collider: { shape: "none", localBounds: null } })
      ).kind
    ).toBe("walk-through");
  });

  it("bounds already measured read as already-baked", () => {
    expect(
      classifyAssetColliderBake(
        assetDef({ collider: { shape: "auto-box", localBounds: BOUNDS } })
      ).kind
    ).toBe("already-baked");
  });

  it("no collider at all falls to the kind default", () => {
    // A file written before colliders existed. The definition's kind is
    // what decides, so a model is pending and foliage walks through.
    expect(classifyAssetColliderBake(assetDef({ assetKind: "model" })).kind).toBe(
      "pending"
    );
    expect(
      classifyAssetColliderBake(assetDef({ assetKind: "foliage" })).kind
    ).toBe("walk-through");
  });

  it("never reports bounds as pending on a walk-through collider", () => {
    // The drift this replaced: the studio's race re-check tested only for
    // absent bounds and had dropped the shape test, so a collider switched
    // to "none" mid-backfill still got bounds written onto it.
    expect(
      classifyAssetColliderBake(
        assetDef({ collider: { shape: "none", localBounds: null } })
      ).kind
    ).not.toBe("pending");
  });

  it("selects only the pending ones out of a library", () => {
    const library = createEmptyContentLibrarySnapshot("proj");
    library.assetDefinitions.push(
      assetDef({ definitionId: "a:pending", collider: { shape: "auto-box", localBounds: null } }),
      assetDef({ definitionId: "a:walk", collider: { shape: "none", localBounds: null } }),
      assetDef({ definitionId: "a:done", collider: { shape: "auto-box", localBounds: BOUNDS } })
    );

    expect(
      assetDefinitionsNeedingColliderBake(library).map(
        (entry) => entry.definition.definitionId
      )
    ).toEqual(["a:pending"]);
  });
});
