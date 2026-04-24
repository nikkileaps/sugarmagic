import { describe, expect, it } from "vitest";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createColorEmissionContent,
  createInlineSurfaceBinding,
  createSurface,
  createEmissionLayer,
  createEmptyContentLibrarySnapshot
} from "@sugarmagic/domain";
import { resolveSurfaceBinding } from "@sugarmagic/runtime-core";

describe("procedural masks", () => {
  it("resolves perlin, voronoi, and gradient masks through the surface resolver", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const binding = createInlineSurfaceBinding(
      createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x6f8f52), {
          displayName: "Base",
          blendMode: "base"
        }),
        createAppearanceLayer(createColorAppearanceContent(0x88aa66), {
          displayName: "Perlin",
          mask: {
            kind: "perlin-noise",
            scale: 4,
            offset: [0, 0],
            threshold: 0.5,
            fade: 0.15
          }
        }),
        createAppearanceLayer(createColorAppearanceContent(0xaabb88), {
          displayName: "Voronoi",
          mask: {
            kind: "voronoi",
            cellSize: 0.1,
            borderWidth: 0.05
          }
        }),
        createEmissionLayer(
          createColorEmissionContent(0xffcc88, 1),
          {
            displayName: "Gradient Glow",
            mask: {
              kind: "world-position-gradient",
              axis: "y",
              min: 0.2,
              max: 0.8,
              fade: 0.15
            }
          }
        )
      ])
    );

    const result = resolveSurfaceBinding(binding, contentLibrary, "universal");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.binding.layers.map((layer) => layer.mask.kind)).toEqual([
      "always",
      "perlin-noise",
      "voronoi",
      "world-position-gradient"
    ]);
  });
});
