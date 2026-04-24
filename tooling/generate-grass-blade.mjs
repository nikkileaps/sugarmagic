#!/usr/bin/env node
/**
 * Procedurally rasterize a stylized grass-blade PNG with soft antialiased
 * alpha edges. Output shape matches the procedural tapered-blade geometry
 * in packages/render-web/src/scatter/procedural.ts — uniform-ish ribbon,
 * slight mid bulge, pointy tip, V=0 at the blade root and V=1 at the tip.
 *
 * The texture is intentionally near-white (RGB ~ 1,1,1 inside) so the grass
 * shader's rootTint/tipTint/macro-noise parameters do all the coloring; this
 * PNG only contributes shape (via alpha) and a subtle internal luminance
 * variation so the blade doesn't read as flat. A tiny noise term on the
 * alpha pushes the silhouette off a clean geometric edge, which is what
 * made the previous procedural grass look vector-graphic cartoonish vs.
 * the soft painterly tree foliage.
 *
 * Usage: `node tooling/generate-grass-blade.mjs` writes
 * `assets/grass-blade.png` relative to the repo root.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "assets/grass-blade.png");

const WIDTH = 128;
const HEIGHT = 512;
const CENTER_X = (WIDTH - 1) / 2;

// Blade profile, matching packages/render-web/src/scatter/procedural.ts:
//   base:   baseHalfWidth = bladeWidth * 0.5  (half-width fraction 0.5 of total)
//   mid:    midHalfWidth  = bladeWidth * 0.55 (slight widening ~10%)
//   tip:    single point (half-width 0)
// In texture space, V=0 is the blade root (y=HEIGHT-1) and V=1 is the tip (y=0).
// We express half-widths as a fraction of WIDTH/2 so the shape fills the
// canvas centered on the vertical midline.
const BASE_HALF_FRACTION = 0.5;
const MID_HALF_FRACTION = 0.55;
const MID_V = 0.55;

function halfWidthAtV(v) {
  // Linear interpolation base → mid → tip.
  if (v <= MID_V) {
    const t = v / MID_V;
    return BASE_HALF_FRACTION + (MID_HALF_FRACTION - BASE_HALF_FRACTION) * t;
  }
  const t = (v - MID_V) / (1 - MID_V);
  return MID_HALF_FRACTION * (1 - t);
}

// Tiny sin-based hash for irregular alpha edges. Not cryptographically
// anything; just a cheap deterministic jitter source to push the blade
// boundary off a clean geometric line.
function hash(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function encodePng(width, height, rgba) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: prepend filter byte 0 (None) to each scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", idatData),
    writeChunk("IEND", Buffer.alloc(0))
  ]);
}

function writeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

// Table-driven CRC32 (PNG uses the same polynomial as IEEE 802.3)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function rasterize() {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  // Edge feather in pixels — how wide the alpha transition is at the blade
  // silhouette. Bigger = softer. 2.5 is tuned to look painterly at 1:1 but
  // not mushy when the texture is shrunk to a 10cm-wide blade in the world.
  const edgeFeather = 2.5;
  // Alpha noise amount — perturbs the silhouette boundary slightly so the
  // cutout traces an irregular line instead of a geometric one.
  const alphaNoiseAmount = 0.15;

  for (let py = 0; py < HEIGHT; py += 1) {
    const v = 1 - py / (HEIGHT - 1); // V=0 at bottom, V=1 at top
    const halfWidthFrac = halfWidthAtV(v);
    const halfWidthPx = halfWidthFrac * (WIDTH / 2);
    for (let px = 0; px < WIDTH; px += 1) {
      const dx = px - CENTER_X;
      const distFromEdge = halfWidthPx - Math.abs(dx); // positive inside, negative outside
      // Smooth alpha via feather distance
      let alpha = smoothstep(-edgeFeather, edgeFeather, distFromEdge);
      // Jitter the boundary with micro-noise so the silhouette reads as
      // painted, not vector.
      const jitter = (hash(px * 0.7, py * 0.15) - 0.5) * alphaNoiseAmount;
      alpha = Math.max(0, Math.min(1, alpha + jitter * smoothstep(-1.5, 1.5, distFromEdge)));

      // Internal luminance variation — slightly brighter along the blade
      // centerline, falling off toward edges. Subtle — the shader does the
      // real coloring.
      const centerBias = 1 - Math.abs(dx) / (halfWidthPx + 0.0001);
      const luminance = 0.88 + 0.12 * Math.max(0, Math.min(1, centerBias));
      // Micro-grain for painterly feel
      const grain = (hash(px * 0.9, py * 0.41) - 0.5) * 0.05;
      const value = Math.max(0, Math.min(1, luminance + grain));

      const idx = (py * WIDTH + px) * 4;
      rgba[idx] = Math.round(value * 255);
      rgba[idx + 1] = Math.round(value * 255);
      rgba[idx + 2] = Math.round(value * 255);
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

function main() {
  const rgba = rasterize();
  const png = encodePng(WIDTH, HEIGHT, rgba);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, png);
  console.log(
    `Wrote ${WIDTH}x${HEIGHT} RGBA grass-blade PNG to ${OUTPUT_PATH} (${png.length} bytes)`
  );
}

main();
