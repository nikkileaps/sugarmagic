/**
 * Verb form slots, and the ONLY sanctioned way to read a paradigm array.
 *
 * A dictionary entry stores each tense as a 6-element array. The array is
 * positional for size and lookup speed -- a paradigm is a fixed-shape table, and
 * naming every cell would triple the file for no information. But a bare index
 * is unreadable and silently wrong when someone miscounts, so NOTHING indexes
 * these arrays directly: every read goes through `formAt` / `PERSON_SLOT` below.
 *
 * If you find `forms.pres[3]` anywhere, that is a bug even when the number is
 * right -- it is the shape this module exists to prevent.
 */

/** Grammatical person + number, in the order the arrays are stored. */
export const PERSON_SLOT = {
  /** yo */
  firstSingular: 0,
  /** tu */
  secondSingular: 1,
  /** el / ella / usted */
  thirdSingular: 2,
  /** nosotros */
  firstPlural: 3,
  /** vosotros */
  secondPlural: 4,
  /** ellos / ellas / ustedes */
  thirdPlural: 5
} as const;

export type PersonSlot = keyof typeof PERSON_SLOT;

/** Stored tense keys. Deliberately short: they are repeated ~1,400 times on disk. */
export const TENSE_KEY = {
  present: "pres",
  preterite: "pret",
  imperfect: "imp"
} as const;

export type TenseName = keyof typeof TENSE_KEY;

/**
 * The paradigm as stored on a dictionary entry.
 *
 * Always 6 slots per tense, in PERSON_SLOT order. A slot is NULL when that
 * person does not exist for this verb -- `llover` has no first person, because
 * "I rain" is not a thing a speaker says. Null means THE FORM DOES NOT EXIST,
 * which is a different claim from an empty string or a missing entry, and it is
 * the claim a reviewer needs to be able to make.
 *
 * Keeping the array length fixed at 6 means position still equals person, so
 * `formAt` stays a lookup rather than a search.
 */
export interface VerbForms {
  /** Indicative present, 6 slots in PERSON_SLOT order; null where nonexistent. */
  pres: Array<string | null>;
  /** Indicative preterite, 6 slots. */
  pret: Array<string | null>;
  /** Indicative imperfect, 6 slots. */
  imp: Array<string | null>;
  /** Short keys, like the tenses: these repeat on ~1,400 entries on disk. */
  ger: string;
  part: string;
}

/**
 * Where a paradigm came from, so review is a queue rather than a guess.
 *
 * `generated` is machine output nobody has looked at -- the only state the
 * seeder is allowed to overwrite. `reviewed` means a human or an independent
 * model checked it and changed nothing, which is most of the work. `authored`
 * means someone wrote or corrected it by hand.
 */
export type FormsSource = "generated" | "reviewed" | "authored";

/**
 * Read one cell. The only supported way to get a form out of a paradigm.
 *
 * Returns null both for "this verb has no stored paradigm yet" and for "this
 * person does not exist for this verb". Callers treat them the same -- there is
 * no form to show either way -- and a caller that needs to tell them apart
 * should ask whether the entry has forms at all.
 */
export function formAt(
  forms: VerbForms | undefined,
  tense: TenseName,
  person: PersonSlot
): string | null {
  if (!forms) return null;
  const row = forms[TENSE_KEY[tense]];
  return row?.[PERSON_SLOT[person]] ?? null;
}

/**
 * Every surface in a paradigm, deduplicated.
 *
 * This is what the matcher wants: "is any form of this lemma present in this
 * text". Order is not meaningful to the caller, and duplicates are real --
 * `hablamos` is both present and preterite first-plural -- so they collapse.
 */
export function allForms(forms: VerbForms | undefined): string[] {
  if (!forms) return [];
  return [
    ...new Set([
      ...forms.pres,
      ...forms.pret,
      ...forms.imp,
      forms.ger,
      forms.part
    ])
  ].filter((form): form is string => form !== null && form.length > 0);
}
