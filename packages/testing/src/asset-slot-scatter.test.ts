import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEmptyContentLibrarySnapshot } from "@sugarmagic/domain";
import type { EffectiveMaterialSlotBinding } from "@sugarmagic/runtime-core";
import {
  buildScatterInstancesForAssetSlot,
  createAuthoredAssetResolver
} from "@sugarmagic/render-web";

describe("asset-slot scatter", () => {
  it("builds scatter instances only for the targeted asset slot", () => {
    const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
    const rockDefinition = contentLibrary.rockTypeDefinitions?.[0];
    if (!rockDefinition) {
      throw new Error("Expected starter rock definition.");
    }

    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(2, 0.5, 2);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    roofMaterial.name = "Roof";
    const mesh = new THREE.Mesh(geometry, roofMaterial);
    root.add(mesh);

    const slot: EffectiveMaterialSlotBinding = {
      slotName: "Roof",
      slotIndex: 0,
      materialDefinitionId: null,
      surface: {
        context: "universal",
        diagnostics: [],
        layers: [
          {
            kind: "scatter",
            layerId: "roof-rocks",
            displayName: "Roof Rocks",
            enabled: true,
            opacity: 1,
            mask: { kind: "always" },
            contentKind: "rocks",
            definitionId: rockDefinition.definitionId,
            definition: rockDefinition,
            materialDefinitionId: null,
            appearanceBinding: null,
            density: 6,
            wind: null
          }
        ]
      }
    };

    const builds = buildScatterInstancesForAssetSlot(root, slot, {
      contentLibrary,
      assetResolver: createAuthoredAssetResolver(),
      shaderRuntime: {} as never
    });

    expect(builds).toHaveLength(1);
    expect(builds[0]?.root.children.length ?? 0).toBeGreaterThan(0);

    for (const build of builds) {
      build.dispose();
    }
    geometry.dispose();
    roofMaterial.dispose();
  });
});
