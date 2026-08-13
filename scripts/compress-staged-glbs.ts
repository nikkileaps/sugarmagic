/**
 * Compress the GLB files in a staged deploy directory with Draco.
 *
 * Run by the generated deploy workflow after the project's assets are
 * staged and before the boot.json URLs are stamped, so the content
 * hashes cover the compressed bytes. It rewrites the STAGED COPY only —
 * the project's own files are never touched, which is what keeps Studio
 * reading uncompressed originals and keeps the Studio bakes (which
 * round-trip GLBs through GLTFExporter and would decompress them)
 * working.
 *
 * Usage:
 *   npx tsx scripts/compress-staged-glbs.ts <staged-directory>
 *
 * Draco compresses geometry and nothing else: an animation clip or a
 * GLB whose bytes are mostly embedded textures barely moves. Measured
 * on wordlark's 58 referenced GLBs: 44.84 MiB -> 32.48 MiB.
 *
 * Fails the deploy on the first file that will not compress. A deploy
 * is a build pass, and a game missing a model is worse than a deploy
 * that stopped and said why.
 */

import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Pinned to an exact patch. The deploy stamps each asset URL with a
 * hash of its compressed bytes, so a compressor that changed under us
 * would change every hash and re-download every model — the thing the
 * content hashing exists to prevent. Draco is deterministic at a fixed
 * version; it is not guaranteed to be across versions.
 */
const GLTF_TRANSFORM_VERSION = "@gltf-transform/cli@4.4.2";

function findGlbFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...findGlbFiles(full));
    } else if (entry.name.toLowerCase().endsWith(".glb")) {
      found.push(full);
    }
  }
  return found;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Is this still a binary GLB?
 *
 * gltf-transform picks its output format from the FILE EXTENSION. Give
 * it anything it does not recognise as `.glb` and it happily writes
 * glTF JSON plus loose `.bin` and texture sidecars instead — a file a
 * tenth the size that the game cannot load, reported as a spectacular
 * compression ratio. Size alone cannot tell the two apart, so check the
 * magic.
 */
function isBinaryGlb(path: string): boolean {
  const handle = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    readSync(handle, header, 0, 4, 0);
    return header.toString("ascii") === "glTF";
  } finally {
    closeSync(handle);
  }
}

function main(): void {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: compress-staged-glbs.ts <staged-directory>");
    process.exit(1);
  }

  const files = findGlbFiles(directory);
  if (files.length === 0) {
    console.log(`No .glb files under ${directory}; nothing to compress.`);
    return;
  }

  let before = 0;
  let after = 0;
  for (const file of files) {
    const sizeBefore = statSync(file).size;
    // Writes through a temp path so a failure leaves the staged file
    // intact. The `.glb` suffix is load-bearing: gltf-transform reads
    // the output FORMAT off the extension, and any other suffix makes
    // it emit glTF JSON with sidecar files instead.
    const temporary = `${file}.compressing.glb`;
    try {
      execFileSync(
        "npx",
        ["-y", GLTF_TRANSFORM_VERSION, "draco", file, temporary],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      if (!isBinaryGlb(temporary)) {
        console.error(
          `::error::${file} did not come back as a binary GLB. ` +
            "Refusing to stage a file the game cannot load."
        );
        process.exit(1);
      }
      renameSync(temporary, file);
    } catch (error) {
      const detail =
        error instanceof Error && "stderr" in error
          ? String((error as { stderr?: Buffer }).stderr ?? error.message)
          : String(error);
      console.error(`::error::Failed to compress ${file}: ${detail}`);
      process.exit(1);
    }
    const sizeAfter = statSync(file).size;
    before += sizeBefore;
    after += sizeAfter;
    console.log(
      `  ${file}: ${mib(sizeBefore)} -> ${mib(sizeAfter)}` +
        ` (${(100 - (sizeAfter / sizeBefore) * 100).toFixed(1)}% smaller)`
    );
  }

  const saved = before - after;
  console.log(
    `Compressed ${files.length} GLB(s): ${mib(before)} -> ${mib(after)},` +
      ` saved ${mib(saved)} (${((saved / before) * 100).toFixed(1)}%).`
  );
}

main();
