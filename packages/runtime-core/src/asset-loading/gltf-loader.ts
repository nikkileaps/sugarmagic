/**
 * packages/runtime-core/src/asset-loading/gltf-loader.ts
 *
 * The one place a `GLTFLoader` is built, so every loader in the game
 * can read the compressed models the deploy produces.
 *
 * The deploy compresses staged GLBs with Draco
 * (`scripts/compress-staged-glbs.ts`) and the engine build copies the
 * matching decoder into `dist/draco/`. A loader without the decoder
 * attached throws on the first compressed file it meets, so building
 * one by hand is a way to ship a game that cannot load its own models.
 *
 * Studio never meets a compressed file — it reads the project's
 * uncompressed originals through blob URLs — and `DRACOLoader` only
 * fetches its decoder when it first encounters Draco geometry, so the
 * `/draco/` path is never requested there.
 */

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

/**
 * Where the engine build writes the decoder. Site-relative, matching
 * the `dist/draco/` the Vite build produces.
 */
export const DRACO_DECODER_PATH = "/draco/";

/**
 * One decoder for the whole session. `DRACOLoader` owns a worker pool,
 * so a second instance means a second set of workers decoding the same
 * kind of file.
 */
let sharedDracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  }
  return sharedDracoLoader;
}

/** A `GLTFLoader` that can read both compressed and uncompressed GLBs. */
export function createGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  return loader;
}
