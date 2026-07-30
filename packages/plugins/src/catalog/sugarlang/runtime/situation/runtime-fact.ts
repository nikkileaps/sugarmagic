/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/runtime-fact.ts
 *
 * Purpose: A runtime fact that may not be available, in a shape that makes
 *   "we don't know" impossible to confuse with "it's empty".
 *
 * WHY THIS TYPE EXISTS AT ALL
 *   Every runtime fact the situation reads is optional AND nullable in its own
 *   contract (`knownFacts?: string[] | null`) -- the signature of state nobody
 *   guarantees, because the blackboard is untyped raw state that may be missing
 *   for any number of reasons.
 *
 *   Left as `T | null | undefined`, the first thing anyone writes is
 *   `knownFacts ?? []`, and at that moment "the player has learned nothing yet"
 *   and "we have no idea what the player knows" become the same value. The
 *   Teacher then teaches confidently from a fact we never had.
 *
 *   This is the THIRD instance of one bug shape in this epic: `every` over an
 *   empty parts-of-speech array reading as "this is a function word", and
 *   `undefined === undefined` binning every unbanded lemma into one histogram
 *   bucket. Absent evidence read as evidence. Three occurrences is a pattern, so
 *   the fix here is a type that makes the collapse hard to write rather than a
 *   comment asking people not to.
 *
 * Exports:
 *   - RuntimeFact, runtimeFact, unavailable
 *   - isAvailable, factValue
 *
 * Relationships:
 *   - Used by ./situation for every field sourced from ConversationRuntimeContext.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

/**
 * Deliberately NOT `T | undefined`. The discriminant forces a reader to say
 * which case they are handling, where `??` would silently pick one.
 */
export type RuntimeFact<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false };

const UNAVAILABLE: RuntimeFact<never> = { available: false };

/** A fact we could not read. Not an error -- the normal case. */
export function unavailable<T>(): RuntimeFact<T> {
  return UNAVAILABLE as RuntimeFact<T>;
}

/**
 * Lifts a raw optional/nullable runtime value.
 *
 * `null` and `undefined` both mean unavailable -- the blackboard uses them
 * interchangeably and no caller should have to know which it got. Every OTHER
 * value is available, INCLUDING an empty array and an empty string: "the player
 * has learned nothing" is a fact, and flattening it to unavailable here would
 * reintroduce exactly the collapse this type exists to prevent.
 */
export function runtimeFact<T>(value: T | null | undefined): RuntimeFact<T> {
  return value === null || value === undefined ? unavailable<T>() : { available: true, value };
}

export function isAvailable<T>(
  fact: RuntimeFact<T>
): fact is { readonly available: true; readonly value: T } {
  return fact.available;
}

/**
 * Reads the value, or `undefined` when unavailable.
 *
 * Provided for the few places that genuinely do not care about the difference
 * (logging, a debug readout). Anything that RENDERS to the Teacher must branch
 * on `available` instead, or it will state something we do not know.
 */
export function factValue<T>(fact: RuntimeFact<T>): T | undefined {
  return fact.available ? fact.value : undefined;
}
