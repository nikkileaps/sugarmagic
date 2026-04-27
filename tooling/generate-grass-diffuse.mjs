#!/usr/bin/env node
/**
 * Procedurally rasterize a seamlessly-tileable painterly grass diffuse
 * map. Inspired by the texture from the "Making Grass with Triangles in
 * GLSL" Medium article — soft watercolor-like hue variation across a
 * green palette: deep teal shadows, mid forest green body, vivid
 * yellow-green mid-highlights, pale chartreuse tops.
 *
 * The grass shader samples this at high world-UV frequency to break up
 * uniform green into the busy, painterly color field references show. No
 * lighting math encoded — just hue and value variation.
 *
 * Usage: `node tooling/generate-grass-diffuse.mjs` writes
 * `assets/grass-diffuse.png` relative to the repo root.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_PATH = resolve(REPO_ROOT, "assets/grass-diffuse.png");

const WIDTH = 512;
const HEIGHT = 512;

// Palette stops (RGB in 0-1) mapped across the value range [0, 1]:
//   0.00 → deep teal-green (shadow pockets)
//   0.25 → forest green
//   0.55 → vivid green body
//   0.80 → bright yellow-green
//   1.00 → pale chartreuse highlight
// Linear interpolation across adjacent stops produces the smooth hue shift
// from cool shadows to warm highlights that's the painterly character.
const PALETTE = [
  { t: 0.0, rgb: [0.08, 0.25, 0.2] },
  { t: 0.25, rgb: [0.16, 0.36, 0.15] },
  { t: 0.55, rgb: [0.32, 0.55, 0.16] },
  { t: 0.8, rgb: [0.6, 0.78, 0.24] },
  { t: 1.0, rgb: [0.86, 0.93, 0.42] }
];

// Octaves of seamless value noise. Each octave has a cell grid that tiles
// across the output canvas exactly `cellsAcross` times, so the result is
// seamless-repeating. Amplitudes sum so lower frequencies dominate (big
// smooth washes) and higher frequencies add the small mottle detail.
const OCTAVES = [
  { cellsAcross: 3, amplitude: 1.0, seed: 17.3 },
  { cellsAcross: 7, amplitude: 0.55, seed: 41.7 },
  { cellsAcross: 17, amplitude: 0.3, seed: 71.1 },
  { cellsAcross: 37, amplitude: 0.16, seed: 103.9 }
];

function wrapMod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function hash2d(ix, iy, seed) {
  const n = Math.sin(ix * 12.9898 + iy * 78.233 + seed * 13.17) * 43758.5453123;
  return n - Math.floor(n);
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function seamlessValueNoise(u, v, cellsAcross, seed) {
  const x = u * cellsAcross;
  const y = v * cellsAcross;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const n = cellsAcross;
  const c00 = hash2d(wrapMod(ix, n), wrapMod(iy, n), seed);
  const c10 = hash2d(wrapMod(ix + 1, n), wrapMod(iy, n), seed);
  const c01 = hash2d(wrapMod(ix, n), wrapMod(iy + 1, n), seed);
  const c11 = hash2d(wrapMod(ix + 1, n), wrapMod(iy + 1, n), seed);
  const nx0 = c00 + (c10 - c00) * fx;
  const nx1 = c01 + (c11 - c01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

function sampleValueField(u, v) {
  let sum = 0;
  let maxAmp = 0;
  for (const octave of OCTAVES) {
    sum += seamlessValueNoise(u, v, octave.cellsAcross, octave.seed) * octave.amplitude;
    maxAmp += octave.amplitude;
  }
  return sum / maxAmp;
}

function paletteLookup(t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < PALETTE.length; i += 1) {
    const prev = PALETTE[i - 1];
    const curr = PALETTE[i];
    if (clamped <= curr.t) {
      const span = curr.t - prev.t;
      const k = span > 0 ? (clamped - prev.t) / span : 0;
      return [
        prev.rgb[0] + (curr.rgb[0] - prev.rgb[0]) * k,
        prev.rgb[1] + (curr.rgb[1] - prev.rgb[1]) * k,
        prev.rgb[2] + (curr.rgb[2] - prev.rgb[2]) * k
      ];
    }
  }
  return PALETTE[PALETTE.length - 1].rgb;
}

function rasterize() {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  // A second value field modulates the hue slightly so areas don't only
  // shift by value — we get subtle teal-vs-yellow-green pockets independent
  // of the main "darkness" axis, same as the reference's warm/cool local
  // variation.
  for (let py = 0; py < HEIGHT; py += 1) {
    const v = py / HEIGHT;
    for (let px = 0; px < WIDTH; px += 1) {
      const u = px / WIDTH;
      const value = sampleValueField(u, v);
      const [r, g, b] = paletteLookup(value);
      // Micro-grain pushes each pixel slightly to avoid looking
      // machine-smooth; amplitude tuned to be visible but not noisy.
      const grain = (hash2d(px * 0.91, py * 0.73, 3.14) - 0.5) * 0.04;
      const rg = Math.max(0, Math.min(1, r + grain));
      const gg = Math.max(0, Math.min(1, g + grain));
      const bg = Math.max(0, Math.min(1, b + grain));
      const idx = (py * WIDTH + px) * 4;
      rgba[idx] = Math.round(rg * 255);
      rgba[idx + 1] = Math.round(gg * 255);
      rgba[idx + 2] = Math.round(bg * 255);
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

// --- PNG encoding (same approach as generate-grass-blade.mjs) ---

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
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

function main() {
  const rgba = rasterize();
  const png = encodePng(WIDTH, HEIGHT, rgba);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, png);
  console.log(
    `Wrote ${WIDTH}x${HEIGHT} RGBA grass-diffuse PNG to ${OUTPUT_PATH} (${png.length} bytes)`
  );
}

main();
