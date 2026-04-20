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

describe("Standard PBR shader graph variants", () => {
  it("registers both ORM and Separate variants as built-in mesh-surface shaders", async () => {
    const { createEmptyContentLibrarySnapshot, normalizeContentLibrarySnapshot } =
      await import("@sugarmagic/domain");
    const library = normalizeContentLibrarySnapshot(
      createEmptyContentLibrarySnapshot("project"),
      "project"
    );

    const orm = library.shaderDefinitions.find(
      (definition) => definition.metadata.builtInKey === "standard-pbr"
    );
    const separate = library.shaderDefinitions.find(
      (definition) => definition.metadata.builtInKey === "standard-pbr-separate"
    );

    expect(orm).toBeTruthy();
    expect(orm?.targetKind).toBe("mesh-surface");
    expect(separate).toBeTruthy();
    expect(separate?.targetKind).toBe("mesh-surface");

    // ORM variant declares the ORM-pack parameter but NOT separate
    // channels — so authors can't accidentally bind a roughness map
    // to a graph that never samples it.
    const ormParameterIds = orm!.parameters.map((p) => p.parameterId);
    expect(ormParameterIds).toContain("orm_texture");
    expect(ormParameterIds).not.toContain("roughness_texture");
    expect(ormParameterIds).not.toContain("metallic_texture");
    expect(ormParameterIds).not.toContain("ao_texture");

    // Separate variant declares the three per-channel parameters and
    // does NOT declare ORM.
    const separateParameterIds = separate!.parameters.map((p) => p.parameterId);
    expect(separateParameterIds).toContain("roughness_texture");
    expect(separateParameterIds).toContain("metallic_texture");
    expect(separateParameterIds).toContain("ao_texture");
    expect(separateParameterIds).not.toContain("orm_texture");
  });

  it("compiles both variants with PBR outputs wired", async () => {
    const {
      createDefaultStandardPbrShaderGraph,
      createDefaultStandardPbrSeparateShaderGraph
    } = await import("@sugarmagic/domain");
    const { compileShaderGraph } = await import("@sugarmagic/runtime-core");

    for (const document of [
      createDefaultStandardPbrShaderGraph("project"),
      createDefaultStandardPbrSeparateShaderGraph("project")
    ]) {
      const ir = compileShaderGraph(document, {
        compileProfile: "authoring-preview"
      });
      // No error-level diagnostics — graph shape is internally valid.
      expect(
        ir.diagnostics.filter((d) => d.severity === "error")
      ).toEqual([]);
      // Every PBR surface output is driven by the graph, not left as
      // a compile-time literal default the runtime would stomp on.
      expect(ir.outputs.fragmentColor).toBeTruthy();
      expect(ir.outputs.fragmentAlpha).toBeTruthy();
      expect(ir.outputs.fragmentNormal).toBeTruthy();
      expect(ir.outputs.fragmentRoughness).toBeTruthy();
      expect(ir.outputs.fragmentMetalness).toBeTruthy();
      expect(ir.outputs.fragmentAo).toBeTruthy();
    }
  });
});
