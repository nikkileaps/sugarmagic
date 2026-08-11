/**
 * packages/testing/src/bloom-parameters.test.ts
 *
 * Purpose: A bloom parameter a project authored is the one bloom uses.
 *
 * THE BUG THIS LOCKS OUT
 *   Shader parameters materialize as TSL LITERALS rather than uniforms, and
 *   `float(0.75)` is a VarNode wrapping the ConstNode that actually holds the
 *   number. The reader looked for `.value` on the outer node, found nothing,
 *   and returned its fallback -- so bloom ran at strength 0.4, radius 0.4 and
 *   threshold 0.9 whatever the project said, and changing any of them did
 *   nothing whatsoever.
 *
 *   It is the shape that hides best: the feature works, the parameters exist,
 *   the editor writes them, and the only symptom is that authoring has no
 *   effect. It cost an afternoon here and, by the author's account, an
 *   afternoon in the previous engine too.
 *
 * WHY THIS TEST GOES THROUGH THE REAL NODE
 *   Asserting on a hand-built `{value: n}` is what let this through in the
 *   first place -- that shape passes the old reader happily. The literal has
 *   to come from `three/tsl`, or the test proves nothing about what runs.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { float, uniform } from "three/tsl";
import {
  materializeEffectOp,
  type EffectMaterializeContext,
  type MaterializeOpRequest
} from "@sugarmagic/render-web";

/** What the materializer is handed for a parameter-fed port. */
function literal(value: number): unknown {
  return float(value);
}

function materializeBloom(inputs: Record<string, unknown>): {
  strength: number;
  radius: number;
  threshold: number;
} {
  const request: MaterializeOpRequest = {
    op: {
      opId: `bloom-${JSON.stringify(Object.keys(inputs))}`,
      opKind: "effect.bloom-pass"
    } as MaterializeOpRequest["op"],
    input: ((port: string) => inputs[port]) as MaterializeOpRequest["input"]
  };
  const context: EffectMaterializeContext = {
    effectNodes: new Map(),
    builtinSceneDepthNode: null
  };
  const result = materializeEffectOp(request, context) as {
    handled: boolean;
    value: unknown;
  };
  const node = result.value as {
    strength: { value: number };
    radius: { value: number };
    threshold: { value: number };
  };
  return {
    strength: node.strength.value,
    radius: node.radius.value,
    threshold: node.threshold.value
  };
}

describe("bloom uses the parameters a project authored", () => {
  it("THE ONE THAT MATTERS: reads a TSL literal rather than falling back", () => {
    const bloom = materializeBloom({
      input: float(0),
      strength: literal(1),
      radius: literal(0.8),
      threshold: literal(0)
    });

    // Every one of these was previously the fallback: 0.4, 0.4, 0.9.
    expect(bloom.strength).toBe(1);
    expect(bloom.radius).toBe(0.8);
    expect(bloom.threshold).toBe(0);
  });

  it("a threshold of zero survives, rather than reading as absent", () => {
    // Zero is the value most likely to be lost by a truthiness check, and it
    // is a meaningful setting: bloom everything, not just highlights.
    const bloom = materializeBloom({
      input: float(0),
      strength: literal(0.5),
      radius: literal(0.5),
      threshold: literal(0)
    });
    expect(bloom.threshold).toBe(0);
  });

  it("still reads a uniform, in case parameters ever go back to being one", () => {
    const bloom = materializeBloom({
      input: float(0),
      strength: uniform(0.25),
      radius: literal(0.5),
      threshold: literal(0.5)
    });
    expect(bloom.strength).toBe(0.25);
  });

  it("falls back only when there is genuinely no number to find", () => {
    const bloom = materializeBloom({ input: float(0) });
    expect(bloom.strength).toBe(0.4);
    expect(bloom.radius).toBe(0.4);
    expect(bloom.threshold).toBe(0.9);
  });
});
