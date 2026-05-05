/**
 * Dice helpers for mechanics expressions.
 *
 * Dice are deterministic under test by passing a seeded/random callback from
 * the evaluator or executor.
 */

export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
}

export function parseDiceSpec(source: string): DiceSpec {
  const match = source.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) {
    throw new Error(
      `Invalid dice literal "${source}". Expected NdM, NdM+K, or NdM-K.`
    );
  }
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || sides < 1) {
    throw new Error(
      `Invalid dice literal "${source}". Count and sides must be positive.`
    );
  }
  return { count, sides, modifier };
}

export function rollDice(
  source: string,
  rng: () => number = Math.random
): number {
  const spec = parseDiceSpec(source);
  let total = spec.modifier;
  for (let index = 0; index < spec.count; index += 1) {
    total += Math.floor(rng() * spec.sides) + 1;
  }
  return total;
}
