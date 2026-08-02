# How to author a sugarlang dictionary

The prompt and the rules for creating or extending a per-language dictionary
(`data/languages/<lang>/cefrlex.json`). Give this to a capable model, one batch
at a time.

There is no importer. Dictionaries were seeded once from a CEFR word list to get
a baseline of lemmas and levels; everything since is authored and reviewed. A
model does this better than any conjugation library — measured, not assumed:
`spanish-verbs` got 17 of 29 known irregulars wrong and `spanishconjugator` 26,
including `pedir` -> `pedo`. Both are correct on regular verbs and unreliable on
exactly the high-frequency verbs a beginner meets first.

## THE ONE RULE

**Fill gaps. Never overwrite.**

An entry carries provenance. A pass may write a field only where it is absent,
or where provenance says `generated` and nobody has looked at it. A human or
model correction is permanent, and re-running any pass must be safe. This is the
shape `scripts/generate-atlas-glosses.ts` already uses: select the entries
missing what you are adding, write only those.

## The entry

```jsonc
{
  "lemmaId": "empezar",          // the headword, lowercase, no article
  "lang": "es",
  "cefrPriorBand": "A1",         // A1 A2 B1 B2 C1  (see BANDS)
  "frequencyRank": 92,           // or null — see FREQUENCY
  "partsOfSpeech": ["verb"],     // one or more
  "cefrPriorSource": "cefrlex",  // where the BAND came from
  "glosses": { "en": "begin, start" },
  "forms": { ... },              // verbs only — see FORMS
  "formsSource": "authored"      // where the FORMS came from
}
```

`cefrPriorSource` is one of `cefrlex | frequency-derived | claude-classified |
human-override | kelly`. Use `claude-classified` when a model assigned the band.

`formsSource` is one of:

- `generated` — machine output nobody has checked. **The only value a pass may
  overwrite.**
- `reviewed` — a human or an independent model checked it and changed nothing.
  This is most of the work and it is not a lesser state than `authored`.
- `authored` — written or corrected by hand.

## BANDS

The band is "roughly how advanced is this word", not how rare it is.

- **A1** — survival and immediate need. Greetings, numbers, family, food, the
  100 commonest verbs, basic adjectives. A learner meets these in week one.
- **A2** — everyday transactions. Shopping, directions, past events, simple
  opinions.
- **B1** — connected discourse. Work, study, travel problems, plans, feelings
  described rather than named.
- **B2** — abstraction. Argument, nuance, hypotheticals, specialised but
  non-technical vocabulary.
- **C1** — low-frequency, literary, technical, or register-marked.

**Do not invent bands a dictionary does not already use.** Spanish tops out at
C1 and has no C2 entries at all. Adding one silently changes the shape of the
data and breaks assertions that depend on it.

When unsure between two bands, pick the LOWER one only if a beginner would
plausibly need the word to get through a day. Otherwise pick the higher.

## FREQUENCY

`frequencyRank` is 1-based, 1 being the commonest word in the corpus a
dictionary was seeded from. It is assigned positionally, so it is meaningful
only *relative to that import*.

**Use `null` for anything you add.** Null honestly means "the frequency corpus
never saw this word". Do not invent a rank — a fabricated number asserts a
measurement that does not exist and will win tiebreaks against genuinely-ranked
words. Null sorts last everywhere.

It is a ranking signal and never a gate. Nothing filters on it.

## FORMS (verbs)

```jsonc
"forms": {
  "pres": ["empiezo","empiezas","empieza","empezamos","empezáis","empiezan"],
  "pret": ["empecé","empezaste","empezó","empezamos","empezasteis","empezaron"],
  "imp":  ["empezaba","empezabas","empezaba","empezábamos","empezabais","empezaban"],
  "ger": "empezando",
  "part": "empezado"
}
```

- **Exactly six slots per tense, in person order: 1s, 2s, 3s, 1p, 2p, 3p.**
  Positional for size and lookup speed. Never index these by hand in code — read
  them through `runtime/classifier/verb-forms.ts`, which names every slot.
- **`null` where a form does not exist.** `llover` is impersonal: "I rain" is not
  something a speaker says, so its 1s is null. Null is a claim that the form does
  not exist, which is different from a gap in the data. Keep the array six long
  regardless, so position still equals person.
  Be strict about this: a form that is merely *rare* or usually third-person
  (`costar`, `doler`, `gustar`) still EXISTS. `yo te gusto` is grammatical. Only
  null what is genuinely impossible.
