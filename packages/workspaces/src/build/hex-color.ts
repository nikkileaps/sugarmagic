/**
 * Authored colours that are stored as numbers, in the form a colour control
 * speaks.
 *
 * A light's colour and the environment's sun colour are both `number` on the
 * domain shape, the way three.js takes them. Every colour control in the
 * browser wants `"#rrggbb"`. This is the one place that crosses between them,
 * so a round trip through a picker cannot lose a digit in one workspace and
 * keep it in another.
 */

/** `0xffd9a0` -> `"#ffd9a0"`. */
export function hexColorString(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * `"#ffd9a0"` -> `0xffd9a0`, and anything unparseable -> `fallback`.
 *
 * Colour controls emit while the user drags, so a half-typed value arrives
 * here as a matter of course. Keeping the previous colour is the honest answer
 * to "I cannot read this yet"; black would be a wrong answer that looks
 * deliberate.
 */
export function hexColorNumber(value: string, fallback: number): number {
  const digits = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return fallback;
  return Number.parseInt(digits, 16);
}
