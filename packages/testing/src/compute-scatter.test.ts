/**
 * Compute scatter tests.
 *
 * Verifies Story 36.16's deterministic CPU emulation helpers
 * (`simulateScatterCandidateBuild`, `simulateScatterVisibility`) — the
 * pure-JS reference behavior that the WebGPU compute kernels mirror.
 * The corresponding WebGPU integration test was removed because vitest
 * runs in node here without `navigator.gpu`; revisit if the project
 * adopts a browser test runner.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createEmptyContentLibrarySnapshot,
  createInlineSurfaceBinding,
  createScatterLayer,
  createSurface
} from "@sugarmagic/domain";
import { resolveSurfaceBinding, type ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import {
  buildSurfaceScatterLayer,
  createAuthoredAssetResolver,
  createScatterComputeLayerParams,
  packScatterSampleInputs,
  simulateScatterCandidateBuild,
  simulateScatterVisibility,
  type SurfaceScatterSample
} from "@sugarmagic/render-web";

function makeScatterLayer(): ResolvedScatterLayer {
  const contentLibrary = createEmptyContentLibrarySnapshot("little-world");
  const grassDefinitions = contentLibrary.grassTypeDefinitions ?? [];
  const grassTypeId = grassDefinitions[0]?.definitionId;
  if (!grassTypeId) {
    throw new Error("Expected built-in grass definitions.");
  }

  const binding = createInlineSurfaceBinding(
    createSurface([
      createAppearanceLayer(createColorAppearanceContent(0x5b8a49), {
        displayName: "Ground",
        blendMode: "base"
      }),
      createScatterLayer(
        {
          kind: "grass",
          grassTypeId
        },
        {
          displayName: "Tall Grass",
          opacity: 1
        }
      )
    ])
  );

  const result = resolveSurfaceBinding(binding, contentLibrary, "landscape-only");
  if (!result.ok) {
    throw new Error(
      `Failed to resolve test scatter layer: ${result.diagnostic.message}`
    );
  }

  const scatterLayer = result.binding.layers.find(
    (layer): layer is ResolvedScatterLayer => layer.kind === "scatter"
  );
  if (!scatterLayer) {
    throw new Error("Expected resolved scatter layer.");
  }

  return scatterLayer;
}

function makeSamples(): SurfaceScatterSample[] {
  const samples: SurfaceScatterSample[] = [];
  const positions: Array<[number, number, number]> = [
    [-2, 0, -2],
    [-1.2, 0, -1.1],
    [-0.5, 0, -0.4],
    [0, 0, 0],
    [1.2, 0, 0.8],
    [2, 0, 1.5],
    [8, 0, 0],
    [11, 0, 0]
  ];
  const coverageWeights = [1, 0.9, 0.75, 1, 0.6, 0.35, 1, 1];

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index]!;
    samples.push({
      position,
      normal: [0, 1, 0],
      uv: [0.1 * index, 0.05 * index],
      height: position[1],
      coverageWeight: coverageWeights[index],
      splatmapWeights: null,
      vertexColor: null
    });
  }

  return samples;
}

describe("compute scatter", () => {
  it("matches the CPU fallback accepted-instance count for the same density grid", () => {
    const scatterLayer = makeScatterLayer();
    const samples = makeSamples();
    const densityWeights = samples.map((sample) => sample.coverageWeight ?? 1);
    const packed = packScatterSampleInputs(samples, densityWeights);
    const params = createScatterComputeLayerParams(
      scatterLayer,
      new THREE.PlaneGeometry(1, 1, 1, 1)
    );
    const simulated = simulateScatterCandidateBuild(packed, params);
    const expectedAcceptedCount = simulated.filter((candidate) => candidate.accepted).length;

    const build = buildSurfaceScatterLayer(scatterLayer, samples, {
      contentLibrary: createEmptyContentLibrarySnapshot("little-world"),
      assetResolver: createAuthoredAssetResolver(),
      enableGpuCompute: false
    });

    const mesh = build.root.children[0] as THREE.InstancedMesh | undefined;
    expect(mesh).toBeTruthy();
    expect(Math.abs((mesh?.count ?? 0) - expectedAcceptedCount)).toBeLessThanOrEqual(1);

    build.dispose();
  });

  it("culls by frustum and distance while carrying world-space instance origins", () => {
    const scatterLayer = makeScatterLayer();
    const samples = makeSamples();
    const densityWeights = new Array(samples.length).fill(1);
    const packed = packScatterSampleInputs(samples, densityWeights);
    const params = createScatterComputeLayerParams(
      scatterLayer,
      new THREE.PlaneGeometry(1, 1, 1, 1),
      {
        maxDrawDistance: 8
      }
    );
    const simulated = simulateScatterCandidateBuild(packed, params);
    const ownerMatrixWorld = new THREE.Matrix4().identity();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50);
    camera.position.set(0, 3, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const visibility = simulateScatterVisibility(
      simulated,
      ownerMatrixWorld,
      camera,
      params
    );

    expect(visibility.visibleIndices.length).toBeGreaterThan(0);
    expect(visibility.visibleIndices.length).toBeLessThan(
      simulated.filter((candidate) => candidate.accepted).length
    );

    const firstVisibleCandidate = simulated[visibility.visibleIndices[0]!]!;
    const expectedWorld = firstVisibleCandidate.liftedLocalPosition
      .clone()
      .applyMatrix4(ownerMatrixWorld);
    expect(visibility.worldOriginsXZ[0]).toEqual([expectedWorld.x, expectedWorld.z]);
  });

});
