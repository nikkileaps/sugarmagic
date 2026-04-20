/**
 * PBR texture-set import tests.
 *
 * Verifies the Sugarbuilder-style directory import contract: infer texture
 * roles from filenames, fail loudly on ambiguous inputs, and surface explicit
 * warnings for maps Standard PBR cannot bind yet.
 */

import { describe, expect, it } from "vitest";
import { discoverPbrTextureSet } from "@sugarmagic/io";

function makeFile(name: string): File {
  return new File(["texture"], name, { type: "image/png" });
}

describe("PBR texture-set discovery", () => {
  it("infers common Substance-style separate maps from filenames", () => {
    const discovered = discoverPbrTextureSet([
      makeFile("wordlark_brick_basecolor.png"),
      makeFile("wordlark_brick_normal.png"),
      makeFile("wordlark_brick_roughness.png"),
      makeFile("wordlark_brick_metallic.png"),
      makeFile("wordlark_brick_ambientOcclusion.png"),
      makeFile("wordlark_brick_height.png")
    ]);

    expect(discovered.filesByRole.basecolor?.name).toBe("wordlark_brick_basecolor.png");
    expect(discovered.filesByRole.normal?.name).toBe("wordlark_brick_normal.png");
    expect(discovered.filesByRole.roughness?.name).toBe("wordlark_brick_roughness.png");
    expect(discovered.filesByRole.metallic?.name).toBe("wordlark_brick_metallic.png");
    expect(discovered.filesByRole.ao?.name).toBe("wordlark_brick_ambientOcclusion.png");
    expect(discovered.filesByRole.height?.name).toBe("wordlark_brick_height.png");
    expect(discovered.suggestedMaterialDisplayName).toBe("Wordlark Brick");
    expect(discovered.warnings).toContain(
      'Imported "wordlark_brick_height.png" as a Height texture, but Standard PBR does not bind height yet. The texture will be added to the library and left unbound.'
    );
  });

  it("fails loudly when multiple files claim the same role", () => {
    expect(() =>
      discoverPbrTextureSet([
        makeFile("brick_basecolor.png"),
        makeFile("brick_albedo.png"),
        makeFile("brick_normal.png")
      ])
    ).toThrow(/multiple basecolor textures/i);
  });

  it("fails loudly when no basecolor texture can be inferred", () => {
    expect(() =>
      discoverPbrTextureSet([
        makeFile("brick_normal.png"),
        makeFile("brick_roughness.png")
      ])
    ).toThrow(/requires a basecolor texture/i);
  });
});
