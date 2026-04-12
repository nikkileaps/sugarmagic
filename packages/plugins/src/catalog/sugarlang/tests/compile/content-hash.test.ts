/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/content-hash.test.ts
 *
 * Purpose: Verifies the deterministic content hash used for scene lexicon cache keys.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Exercises ../../runtime/compile/content-hash and ../../runtime/compile/scene-traversal.
 *   - Depends on ./test-helpers for stable scene fixtures.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  SUGARLANG_COMPILE_PIPELINE_VERSION,
  computeSceneContentHash
} from "../../runtime/compile/content-hash";
import { collectSceneText } from "../../runtime/compile/scene-traversal";
import { createTestSceneAuthoringContext } from "./test-helpers";

describe("computeSceneContentHash", () => {
  it("returns the same hash for the same inputs", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());

    expect(
      computeSceneContentHash(blobs, "atlas-v1", SUGARLANG_COMPILE_PIPELINE_VERSION)
    ).toBe(
      computeSceneContentHash(blobs, "atlas-v1", SUGARLANG_COMPILE_PIPELINE_VERSION)
    );
  });

  it("changes when a blob changes", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());
    const changed = blobs.map((blob, index) =>
      index === 0 ? { ...blob, text: `${blob.text}!` } : blob
    );

    expect(
      computeSceneContentHash(blobs, "atlas-v1", SUGARLANG_COMPILE_PIPELINE_VERSION)
    ).not.toBe(
      computeSceneContentHash(changed, "atlas-v1", SUGARLANG_COMPILE_PIPELINE_VERSION)
    );
  });

  it("changes when atlasVersion changes", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());

    expect(
      computeSceneContentHash(blobs, "atlas-v1", SUGARLANG_COMPILE_PIPELINE_VERSION)
    ).not.toBe(
      computeSceneContentHash(blobs, "atlas-v2", SUGARLANG_COMPILE_PIPELINE_VERSION)
    );
  });

  it("changes when pipelineVersion changes", () => {
    const blobs = collectSceneText(createTestSceneAuthoringContext());

    expect(
      computeSceneContentHash(blobs, "atlas-v1", "1")
    ).not.toBe(computeSceneContentHash(blobs, "atlas-v1", "2"));
  });

  it("always returns a 64-character hex digest", () => {
    const hash = computeSceneContentHash(
      collectSceneText(createTestSceneAuthoringContext()),
      "atlas-v1",
      SUGARLANG_COMPILE_PIPELINE_VERSION
    );

    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});
