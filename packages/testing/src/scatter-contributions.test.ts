/**
 * resolveScatterContributions (ADR 027, decision 2).
 *
 * The single scatter collector every render path shares: it flattens a
 * resolved surface stack's scatter -- including scatter nested inside
 * surface-ref layers -- gating each by the surface-ref's painted mask.
 */

import { describe, expect, it } from "vitest";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createDefaultSurfaceDefinition,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createScatterLayer,
  createSurface,
  createSurfaceRefAppearanceContent,
  createDefaultGrassTypeDefinition
} from "@sugarmagic/domain";
import {
  resolveScatterContributions,
  resolveSurfaceBinding
} from "@sugarmagic/runtime-core";

function libraryWithGrassSurface() {
  const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
  const grass = createDefaultGrassTypeDefinition("little-world", {
    definitionId: "little-world:grass:tall",
    displayName: "Tall"
  });
  (contentLibrary.grassTypeDefinitions ??= []).push(grass);

  const grassSurface = createDefaultSurfaceDefinition("little-world", {
    definitionId: "little-world:surface:grass",
    displayName: "Grass"
  });
  // Base color + a grass scatter layer whose own mask is "always".
  grassSurface.surface = createSurface([
    createAppearanceLayer(createColorAppearanceContent(0x5e8740), {
      displayName: "Ground",
      blendMode: "base"
    }),
    createScatterLayer(
      { kind: "grass", grassTypeId: grass.definitionId },
      { displayName: "Grass" }
    )
  ]);
  (contentLibrary.surfaceDefinitions ??= []).push(grassSurface);
  return contentLibrary;
}

describe("resolveScatterContributions", () => {
  it("flattens grass nested inside a surface-ref, gated by the ref's painted mask", () => {
    const contentLibrary = libraryWithGrassSurface();
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x808080), {
          displayName: "Stone",
          blendMode: "base"
        }),
        createAppearanceLayer(
          createSurfaceRefAppearanceContent("little-world:surface:grass"),
          {
            displayName: "Grass",
            blendMode: "mix",
            mask: { kind: "painted", maskTextureId: "little-world:mask-texture:m1" }
          }
        )
      ])
    );

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const scatter = resolveScatterContributions(resolved.binding);
    // The nested grass scatter surfaces exactly once...
    expect(scatter).toHaveLength(1);
    // ...gated by the surface-ref's PAINTED mask (not the nested
    // "always"), so grass grows only where painted.
    expect(scatter[0]!.mask.kind).toBe("painted");
  });

  it("returns top-level scatter unchanged when there is no surface-ref gate", () => {
    const contentLibrary = libraryWithGrassSurface();
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x5e8740), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: "little-world:grass:tall" },
          { displayName: "Grass" }
        )
      ])
    );
    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const scatter = resolveScatterContributions(resolved.binding);
    expect(scatter).toHaveLength(1);
    expect(scatter[0]!.mask.kind).toBe("always");
  });
});