- **Tense scope is a per-language decision.** Spanish ships present, preterite
  and imperfect for A1-B1: the future at those levels is `ir a` + infinitive, so
  it is out of scope. Italian would differ — its everyday past is the compound
  passato prossimo and its `futuro semplice` is one word and common. Decide
  before authoring; do not copy Spanish's answer.

### What rules get wrong, and where to be careful

Regular verbs are safe to generate. These are not:

- **Stem changes are invisible in the infinitive.** `pensar` -> `pienso`,
  `contar` -> `cuento`, `pedir` -> `pido`. Nothing about the spelling of
  `pensar` distinguishes it from `pesar`, which is regular. This is the single
  largest error source and it is why a model beats a rules engine here.
- **Orthographic shifts.** `-car`/`-gar`/`-zar` change before `e`: `busqué`,
  `llegué`, `empecé` — not `buscé`. `-ger`/`-gir` take `j` in the 1s: `dirijo`,
  `exijo`. `-guir` drops the `u`: `distingo`. `-uir` inserts `y`: `construyo`.
  `-guar` needs a diaeresis: `averigüé`.
- **Stressed `-iar`/`-uar`.** Some take a written accent (`envío`, `sitúo`,
  `actúo`) and some do not (`cambio`, `estudio`). There is no rule; it is
  lexical.
- **Irregular participles** hide on otherwise-regular verbs: `escrito`, `roto`,
  `visto`, `vuelto`, `descrito`, `envuelto`, `disuelto`, `frito`.
- **Compounds inherit the base paradigm with a prefix** — `mantener` from
  `tener`, `descomponer` from `poner`. Derive the prefix as
  `lemma.slice(0, -base.length)`; do not hand-write it. (`descomponer` minus
  `poner` is `descom`, not `des`.)
- **Do not conjugate off a union POS tag.** Many lemmas are tagged both verb and
  noun — `ser`, `poder`, `pilar`, `solar`, `militar`. Feeding `pilar` to a
  conjugator produces confident nonsense.
- **Skip lemmas with no infinitive ending** — `que`, `no`, `lo`, `va`, `es` are
  verb-tagged in some sources and are not infinitives.
- **Match accented infinitives.** A filter like `/(ar|er|ir)$/` silently misses
  `oír`, `reír`, `sonreír`, `freír`. Ask for the whole paradigm of those
  explicitly.

## WHAT DOES NOT BELONG IN A DICTIONARY

Keyed by lemma means entries are lemmas. These are not, and they should go to
their own homes rather than into the dictionary:

- **Proper nouns** — `estados_unidos`, `el_prado`, `la_unesco`, personal names.
  Nobody learns "Félix Pantoja" as vocabulary, and while it is a lemma the
  Teacher can slate it. These belong to the scene's proper-noun list.
- **Multiword expressions** — `de_acuerdo`, `a_través_de`, `seguridad_social`.
  Real vocabulary, but not lemmas. These belong to the competency inventory's
  chunks, which already carry surface forms.
- **Conjugated forms** — `echamos_de_menos` is a first-person plural stored as a
  headword. The lemma is `echar de menos`.
- **Uncontracted forms** — `de el` is always `del` in Spanish, `a el` is `al`.
  An entry spelling them out is an artifact, not a word.

If a source produces these, fix the source, not just its output.

## ORTHOGRAPHY

Every form must use only the target language's alphabet. A Cyrillic `е`
(U+0435) once reached four `desplegar` forms — invisible on inspection, and it
would simply never have matched anything. Validate character-by-character
against the language's expected set; do not eyeball it.

## HOW TO WORK

1. **Batch by frequency, commonest first.** High-frequency words are
   disproportionately irregular and disproportionately matter.
2. **Emit JSON only**, in the entry shape above, no prose.
3. **Mark provenance honestly** — `generated` if you applied a rule,
   `authored` if you wrote the forms from knowledge.
4. **Have a different model review**, and ask a narrow question. "Which of these
   verbs are NOT fully regular?" over a list of 1,000 words is one cheap pass
   and finds real misses. "Please conjugate these" invites transcription and
   drift. Name the tenses you want or a reviewer will default to
   present/preterite/**future** and never check the imperfect.
5. **Validate before writing**: six slots per tense, provenance on every
   paradigm, orthography clean, no new bands, no underscores.

`packages/plugins/src/catalog/sugarlang/tests/classifier/verb-forms.test.ts`
already asserts most of that against the shipped data. Run it.
