/**
 * Environment contract tests.
 *
 * Verifies the pure environment semantics that belong in domain/runtime-core:
 * preset application, sky-driven ambient computation, and post-process chain
 * resolution order. No Three.js objects are constructed here.
 */

import { describe, expect, it } from "vitest";
import {
  createBuiltInFogTintShaderId,
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot,
  getShaderDefinition,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  applyLightingPresetTemplate,
  computeSkyDrivenAmbient,
  expandShadowQuality,
  resolveEnvironmentWithPostProcessChain
} from "@sugarmagic/runtime-core";

function makeRegion(environmentId: string): RegionDocument {
  return {
    identity: { id: "region:one", schema: "RegionDocument", version: 1 },
    displayName: "Region One",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: { defaultEnvironmentId: environmentId },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeContentLibrary(): ContentLibrarySnapshot {
  const snapshot = createEmptyContentLibrarySnapshot("project");
  const definition = createDefaultEnvironmentDefinition("project", {
    definitionId: "project:environment:reference",
    displayName: "Reference",
    preset: "default"
  });

    return {
      ...snapshot,
      environmentDefinitions: [
        {
          ...definition,
          postProcessShaders: [
            {
              shaderDefinitionId: createBuiltInFogTintShaderId("project"),
              order: 0,
              enabled: true,
              parameterOverrides: []
            },
            {
              shaderDefinitionId: "project:shader:tonemap-reinhard",
              order: 2,
              enabled: true,
              parameterOverrides: []
            },
            {
              shaderDefinitionId: "project:shader:vignette",
              order: 3,
              enabled: false,
              parameterOverrides: []
            },
            {
              shaderDefinitionId: "project:shader:color-grade",
              order: 1,
              enabled: true,
              parameterOverrides: []
            }
          ]
        }
    ]
  };
}

describe("environment contract", () => {
  it("resolves the effective post-process chain in enabled order", () => {
    const contentLibrary = makeContentLibrary();
    const resolved = resolveEnvironmentWithPostProcessChain(
      makeRegion("project:environment:reference"),
      contentLibrary
    );

    expect(
      resolved.effectivePostProcessChain.map((binding) => binding.shaderDefinitionId)
    ).toEqual([
      "project:shader:fog-tint",
      "project:shader:color-grade",
      "project:shader:tonemap-reinhard"
    ]);
  });

  it("computes sky-driven ambient from the authored sky colors", () => {
    const ambient = computeSkyDrivenAmbient({
      enabled: true,
      mode: "gradient",
      topColor: 0x6699cc,
      bottomColor: 0xffcc88,
      horizonBlend: 0.5,
      gradientExponent: 1.5,
      saturation: 1,
      nebulaDensity: 0,
      nebulaSpeed: 0,
      riftEnabled: false,
      riftIntensity: 0,
      riftPulseSpeed: 0,
      riftSwirlStrength: 0,
      cloudsEnabled: false,
      cloudCoverage: 0,
      cloudSoftness: 0,
      cloudOpacity: 0,
      cloudScale: 1,
      cloudSpeed: 0,
      cloudDirectionDegrees: 0
    });

    expect(ambient.color).not.toBe(0x6699cc);
    expect(ambient.color).not.toBe(0xffcc88);
    expect(ambient.intensity).toBeGreaterThan(0);
    expect(ambient.intensity).toBeLessThanOrEqual(1);
  });

  it("applies the golden hour preset template as explicit authored lighting", () => {
    const definition = createDefaultEnvironmentDefinition("project", {
      definitionId: "project:environment:default",
      displayName: "Default",
      preset: "default"
    });
    const updated = applyLightingPresetTemplate(definition, "golden_hour", "project");

    expect(updated.lighting.preset).toBe("golden_hour");
    expect(updated.lighting.sun.color).not.toBe(definition.lighting.sun.color);
    expect(updated.lighting.sun.elevationDeg).not.toBe(definition.lighting.sun.elevationDeg);
    expect(updated.lighting.rim).not.toBeNull();
    expect(updated.atmosphere.fog.color).toBeGreaterThan(0);
  });

  it("builds fog tint with a normalized fog factor", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("project");
    const fogShader = getShaderDefinition(
      contentLibrary,
      createBuiltInFogTintShaderId("project")
    );

    expect(fogShader).not.toBeNull();
    expect(fogShader?.nodes.some((node) => node.nodeId === "one")).toBe(true);

    const subtractInput = fogShader?.edges.find(
      (edge) => edge.targetNodeId === "one-minus-exp" && edge.targetPortId === "a"
    );
    expect(subtractInput?.sourceNodeId).toBe("one");
  });

  // Story 3 (shadows): authored shadow quality maps to concrete GPU-facing
  // parameters. Each preset is fixed and documented in the epic, so these
  // tests double as regression guards against accidental table drift.
  it("expandShadowQuality returns the documented cascade + map + pcf numbers", () => {
    expect(expandShadowQuality("low")).toEqual({
      cascadeCount: 1,
      mapSize: 1024,
      pcfSamples: 1
    });
    expect(expandShadowQuality("medium")).toEqual({
      cascadeCount: 2,
      mapSize: 2048,
      pcfSamples: 4
    });
    expect(expandShadowQuality("high")).toEqual({
      cascadeCount: 3,
      mapSize: 2048,
      pcfSamples: 9
    });
    expect(expandShadowQuality("ultra")).toEqual({
      cascadeCount: 4,
      mapSize: 4096,
      pcfSamples: 16
    });
  });

  it("expandShadowQuality returns a fresh copy each call (no shared mutable state)", () => {
    const first = expandShadowQuality("high");
    first.cascadeCount = 99;
    const second = expandShadowQuality("high");
    expect(second.cascadeCount).toBe(3);
  });

  it("fresh environment definitions ship with enabled shadow defaults", () => {
    const definition = createDefaultEnvironmentDefinition("project", {
      definitionId: "project:environment:default",
      displayName: "Default",
      preset: "default"
    });
    expect(definition.lighting.sun.shadows.enabled).toBe(true);
    expect(definition.lighting.sun.shadows.quality).toBe("high");
    expect(definition.lighting.sun.shadows.distance).toBeGreaterThan(0);
  });
});
