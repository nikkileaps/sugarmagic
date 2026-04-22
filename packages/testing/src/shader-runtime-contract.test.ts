import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ShaderRuntime } from "@sugarmagic/render-web";
import {
  resolveSceneObjects,
  resolveEffectivePostProcessShaderBindings,
  resolveAssetDefinitionShaderBindings,
  compileShaderGraph,
  type EffectiveShaderBinding
} from "@sugarmagic/runtime-core";
import {
  createShaderSurface,
  createDefaultColorGradePostProcessShaderGraph,
  createDefaultEnvironmentDefinition,
  createDefaultFogTintPostProcessShaderGraph,
  createDefaultFoliageSurfaceShaderGraph,
  createDefaultFoliageTintShaderGraph,
  createDefaultFoliageWindShaderGraph,
  createDefaultStandardPbrShaderGraph,
  createDefaultShaderGraphDocument,
  createDefaultVignettePostProcessShaderGraph,
  createPlacedAssetInstance,
  createRegionPlayerPresence,
  normalizeContentLibrarySnapshot,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";

function createContentLibrary(): ContentLibrarySnapshot {
  const foliageSurface = createDefaultFoliageSurfaceShaderGraph("project");
  const foliageShader = createDefaultFoliageWindShaderGraph("project");
  const postProcessShader = {
    ...createDefaultShaderGraphDocument("project", {
      shaderDefinitionId: "project:shader:post-process-test",
      displayName: "Post Process Test",
      targetKind: "post-process"
    }),
    revision: 2,
    parameters: [
      {
        parameterId: "intensity",
        displayName: "Intensity",
        dataType: "float" as const,
        defaultValue: 0.5
      }
    ]
  };

  return normalizeContentLibrarySnapshot({
    identity: {
      id: "project:content-library",
      schema: "ContentLibrarySnapshot",
      version: 1
    },
    assetDefinitions: [
      {
        definitionId: "asset:tree",
        definitionKind: "asset",
        displayName: "Tree",
        assetKind: "foliage",
        surfaceSlots: [
          {
            slotName: "Leaves",
            slotIndex: 0,
            surface: createShaderSurface(foliageSurface.shaderDefinitionId)
          }
        ],
        deform: createShaderSurface(foliageShader.shaderDefinitionId),
        effect: null,
        source: {
          relativeAssetPath: "assets/imported/tree.glb",
          fileName: "tree.glb",
          mimeType: "model/gltf-binary"
        }
      }
    ],
    materialDefinitions: [],
    textureDefinitions: [],
    environmentDefinitions: [
      createDefaultEnvironmentDefinition("project", {
        definitionId: "env:default",
        displayName: "Default"
      })
    ],
    shaderDefinitions: [foliageSurface, foliageShader, postProcessShader]
  }, "project");
}

function createRegion(): RegionDocument {
  return {
    identity: { id: "region:one", schema: "RegionDocument", version: 1 },
    displayName: "Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      placedAssets: [
        createPlacedAssetInstance({
          instanceId: "placed:tree",
          assetDefinitionId: "asset:tree",
          displayName: "Tree",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        })
      ],
      playerPresence: createRegionPlayerPresence(),
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 32,
      surfaceSlots: [],
      deform: null,
      effect: null,
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

describe("shader runtime contracts", () => {
  it("resolves explicit foliage surface slots and deform traits for foliage assets", () => {
    const contentLibrary = createContentLibrary();
    const sceneObjects = resolveSceneObjects(createRegion(), { contentLibrary });
    const treeObject = sceneObjects.find((object) => object.instanceId === "placed:tree");

    expect(treeObject?.effectiveMaterialSlots[0]?.surface?.shaderDefinitionId).toBe(
      "project:shader:foliage-surface"
    );
    expect(treeObject?.effectiveMaterialSlots[0]?.surface?.targetKind).toBe("mesh-surface");
    expect(treeObject?.effectiveShaders.deform?.shaderDefinitionId).toBe(
      "project:shader:foliage-wind"
    );
    expect(treeObject?.effectiveShaders.deform?.targetKind).toBe("mesh-deform");
  });

  it("emits a loud diagnostic when a slot points at the wrong shader target kind", () => {
    const contentLibrary = createContentLibrary();
    const brokenAsset = {
      ...contentLibrary.assetDefinitions[0]!,
      surfaceSlots: [
        {
          slotName: "Leaves",
          slotIndex: 0,
          surface: createShaderSurface("project:shader:foliage-wind")
        }
      ]
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const resolution = resolveAssetDefinitionShaderBindings(brokenAsset, contentLibrary);

      expect(resolution.bindings.surface).toBeNull();
      expect(resolution.materialSlots[0]?.surface).toBeNull();
      expect(resolution.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          slot: "surface"
        })
      ]);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining(`slot "surface" requires "mesh-surface"`)
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("resolves post-process defaults plus parameter overrides before the web host applies them", () => {
    const contentLibrary = createContentLibrary();
    const bindings = resolveEffectivePostProcessShaderBindings(
      [
        {
          shaderDefinitionId: "project:shader:post-process-test",
          order: 0,
          enabled: true,
          parameterOverrides: [{ parameterId: "intensity", value: 1.25 }]
        }
      ],
      contentLibrary
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.documentRevision).toBe(2);
    expect(bindings[0]?.parameterValues).toEqual({ intensity: 1.25 });
  });

  it("compiles the shipped foliage wind graph into vertex IR with a concrete vertex output", () => {
    const shader = createDefaultFoliageWindShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("mesh-deform");
    expect(compiled.outputs.vertex).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped foliage tint graph into fragment IR with a concrete fragment output", () => {
    const shader = createDefaultFoliageTintShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("mesh-surface");
    expect(compiled.outputs.fragmentColor).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped foliage surface graph into fragment IR with texture-aware outputs", () => {
    const shader = createDefaultFoliageSurfaceShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("mesh-surface");
    expect(compiled.outputs.fragmentColor).toBeDefined();
    expect(compiled.outputs.fragmentAlpha).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped color grade graph without validation errors", () => {
    const shader = createDefaultColorGradePostProcessShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("post-process");
    expect(compiled.outputs.postProcessColor).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped fog tint graph without validation errors", () => {
    const shader = createDefaultFogTintPostProcessShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("post-process");
    expect(compiled.outputs.postProcessColor).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("compiles the shipped vignette graph without validation errors", () => {
    const shader = createDefaultVignettePostProcessShaderGraph("project");
    const compiled = compileShaderGraph(shader, {
      compileProfile: "authoring-preview"
    });

    expect(compiled.targetKind).toBe("post-process");
    expect(compiled.outputs.postProcessColor).toBeDefined();
    expect(
      compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    ).toEqual([]);
  });

  it("keeps shared finalized materials alive until all references release and the grace period elapses", () => {
    vi.useFakeTimers();
    try {
      const shader = createDefaultFoliageTintShaderGraph("project");
      const runtime = new ShaderRuntime({
        contentLibrary: {
          identity: {
            id: "project:content-library",
            schema: "ContentLibrarySnapshot",
            version: 1
          },
          assetDefinitions: [],
          materialDefinitions: [],
          textureDefinitions: [],
          environmentDefinitions: [],
          shaderDefinitions: [shader]
        },
        compileProfile: "authoring-preview",
        materialDisposalGraceMs: 100
      });
      const binding: EffectiveShaderBinding = {
        shaderDefinitionId: shader.shaderDefinitionId,
        targetKind: shader.targetKind,
        documentRevision: shader.revision,
        parameterValues: {},
        textureBindings: {},
        parameterOverrides: []
      };
      const geometry = new THREE.BufferGeometry();

      const first = runtime.applyShader(binding, {
        targetKind: "mesh-surface",
        material: new THREE.MeshStandardMaterial(),
        geometry
      }) as THREE.Material;
      const second = runtime.applyShader(binding, {
        targetKind: "mesh-surface",
        material: new THREE.MeshStandardMaterial(),
        geometry
      }) as THREE.Material;

      expect(first).toBe(second);

      const disposeSpy = vi.spyOn(first, "dispose");
      runtime.releaseMaterial(first);
      runtime.invalidate(shader.shaderDefinitionId);

      vi.advanceTimersByTime(150);
      expect(disposeSpy).not.toHaveBeenCalled();

      runtime.releaseMaterial(second);
      vi.advanceTimersByTime(99);
      expect(disposeSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
      geometry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a bound Standard PBR basecolor texture authoritative over the carrier material tint", () => {
    const shader = createDefaultStandardPbrShaderGraph("project");
    const runtime = new ShaderRuntime({
      contentLibrary: normalizeContentLibrarySnapshot(
        {
          identity: {
            id: "project:content-library",
            schema: "ContentLibrarySnapshot",
            version: 1
          },
          assetDefinitions: [],
          materialDefinitions: [],
          textureDefinitions: [
            {
              definitionId: "project:texture:brick-base",
              definitionKind: "texture",
              displayName: "Brick Base",
              source: {
                relativeAssetPath: "assets/textures/brick-base.png",
                fileName: "brick-base.png",
                mimeType: "image/png"
              },
              colorSpace: "srgb",
              packing: "rgba"
            }
          ],
          environmentDefinitions: [],
          shaderDefinitions: [shader]
        },
        "project"
      ),
      compileProfile: "authoring-preview"
    });
    const material = new THREE.MeshStandardMaterial({
      color: 0x7a2018,
      emissive: 0x331100,
      vertexColors: true
    });
    const finalized = runtime.applyShaderSet(
      {
        surface: {
          shaderDefinitionId: shader.shaderDefinitionId,
          targetKind: "mesh-surface",
          documentRevision: shader.revision,
          parameterValues: {},
          textureBindings: {
            basecolor_texture: "project:texture:brick-base"
          },
          parameterOverrides: []
        },
        deform: null,
        effect: null
      },
      {
        material,
        geometry: new THREE.BoxGeometry(1, 1, 1)
      }
    ) as THREE.MeshStandardMaterial;

    // Standard-PBR now renders entirely through the shader graph:
    // colorNode / roughnessNode / metalnessNode / aoNode / normalNode
    // are the authoritative inputs to MeshStandardNodeMaterial. The
    // legacy `.color` / `.map` / `.emissive` / `.vertexColors` fields
    // are ignored by the WebGPU node material pipeline when the
    // corresponding Node is set, so whatever carrier state the imported
    // GLB material happened to ship with cannot leak into the rendered
    // surface. That guarantee is what this test now validates.
    const nodeMaterial = finalized as unknown as {
      colorNode: unknown;
      roughnessNode: unknown;
      metalnessNode: unknown;
      aoNode: unknown;
      normalNode: unknown;
    };
    expect(nodeMaterial.colorNode).toBeTruthy();
    expect(nodeMaterial.roughnessNode).toBeTruthy();
    expect(nodeMaterial.metalnessNode).toBeTruthy();
    expect(nodeMaterial.aoNode).toBeTruthy();
    expect(nodeMaterial.normalNode).toBeTruthy();
  });

  it("does not fall back to the carrier material map when no material texture binding exists", () => {
    const shader = createDefaultStandardPbrShaderGraph("project");
    const runtime = new ShaderRuntime({
      contentLibrary: normalizeContentLibrarySnapshot(
        {
          identity: {
            id: "project:content-library",
            schema: "ContentLibrarySnapshot",
            version: 1
          },
          assetDefinitions: [],
          materialDefinitions: [],
          textureDefinitions: [],
          environmentDefinitions: [],
          shaderDefinitions: [shader]
        },
        "project"
      ),
      compileProfile: "authoring-preview"
    });
    const carrierMaterial = new THREE.MeshStandardMaterial();
    carrierMaterial.map = new THREE.Texture();

    const finalized = runtime.applyShaderSet(
      {
        surface: {
          shaderDefinitionId: shader.shaderDefinitionId,
          targetKind: "mesh-surface",
          documentRevision: shader.revision,
          parameterValues: {},
          textureBindings: {},
          parameterOverrides: []
        },
        deform: null,
        effect: null
      },
      {
        material: carrierMaterial,
        geometry: new THREE.BoxGeometry(1, 1, 1)
      }
    ) as unknown as {
      colorNode: {
        type?: string;
        node?: {
          type?: string;
          isTextureNode?: boolean;
        };
      };
    };

    expect(finalized.colorNode).toBeTruthy();
    expect(finalized.colorNode.type).toBe("VarNode");
    expect(finalized.colorNode.node?.isTextureNode).not.toBe(true);
    expect(finalized.colorNode.node?.type).not.toBe("TextureNode");
  });

  it("reuses the finalized material across blob URL churn for the same TextureDefinition", () => {
    const shader = createDefaultStandardPbrShaderGraph("project");
    const runtime = new ShaderRuntime({
      contentLibrary: normalizeContentLibrarySnapshot(
        {
          identity: {
            id: "project:content-library",
            schema: "ContentLibrarySnapshot",
            version: 1
          },
          assetDefinitions: [],
          materialDefinitions: [],
          textureDefinitions: [
            {
              definitionId: "project:texture:brick-base",
              definitionKind: "texture",
              displayName: "Brick Base",
              source: {
                relativeAssetPath: "assets/textures/brick-base.png",
                fileName: "brick-base.png",
                mimeType: "image/png"
              },
              colorSpace: "srgb",
              packing: "rgba"
            }
          ],
          environmentDefinitions: [],
          shaderDefinitions: [shader]
        },
        "project"
      ),
      compileProfile: "authoring-preview"
    });
    const binding: EffectiveShaderBinding = {
      shaderDefinitionId: shader.shaderDefinitionId,
      targetKind: "mesh-surface",
      documentRevision: shader.revision,
      parameterValues: {},
      textureBindings: {
        basecolor_texture: "project:texture:brick-base"
      },
      parameterOverrides: []
    };
    const geometry = new THREE.BoxGeometry(1, 1, 1);

    const first = runtime.applyShaderSet(
      { surface: binding, deform: null, effect: null },
      {
        material: new THREE.MeshStandardMaterial(),
        geometry,
        fileSources: {
          "assets/textures/brick-base.png": "blob:first"
        }
      }
    );
    const second = runtime.applyShaderSet(
      { surface: binding, deform: null, effect: null },
      {
        material: new THREE.MeshStandardMaterial(),
        geometry,
        fileSources: {
          "assets/textures/brick-base.png": "blob:second"
        }
      }
    );

    // With the shared AuthoredAssetResolver, blob URL churn for the
    // SAME TextureDefinition does NOT invalidate the three.Texture
    // object — the resolver triggers an in-place image reload on the
    // existing texture. That in turn keeps the material cache hot so
    // Studio's frequent blob URL regenerations don't churn GPU state.
    expect(second).toBe(first);
  });
});
