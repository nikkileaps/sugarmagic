/**
 * JSON5 parser boundary for Mechanics editor input.
 *
 * Project files persist as strict JSON, but the Mechanics editor accepts JSON5
 * so designers can paste/comment examples. Runtime-core owns this parser
 * wrapper so Studio UI does not depend directly on a parser implementation.
 */
import JSON5 from "json5";

export function parseMechanicsJson5Input(input: string): unknown {
  return JSON5.parse(input);
}
