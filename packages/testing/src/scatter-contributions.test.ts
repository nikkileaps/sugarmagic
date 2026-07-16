/**
 * resolveScatterContributions (ADR 027, decision 2).
 *
 * The single scatter collector every render path shares: it flattens a
 * resolved surface stack's scatter -- including scatter nested inside
 * surface-ref layers -- gating each by the surface-ref's painted mask.
 */

import { describe, expect, it } from "vitest";
import type { Mask } from "@sugarmagic/domain";
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

/**
 * A library holding one grass SURFACE whose nested grass scatter layer
 * carries the given overrides (mask / opacity / enabled). Defaults leave
 * the scatter's own mask "always" and opacity 1 -- the common case.
 */
function libraryWithGrass(
  scatterOverrides: { mask?: Mask; opacity?: number; enabled?: boolean } = {}
) {
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
  grassSurface.surface = createSurface([
    createAppearanceLayer(createColorAppearanceContent(0x5e8740), {
      displayName: "Ground",
      blendMode: "base"
    }),
    createScatterLayer(
      { kind: "grass", grassTypeId: grass.definitionId },
      { displayName: "Grass", ...scatterOverrides }
    )
  ]);
  (contentLibrary.surfaceDefinitions ??= []).push(grassSurface);
  return contentLibrary;
}

function libraryWithGrassSurface() {
  return libraryWithGrass();
}

/**
 * A binding: base stone + a surface-ref layer pointing at the grass
 * surface above, carrying the given overrides (its own mask / opacity /
 * enabled act as the gate on the nested scatter).
 */
function bindingWithGrassRef(
  refOverrides: { mask?: Mask; opacity?: number; enabled?: boolean } = {}
) {
  return createInlineSurfaceBinding(
    createSurface([
      createAppearanceLayer(createColorAppearanceContent(0x808080), {
        displayName: "Stone",
        blendMode: "base"
      }),
      createAppearanceLayer(
        createSurfaceRefAppearanceContent("little-world:surface:grass"),
        { displayName: "Grass", blendMode: "mix", ...refOverrides }
      )
    ])
  );
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

  it("multiplies nested scatter opacity by the surface-ref gate opacity", () => {
    // Nested scatter at 0.5, surface-ref gate at 0.5 -> 0.25 combined.
    const contentLibrary = libraryWithGrass({ opacity: 0.5 });
    const binding = bindingWithGrassRef({
      mask: { kind: "painted", maskTextureId: "little-world:mask-texture:m1" },
      opacity: 0.5
    });

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const scatter = resolveScatterContributions(resolved.binding);
    expect(scatter).toHaveLength(1);
    expect(scatter[0]!.opacity).toBeCloseTo(0.25);
  });

  it("a non-'always' surface-ref mask overrides the nested scatter's own mask", () => {
    // Nested scatter carries its OWN painted mask, but the surface-ref
    // gate's painted mask wins -- coverage follows what you painted onto
    // the asset, not the surface's internal mask.
    const contentLibrary = libraryWithGrass({
      mask: { kind: "painted", maskTextureId: "little-world:mask-texture:nested" }
    });
    const binding = bindingWithGrassRef({
      mask: { kind: "painted", maskTextureId: "little-world:mask-texture:gate" }
    });

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const scatter = resolveScatterContributions(resolved.binding);
    expect(scatter).toHaveLength(1);
    expect(scatter[0]!.mask.kind).toBe("painted");
    expect(
      (scatter[0]!.mask as { maskTextureId: string }).maskTextureId
    ).toBe("little-world:mask-texture:gate");
  });

  it("keeps the nested scatter's own mask when the surface-ref mask is 'always'", () => {
    // Surface-ref mask defaults to "always" (unpainted), so it does NOT
    // gate -- the nested scatter's own mask survives.
    const contentLibrary = libraryWithGrass({
      mask: { kind: "painted", maskTextureId: "little-world:mask-texture:nested" }
    });
    const binding = bindingWithGrassRef({});

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const scatter = resolveScatterContributions(resolved.binding);
    expect(scatter).toHaveLength(1);
    expect(
      (scatter[0]!.mask as { maskTextureId: string }).maskTextureId
    ).toBe("little-world:mask-texture:nested");
  });

  it("skips a disabled top-level scatter layer", () => {
    const contentLibrary = libraryWithGrassSurface();
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x5e8740), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: "little-world:grass:tall" },
          { displayName: "Grass", enabled: false }
        )
      ])
    );

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolveScatterContributions(resolved.binding)).toHaveLength(0);
  });

  it("does not descend into a disabled surface-ref layer", () => {
    const contentLibrary = libraryWithGrass();
    const binding = bindingWithGrassRef({ enabled: false });

    const resolved = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolveScatterContributions(resolved.binding)).toHaveLength(0);
  });
});
