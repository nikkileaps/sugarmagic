/**
 * Surface-ref layer resolution tests (Plan 068.9, ADR 026).
 *
 * The Surface Brush creates a layer that IS a referenced library
 * surface, masked. Resolution must recurse into the referenced
 * surface (carrying its full composited stack) and reject reference
 * cycles.
 */

import { describe, expect, it } from "vitest";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createDefaultSurfaceDefinition,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createSurface,
  createSurfaceRefAppearanceContent
} from "@sugarmagic/domain";
import { resolveSurfaceBinding } from "@sugarmagic/runtime-core";

function libraryWithMossy() {
  const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
  const mossy = createDefaultSurfaceDefinition("little-world", {
    definitionId: "little-world:surface:mossy",
    displayName: "Mossy"
  });
  mossy.surface = createSurface([
    createAppearanceLayer(createColorAppearanceContent(0x225522), {
      displayName: "Moss",
      blendMode: "base"
    })
  ]);
  (contentLibrary.surfaceDefinitions ??= []).push(mossy);
  return contentLibrary;
}

describe("surface-ref layer resolution", () => {
  it("recurses into the referenced library surface", () => {
    const contentLibrary = libraryWithMossy();
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(
          createSurfaceRefAppearanceContent("little-world:surface:mossy"),
          { displayName: "Mossy", blendMode: "base" }
        )
      ])
    );

    const result = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const layer = result.binding.layers[0]!;
    expect(layer.kind).toBe("surface-ref");
    if (layer.kind !== "surface-ref") return;
    // The nested stack is the referenced surface, fully resolved.
    expect(layer.nested.layers).toHaveLength(1);
    expect(layer.nested.layers[0]!.kind).toBe("appearance");
  });

  it("rejects a direct self-reference cycle", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const selfRef = createDefaultSurfaceDefinition("little-world", {
      definitionId: "little-world:surface:loop",
      displayName: "Loop"
    });
    selfRef.surface = createSurface([
      createAppearanceLayer(
        createSurfaceRefAppearanceContent("little-world:surface:loop"),
        { displayName: "Loop", blendMode: "base" }
      )
    ]);
    (contentLibrary.surfaceDefinitions ??= []).push(selfRef);

    const result = resolveSurfaceBinding(
      { kind: "reference", surfaceDefinitionId: "little-world:surface:loop" },
      contentLibrary,
      "universal"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.message).toMatch(/cycle/i);
  });

  it("carries the surface-ref layer's own mask and blend", () => {
    const contentLibrary = libraryWithMossy();
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x808080), {
          displayName: "Base",
          blendMode: "base"
        }),
        createAppearanceLayer(
          createSurfaceRefAppearanceContent("little-world:surface:mossy"),
          {
            displayName: "Mossy",
            blendMode: "mix",
            mask: { kind: "painted", maskTextureId: "little-world:mask-texture:m1" }
          }
        )
      ])
    );

    const result = resolveSurfaceBinding(binding, contentLibrary, "universal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ref = result.binding.layers[1]!;
    expect(ref.kind).toBe("surface-ref");
    if (ref.kind !== "surface-ref") return;
    expect(ref.blendMode).toBe("mix");
    expect(ref.mask.kind).toBe("painted");
  });
});
