/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/directive-size.ts
 *
 * Purpose: Where the Teacher's output tokens actually go, field by field.
 *
 * WHY THIS EXISTS
 *   A Teacher cache miss costs ~15s, and the call is not slow -- it is LONG:
 *   ~715 output tokens at a normal ~46 tok/s. Output is the only thing on the
 *   clock, because the prompt cache already makes input free. So the question
 *   worth answering before cutting anything is which FIELDS those tokens are
 *   in (sugarmagic-latency-bkg).
 *
 *   The story exists because a guess was nearly acted on: `rationale` was
 *   called dead weight for being read only by the console trace. It is not --
 *   it is the only window into WHY the Teacher slated what it slated, and
 *   nikki debugs with it. Whether it is worth its tokens is a question for a
 *   number, not for an argument.
 *
 * WHY CHARACTERS, APPORTIONED
 *   There is no tokenizer in the runtime, and shipping one to answer a
 *   measuring question would cost more than it settles. But the true output
 *   token count comes back on the same response, so per-field characters can
 *   be apportioned against it. That assumes token density is uniform across
 *   the JSON, which is roughly true within one document and false across very
 *   different content -- so these are ESTIMATES, and the estimate is labelled
 *   as one wherever it is printed. The character counts beside them are exact.
 *
 * Exports:
 *   - measureDirectiveSize
 *   - traceDirectiveSize
 *
 * Status: active -- delete with the bkg story once the cuts are made and
 *   verified on the turn timeline.
 */

import { extractJsonObjectCandidate } from "./schema-parser";

export interface DirectiveFieldSize {
  field: string;
  /** Exact: characters of this field's serialized value, including its key. */
  chars: number;
  /** Share of the whole document, 0-1. Exact. */
  share: number;
  /** ESTIMATE: share * the response's real output-token count. */
  estimatedTokens: number | null;
}

export interface DirectiveSizeReport {
  totalChars: number;
  /** The API's real count for the whole response, when known. */
  outputTokens: number | null;
  fields: DirectiveFieldSize[];
}

/**
 * Splits the directive JSON into its top-level fields by serialized size.
 *
 * Measures what the model WROTE -- the response text, fences stripped -- not
 * the parsed directive, which has been through normalization and repair and so
 * is no longer what the model was billed for. Whitespace the model emitted is
 * part of the cost and is deliberately kept.
 */
export function measureDirectiveSize(
  rawText: string,
  outputTokens: number | null
): DirectiveSizeReport | null {
  // Read the response exactly as the parser does. Measuring raw text directly
  // reported a perfectly healthy 2007-char directive as "truncated or fenced"
  // -- the model wraps its JSON in markdown fences, and the real parse path
  // strips them. Two readings of one response is how that lie happened.
  const candidate = extractJsonObjectCandidate(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Fences are handled above, so reaching here means the JSON is genuinely
    // malformed -- most likely cut off at the token cap, which is the quality
    // bug bkg outranks latency for. It cannot be apportioned by field; say
    // nothing rather than guess.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const totalChars = candidate.length;
  const fields = Object.entries(parsed as Record<string, unknown>)
    .map<DirectiveFieldSize>(([field, value]) => {
      // The key, its quotes, the colon and the separator are real characters
      // the model wrote, so a field is charged for its own name.
      const chars = JSON.stringify(value).length + field.length + 4;
      const share = totalChars === 0 ? 0 : chars / totalChars;
      return {
        field,
        chars,
        share,
        estimatedTokens: outputTokens === null ? null : Math.round(share * outputTokens)
      };
    })
    .sort((left, right) => right.chars - left.chars);

  return { totalChars, outputTokens, fields };
}

/**
 * Prints the report as one block, biggest field first.
 *
 * Prints rather than emits, for the same reason the turn timeline does: the
 * telemetry sink 404'd for nine days while everything believed it was
 * recording (sugarmagic-sugardeploy-fc2).
 */
export function traceDirectiveSize(
  rawText: string,
  outputTokens: number | null,
  /**
   * True for a background re-plan (7gp.1). Labelled because this block prints
   * mid-turn for work the turn never waited for, and reading it as the current
   * turn's cost is exactly the wrong conclusion.
   */
  backgroundReplan = false
): void {
  const tag = backgroundReplan ? "[directive-size BACKGROUND re-plan, off this turn's clock]" : "[directive-size]";
  const report = measureDirectiveSize(rawText, outputTokens);
  /* eslint-disable no-console */
  if (!report) {
    console.info(
      `${tag} MALFORMED directive JSON (${rawText.length} chars, outputTokens=${outputTokens ?? "?"}). Fences are handled, so this is likely truncation at the token cap -- a quality bug, not a latency one.`
    );
    return;
  }

  const rows = report.fields.map((entry) => {
    const percent = (entry.share * 100).toFixed(1);
    const tokens = entry.estimatedTokens === null ? "  ?" : String(entry.estimatedTokens);
    return `  ${entry.field.padEnd(22)} ${String(entry.chars).padStart(6)} chars  ${percent.padStart(5)}%  ~${tokens.padStart(4)} tok`;
  });

  console.info(
    [
      `${tag} ${report.totalChars} chars total, outputTokens=${report.outputTokens ?? "?"} (token column is an ESTIMATE, apportioned by character share)`,
      ...rows
    ].join("\n")
  );
  /* eslint-enable no-console */
}
