/**
 * scripts/data-prep/homograph-audit.test.ts
 *
 * Purpose: Catches the silent failure where an authored phrase means a VERB but
 *   the morphology index hands back a same-spelled noun, so the exponent
 *   teaches a word it does not contain.
 *
 * Relationships:
 *   - Reads data/languages/es/exponents.json and the morphology index.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";
import type { ExponentsFile, MorphologyFile } from "./competency-inventory";

type Atlas = {
  lemmas: Record<
    string,
    {
      lemmaId: string;
      partsOfSpeech: string[];
      forms?: Record<string, unknown>;
    }
  >;
};

/**
 * Surfaces some verb's paradigm produces. A token that is BOTH a standalone
 * non-verb headword and a form of a verb is the ambiguous class: the index can
 * only return one, and headwords win, so the verb reading is the one that goes
 * missing.
 */
function verbSurfaces(atlas: Atlas): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of Object.values(atlas.lemmas)) {
    const forms = entry.forms as Record<string, unknown> | undefined;
    if (!entry.partsOfSpeech.includes("verb") || !forms || !("pres" in forms)) {
      continue;
    }
    const surfaces = [
      ...(forms.pres as string[]),
      ...(forms.pret as string[]),
      ...(forms.imp as string[]),
      forms.ger as string,
      forms.part as string
    ];
    for (const surface of surfaces) {
      if (typeof surface !== "string") continue;
      found.set(surface, [...(found.get(surface) ?? []), entry.lemmaId]);
    }
  }
  return found;
}

/**
 * Phrases whose ambiguous token is CORRECTLY the noun or adjective. Listed so
 * that a new ambiguity has to be looked at by a person rather than absorbed
 * silently -- `en casa` is the house, not a conjugation of `casar`.
 */
const NOUN_READING_IS_CORRECT = new Set([
  "casa", "nada", "libro", "para", "falta", "pelo", "pescado", "cuenta",
  "regalo", "abierto", "frío", "gusto", "acuerdo", "largo", "corto", "talla",
  "cita", "ayuda", "encantado", "disculpa", "listo", "precio", "jubilado",
  "trabajo", "junto", "casado", "bajo", "divertido", "demasiado", "medio",
  "uno", "media", "vuelo", "río", "enfermo", "cansado", "sueño", "auxilio",
  "cuidado", "peligro", "supuesto", "como",
  // Added with A2. Each is the noun or adjective in every phrase that uses it:
  // `el año pasado`, `un pueblo pequeño`, `vivo en el centro`, `una cocina`.
  "camino", "cena", "centro", "cocina", "curso", "daño", "desayuno", "forma",
  "oído", "parte", "pasado", "paso", "piso", "pregunta", "pueblo", "recibo",
  "reserva", "retraso", "sala", "salado", "separado",
  // Added with B1. All nouns in every phrase that uses them -- `sin aviso`,
  // `en este caso`, `el pago`, `un resumen`. `pasa` and `espera` are NOT here:
  // "qué pasa con mi boleto" and "espera, lo estoy contando mal" are verbs and
  // carry overrides.
  "aviso", "calma", "cargo", "casco", "caso", "concierto", "contrato",
  "diferencia", "documento", "encargado", "equipo", "logro", "malentendido",
  "negocio", "pago", "peso", "proyecto", "puesto", "queja", "resumen",
  "sentido",
  // Added with B2. All nouns or adjectives in their phrases -- `eso es un
  // hecho`, `con todo respeto`, `contrato fijo`, `el juego de palabras`. This
  // band produced no verb-reading errors: its author applied 72 overrides
  // itself, which is the difference.
  "cambio", "completo", "concreto", "dato", "elogio", "entusiasmo", "envío",
  "fijo", "firma", "fotografía", "gobierno", "hecho", "juego", "molesto",
  "parecido", "partido", "pedido", "proceso", "receta", "registro", "respeto",
  "resto", "salvo", "seco", "tapa", "vacío",
  // Added with C1. All nouns or adjectives here -- `la espera fue larga`, `una
  // muestra pequeña`, `el olvido`, `tengo el mes lleno`.
  "adelantado", "burla", "causa", "copia", "despido", "duda", "duro",
  "entrega", "espera", "estudio", "exilio", "fuerza", "lista", "lleno",
  "muestra", "olvido", "reclamo", "resultado", "rodeo", "trato"
]);

/**
 * KNOWN LIMIT of this list: it is per TOKEN, not per phrase.
 *
 * `espera` is a noun in C1's "la espera fue larga" and a verb in B1's
 * "espera, lo estoy contando mal". The verb use carries an override, and
 * overrides are checked before this list, so both are correct today -- but a
 * FUTURE verb use of `espera` without an override would pass unflagged.
 *
 * Tightening this means keying on the phrase rather than the token, which
 * makes the list churn every time a phrase is edited. Left as is deliberately:
 * the check still catches a token the first time it appears anywhere, which is
 * when the decision actually gets made.
 */

describe("an authored phrase does not teach a word it does not contain", () => {
  it("THE ONE THAT MATTERS: every verb/noun ambiguity is decided deliberately", () => {
    // `son diez euros` taught `son` -- "sound, rhythm" -- instead of `ser`,
    // and shipped that way. Nothing failed, because the phrase parsed, every
    // word resolved, and the wrong lemma is a real word. The only way this
    // surfaces is by asking which tokens COULD have been a verb.
    const exponents = readJsonFile<ExponentsFile>(
      sugarlangDataPath("languages", "es", "exponents.json")
    );
    const morphology = readJsonFile<MorphologyFile>(
      sugarlangDataPath("languages", "es", "morphology.json")
    );
    const atlas = readJsonFile<Atlas>(
      sugarlangDataPath("languages", "es", "cefrlex.json")
    );
    const fromVerb = verbSurfaces(atlas);

    const undecided: string[] = [];
    for (const [competencyId, entries] of Object.entries(exponents.exponents)) {
      for (const entry of entries) {
        for (const wording of entry.wordings) {
          const tokens = wording.phrase
            .toLowerCase()
            .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
            .split(/\s+/)
            .filter(Boolean);

          for (const token of tokens) {
            if (wording.lemmas?.[token]) continue;      // decided by an override
            if (NOUN_READING_IS_CORRECT.has(token)) continue; // decided here
            const lemma = morphology.forms[token]?.lemmaId;
            if (!lemma || lemma !== token) continue;    // no ambiguity
            const pos = atlas.lemmas[lemma]?.partsOfSpeech ?? [];
            if (pos.includes("verb")) continue;
            if (!fromVerb.has(token)) continue;         // no verb reading exists

            undecided.push(
              `${competencyId} "${wording.phrase}": "${token}" resolves to the ` +
                `non-verb "${lemma}" but is also a form of ` +
                `${fromVerb.get(token)!.join("/")}. Add a lemmas override, or ` +
                `add it to NOUN_READING_IS_CORRECT if the noun is right.`
            );
          }
        }
      }
    }
    expect(undecided).toEqual([]);
  });
});
