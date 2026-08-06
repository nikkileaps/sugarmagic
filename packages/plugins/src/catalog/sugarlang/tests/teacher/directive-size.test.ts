/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/directive-size.test.ts
 *
 * Purpose: The directive size report apportions honestly and refuses to guess.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { measureDirectiveSize } from "../../runtime/teacher/directive-size";

describe("measureDirectiveSize", () => {
  it("ranks fields by serialized size, biggest first", () => {
    const raw = JSON.stringify({
      short: "a",
      rationale: "x".repeat(200),
      middling: "y".repeat(50)
    });

    const report = measureDirectiveSize(raw, 100);

    expect(report?.fields.map((f) => f.field)).toEqual(["rationale", "middling", "short"]);
  });

  it("shares sum to the whole document", () => {
    // If they did not, a field could look cheap because the arithmetic leaked.
    const raw = JSON.stringify({
      targetVocab: { introduce: [{ kind: "vocabulary", lemmaId: "queso", lang: "es" }] },
      rationale: "Because the dock scene affords food words.",
      confidenceBand: "high"
    });

    const report = measureDirectiveSize(raw, 700);
    const summed = report!.fields.reduce((total, f) => total + f.share, 0);

    // Not exactly 1: the document's braces and commas belong to no field.
    expect(summed).toBeGreaterThan(0.9);
    expect(summed).toBeLessThanOrEqual(1);
  });

  it("apportions the REAL token count rather than inventing one", () => {
    const raw = JSON.stringify({ a: "x".repeat(100), b: "y".repeat(100) });

    const report = measureDirectiveSize(raw, 400);

    // Two near-equal fields split the real 400, rather than each being
    // estimated independently and summing to something else.
    const total = report!.fields.reduce((sum, f) => sum + (f.estimatedTokens ?? 0), 0);
    expect(total).toBeGreaterThan(340);
    expect(total).toBeLessThanOrEqual(400);
  });

  it("reports null tokens when the API gave no count, rather than zero", () => {
    // Zero would read as "this field is free", which is a lie.
    const report = measureDirectiveSize(JSON.stringify({ a: "hello" }), null);
    expect(report?.fields[0]!.estimatedTokens).toBeNull();
  });

  it("THE REGRESSION: a fenced response measures fine, it is not 'truncated'", () => {
    // This exact shape printed "unparseable response (2007 chars)" in live
    // play and read as a quality bug. It was not: the model wraps its JSON in
    // markdown fences and the real parse path strips them, while this
    // measurement did its own naive JSON.parse. One reading now, shared with
    // the parser.
    const inner = JSON.stringify({ rationale: "x".repeat(80), confidenceBand: "high" });
    const fenced = "```json\n" + inner + "\n```";

    const report = measureDirectiveSize(fenced, 500);

    expect(report).not.toBeNull();
    expect(report!.fields.map((f) => f.field).sort()).toEqual(["confidenceBand", "rationale"]);
    // Apportioned against the JSON, not the fence wrapper.
    expect(report!.totalChars).toBe(inner.length);
  });

  it("tolerates prose around the JSON, as the parser does", () => {
    const inner = JSON.stringify({ a: "hello" });
    const report = measureDirectiveSize("Here you go:\n" + inner + "\nHope that helps.", 50);
    expect(report?.fields[0]!.field).toBe("a");
  });

  it("THE TRUNCATION CASE: unparseable output returns null instead of a guess", () => {
    // A directive cut off mid-JSON at the token cap is the quality bug bkg is
    // watching for. It must not be silently apportioned as if it were whole.
    const truncated = '{"targetVocab":{"introduce":[{"kind":"vocab';
    expect(measureDirectiveSize(truncated, 900)).toBeNull();
  });

  it("refuses a JSON array or scalar", () => {
    expect(measureDirectiveSize("[1,2,3]", 10)).toBeNull();
    expect(measureDirectiveSize('"just a string"', 10)).toBeNull();
  });
});
