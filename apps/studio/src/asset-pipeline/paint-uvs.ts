/**
 * Paint UV generation (Plan 068.8).
 *
 * Bakes a PAINT UV channel (TEXCOORD_1, three attribute "uv1") into an
 * imported GLB: unique, non-overlapping islands that painted masks
 * sample instead of the authored UVs (which overlap on real assets --
 * the outcrop covered the UV square 6.4x and painted confetti).
 *
 * Uses xatlas (MIT; the Godot lightmap-UV2 pattern) through the
 * xatlas-three worker wrapper; the wasm + worker js are vendored under
 * public/xatlas/ (see NOTICE.txt there). Meshes that already carry a
 * TEXCOORD_1 (e.g. authored via Blender's geometry-nodes unwrap) are
 * left untouched -- bring-your-own beats generate.
 *
 * xatlas SPLITS vertices at chart boundaries, so this is a mesh
 * re-emit (GLTFExporter), not an attribute append. Authored UVs,
 * materials, and hierarchy ride through the exporter unchanged.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { UVUnwrapper } from "xatlas-three";

export interface PaintUvBakeOptions {
  /** Texels of padding between islands -- load-bearing: soft brushes
   *  bleed across island borders without it. */
  padding?: number;
  /** Atlas packing resolution (texel budget for island layout). */
  resolution?: number;
}

export interface PaintUvBakeResult {
  glb: ArrayBuffer;
  unwrappedMeshCount: number;
  skippedExistingCount: number;
}

/** Injectable for tests -- production uses the xatlas worker; tests
 *  inject a stub so the loader->bake->export glue runs in node. */
export type GeometryUnwrapFn = (
  geometry: THREE.BufferGeometry
) => Promise<void>;

const DEFAULT_PADDING = 4;
const DEFAULT_RESOLUTION = 1024;

let unwrapperPromise: Promise<UVUnwrapper> | null = null;

function getUnwrapper(options: PaintUvBakeOptions): Promise<UVUnwrapper> {
  if (!unwrapperPromise) {
    const unwrapper = new UVUnwrapper(
      { BufferAttribute: THREE.BufferAttribute },
      {
        padding: options.padding ?? DEFAULT_PADDING,
        resolution: options.resolution ?? DEFAULT_RESOLUTION,
        rotateCharts: true
      }
    );
    // ABSOLUTE URLs: the unwrapper runs in a blob-URL worker, whose
    // base URL cannot resolve root-relative paths ("Failed to parse
    // URL" from WorkerGlobalScope fetch).
    unwrapperPromise = unwrapper
      .loadLibrary(
        () => {},
        new URL("/xatlas/xatlas.wasm", window.location.origin).href,
        new URL("/xatlas/xatlas.js", window.location.origin).href
      )
      .then(() => unwrapper);
  }
  return unwrapperPromise;
}

async function unwrapWithXatlas(
  geometry: THREE.BufferGeometry,
  options: PaintUvBakeOptions
): Promise<void> {
  const unwrapper = await getUnwrapper(options);
  // The wrapper's API predates three's uv2 -> uv1 rename; it writes
  // to a literal attribute named by `outputUv`. Emit to "uv2", then
  // move to "uv1" so GLTFExporter maps it to TEXCOORD_1.
  await unwrapper.unwrapGeometry(
    geometry,
    "uv2",
    geometry.getAttribute("uv") ? "uv" : undefined
  );
  const painted = geometry.getAttribute("uv2");
  if (!painted) {
    throw new Error("xatlas produced no output UV attribute.");
  }
  geometry.setAttribute("uv1", painted);
  geometry.deleteAttribute("uv2");
}

/**
 * The xatlas wrapper rebuilds attributes with `normalized: true` on
 * float data (unit-length confusion). glTF-invalid, and WebGPU has no
 * normalized float vertex formats -- the baked mesh crashed
 * createRenderPipeline. Float attributes are never "normalized" in
 * the GPU sense; strip the flag on every geometry we re-emit.
 */
function sanitizeFloatAttributes(geometry: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (
      attribute instanceof THREE.BufferAttribute &&
      attribute.array instanceof Float32Array &&
      attribute.normalized
    ) {
      attribute.normalized = false;
    }
  }
}

export async function bakePaintUvsIntoGlb(
  glb: ArrayBuffer,
  options: PaintUvBakeOptions = {},
  unwrapGeometry: GeometryUnwrapFn = (geometry) =>
    unwrapWithXatlas(geometry, options)
): Promise<PaintUvBakeResult> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(glb.slice(0), "");

  const pending: THREE.BufferGeometry[] = [];
  let skippedExistingCount = 0;
  const seen = new Set<THREE.BufferGeometry>();
  gltf.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    if (seen.has(geometry)) return;
    seen.add(geometry);
    if (geometry.getAttribute("uv1")) {
      skippedExistingCount += 1;
      return;
    }
    pending.push(geometry);
  });

  for (const geometry of pending) {
    await unwrapGeometry(geometry);
  }
  // ALL geometries, not just freshly unwrapped ones: re-running the
  // bake must repair files poisoned by the earlier normalized-float
  // bug even though their unwrap is skipped.
  for (const geometry of seen) {
    sanitizeFloatAttributes(geometry);
  }

  const exporter = new GLTFExporter();
  const exported = (await exporter.parseAsync(gltf.scene, {
    binary: true
  })) as ArrayBuffer;

  return {
    glb: exported,
    unwrappedMeshCount: pending.length,
    skippedExistingCount
  };
}
