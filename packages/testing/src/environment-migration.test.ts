/**
 * Environment migration tests.
 *
 * Guards the content-library upgrade path that turns legacy preset/scalar
 * environments into explicit authored lighting plus built-in post-process
 * bindings for fog and bloom.
 */

import { describe, expect, it } from "vitest";
import {
  createBuiltInBloomShaderId,
  createBuiltInFogTintShaderId,
  normalizeContentLibrarySnapshot,
  type ContentLibrarySnapshot
} from "@sugarmagic/domain";

function makeLegacyContentLibrary(): ContentLibrarySnapshot {
  return {
    identity: {
      id: "project:content-library",
      schema: "ContentLibrary",
      version: 1
    },
    assetDefinitions: [],
    shaderDefinitions: [],
    environmentDefinitions: [
      {
        definitionId: "project:environment:legacy",
        definitionKind: "environment",
        displayName: "Legacy Environment",
        postProcessShaders: [],
        lighting: {
          preset: "golden_hour",
          adjustments: {
            ambientIntensity: 0.7,
            keyIntensity: 1.15,
            shadowDarkness: 0.4,
            warmth: 0.3
          }
        },
        atmosphere: {
          fog: {
            enabled: true,
            density: 0.008
          },
          bloom: {
            enabled: true,
            strength: 0.6,
            radius: 0.3,
            threshold: 0.8
          },
          ssao: {
            enabled: false,
            kernelRadius: 8,
            minDistance: 0.005,
            maxDistance: 0.1
          },
          sky: {
            enabled: true,
            mode: "gradient",
            topColor: 0x5aa8e8,
            bottomColor: 0xf8d1a0,
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
          }
        },
        backdrop: {
          cityscapeEnabled: false,
          bufferZoneEnabled: false
        }
      }
    ]
  } as unknown as ContentLibrarySnapshot;
}

describe("environment migration", () => {
  it("upgrades legacy fog into a built-in fog-tint binding that mirrors authored settings", () => {
    const normalized = normalizeContentLibrarySnapshot(
      makeLegacyContentLibrary(),
      "project"
    );
    const definition = normalized.environmentDefinitions[0]!;
    const fogBinding = definition.postProcessShaders.find(
      (binding) =>
        binding.shaderDefinitionId === createBuiltInFogTintShaderId("project")
    );

    expect(normalized.identity.version).toBe(2);
    expect(fogBinding).toBeTruthy();
    expect(fogBinding?.enabled).toBe(true);
    expect(
      fogBinding?.parameterOverrides.find((override) => override.parameterId === "density")
        ?.value
    ).toBe(0.008);
    expect(definition.atmosphere.fog.color).toBeGreaterThan(0);
  });

  it("moves legacy bloom into a built-in bloom binding and drops the old field", () => {
    const normalized = normalizeContentLibrarySnapshot(
      makeLegacyContentLibrary(),
      "project"
    );
    const definition = normalized.environmentDefinitions[0]!;
    const bloomBinding = definition.postProcessShaders.find(
      (binding) =>
        binding.shaderDefinitionId === createBuiltInBloomShaderId("project")
    );

    expect(bloomBinding).toBeTruthy();
    expect(
      bloomBinding?.parameterOverrides.find((override) => override.parameterId === "strength")
        ?.value
    ).toBe(0.6);
    expect("bloom" in (definition.atmosphere as Record<string, unknown>)).toBe(false);
  });
});
