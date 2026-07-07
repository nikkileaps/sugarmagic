/**
 * apps/studio/src/character-wizard/weight-solver.worker.ts
 *
 * Plan 062 §062.6 — the geodesic weight solve runs here, off the
 * main thread, so the wizard's progress bar actually animates
 * during the seconds-long bake. character-rig is pure + DOM-free,
 * which is what makes it worker-loadable at all.
 */

import {
  GeodesicVoxelWeightSolver,
  type BoneSegment
} from "@sugarmagic/character-rig";

export interface WeightSolveRequest {
  positions: Float32Array;
  indices: Uint32Array;
  segments: BoneSegment[];
}

export type WeightSolveResponse =
  | { type: "progress"; fraction: number }
  | {
      type: "done";
      boneOrder: string[];
      joints: Uint16Array;
      weights: Float32Array;
    }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<WeightSolveRequest>) => {
  try {
    const { positions, indices, segments } = event.data;
    const result = new GeodesicVoxelWeightSolver().solve(
      { positions, indices },
      segments,
      {
        onProgress: (fraction) => {
          const message: WeightSolveResponse = { type: "progress", fraction };
          self.postMessage(message);
        }
      }
    );
    const done: WeightSolveResponse = {
      type: "done",
      boneOrder: result.boneOrder,
      joints: result.joints,
      weights: result.weights
    };
    self.postMessage(done, {
      transfer: [result.joints.buffer, result.weights.buffer]
    });
  } catch (error) {
    const message: WeightSolveResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(message);
  }
};
