# Authoring Exponents

How to write the phrases that perform a competency in one language. Companion
to `DICTIONARY-AUTHORING.md`; read that one first if you are also touching the
dictionary, because this work surfaces gaps in it.

Work **one lesson at a time**. A lesson is 8 to 18 competencies, which is small
enough to hold in your head and to review in one sitting.

## WHAT YOU ARE WRITING

A **competency** is one thing a learner can do -- `greet`, `ask-price`. It is
language-neutral and already written, in `data/curriculum/<band>.json`.

An **exponent** is a phrase that performs it. `hola` performs `greet`. Those are
what you write, in `data/languages/<lang>/exponents.json`.

You write **phrases and their meanings, and nothing else.** Everything else on
an exponent is derived by the build: its id, its normalized form, its CEFR band,
its constituent lemmas, and every alternative spelling. Do not hand-write any of
those; they will be overwritten and the mismatch will fail the suite.

```jsonc
"greet": [
  { "wordings": [
      { "phrase": "buenos días", "gloss": { "en": "good morning" } }
  ]}
]
```

## ONE EXPONENT IS ONE CARD

This is the decision you make most often, so make it deliberately.

Wordings grouped in **one** entry are one exponent, one learner card, and one
thing the learner is treated as knowing. Separate entries are separate cards.

Group them when they are the same move said differently:

```jsonc
{ "wordings": [
    { "phrase": "qué es",        "gloss": { "en": "what is it" } },
    { "phrase": "qué es esto",   "gloss": { "en": "what is this" } },
    { "phrase": "qué significa", "gloss": { "en": "what does it mean" } }
]}
```

Split them when a learner could plausibly know one and not the other. `hola` and
`buenos días` both perform `greet`, but knowing one does not give you the other,
so they are two exponents.

The test: **would meeting this phrase teach the learner the other one?** Yes,
group. No, split.

## THE GLOSS

What the phrase MEANS, in the support language. It is what the player sees when
they hover the phrase in a line of dialogue, so write it for them.

- **Translate the phrase, do not describe the act.** `por favor` glosses as
  "please", not "a politeness marker" and not "Can make a simple request".
- **Per wording, not per exponent.** `qué es` is "what is it"; `qué significa`
  is "what does it mean". They share a card and do not share a meaning.
- **Natural target-to-support**, the way a person would say it, not word by
  word. `mucho gusto` is "pleased to meet you", never "much taste".
- **No trailing punctuation, no capital** unless the word itself takes one.
- It cannot be derived. `por favor` from its own words comes out "for favour",
  which is why you write it.

## THE TARGET VARIETY IS LATIN AMERICAN SPANISH

Decided 2026-08-05. Author Latin American forms.

    carro / auto     not  coche          boleto      not  billete
    computadora      not  ordenador      lentes      not  gafas
    jugo             not  zumo           celular     not  móvil
    papa             not  patata         apartamento not  piso
    manejar          not  conducir       refrigerador not nevera
    listo, está bien not  vale (as "okay")

**`ustedes`, never `vosotros`,** for plural you. No exponent should carry a
`-áis` / `-éis` verb form.

Avoid `coger`. It is ordinary in Spain and vulgar across much of Latin America,
and there is always another verb.

Not everything that looks peninsular is. `¿Cuánto vale?` is ordinary in Latin
America -- it is `vale` meaning "okay" that is not. Check the sense, not the
word.

### This is about what we TEACH, not what we understand

The dictionary and the morphology index keep peninsular forms, including the
`vosotros` conjugations. A player may type one, or meet one in authored text,
and failing to recognise it would be a bug.

The variety decision governs PRODUCTION -- the phrases we put in an NPC's mouth
and credit a learner for. Recognition stays wide.

## SPELLING

**Write correct target-language orthography, accents and all.** `buenos días`,
not `buenos dias`.

You do NOT write the unaccented spellings. The build derives every combination
of each accented word kept or dropped, because players accent inconsistently:
`dónde está` ships as all four of `dónde está`, `dónde esta`, `donde está`,
`donde esta`, and all four match and credit.

This means correcting a phrase's spelling never moves its id -- ids are
deaccented -- so it never orphans a learner card.

## WHAT COUNTS AS AN EXPONENT

- **Something a speaker says.** If no one would utter it in a scene, it is not
  an exponent. Descriptions of the act are not exponents.
- **Whole, sayable, standalone.** `me llamo` is fine; `llamo` alone is not.
- **Formulaic.** Exponents are fixed phrases, not sentence templates with slots.
  If it needs a blank filled in, either write it with a plausible filler as one
  wording or leave it to vocabulary.
- **Common enough to meet.** Prefer what a learner will actually hear at this
  band over what is technically correct.

Aim for **two to five exponents per competency**. One is thin -- a learner who
meets it once has met the whole competency. More than about six usually means
the competency is really two.

## EVERY WORD MUST RESOLVE

Constituent lemmas are derived by looking every word up in the morphology index.
A word that does not resolve **fails the build**, naming the competency, the
phrase and the word:

```
Cannot build the es competency inventory:
  greet / "buenos díaz": "díaz" does not resolve to a lemma
```

Three causes, in the order to check them:

1. **A typo.** Fix the phrase.
2. **The dictionary is missing the word.** Fix the dictionary and regenerate
   morphology -- see `DICTIONARY-AUTHORING.md`. This is common and expected;
   authoring at scale is how the gaps get found.
3. **A homograph resolved the other way.** See below.

### Lemma overrides

The morphology index maps a surface to exactly one lemma, and a headword
outranks another word's inflected form. `cuesta` is a real noun ("slope"), so it
wins over `costar`'s third person. `llama` is the animal. `habla` is "speech".

When that is wrong for your phrase, say so on the wording:

```jsonc
{ "phrase": "cuánto cuesta",
  "gloss": { "en": "how much does it cost" },
  "lemmas": { "cuesta": "costar" } }
```

Only where it is genuinely wrong. This is not a way to silence a failure -- a
word that does not resolve at all needs the dictionary, not an override.

Why it matters: a competency counts as in-envelope when one of its constituent
lemmas is being taught. A wrong lemma silently stops the phrase from linking to
the word it teaches.

## SHARED PHRASES

`por favor` performs both `request` and `refuse-politely`. `gracias` performs
both `thank` and `acknowledge`.

Author the phrase under the competency it most directly performs, and do not
repeat it under the other. Two competencies authoring the same phrase produce
the same exponent id and therefore the same card, and only one of them will be
reported as its owner.

If a phrase genuinely belongs to both equally, that is a signal the two
competencies overlap -- raise it rather than authoring around it.

## AFTER YOU WRITE A LESSON

```
pnpm exec tsx scripts/data-prep/build-competency-inventory.ts <lang>
pnpm vitest run scripts/data-prep packages/plugins/src/catalog/sugarlang/tests/data
```

The build fails loudly on anything unresolvable. The suite additionally pins
that the checked-in inventory is exactly what a fresh build produces, so a
skipped rebuild is caught rather than discovered later.

Then read the generated entries for the lesson you just wrote. You are checking
that the derived parts look right, not that they exist:

- Does each `exponentId` read like the phrase?
- Do `constituentLemmas` hold the content words, and none of the filler?
- Does `glossBySurface` give every spelling the right meaning?

## WHAT NOT TO DO

- Do not write `exponentId`, `normalizedForm`, `cefrBand`, `constituentLemmas`
  or `surfaceForms`. All derived.
- Do not write unaccented spellings. Derived.
- Do not add a competency here. Competencies live in the curriculum; naming one
  that does not exist there fails the build.
- Do not translate the descriptor into a phrase. "Can greet someone" is not a
  greeting.
- Do not pad to reach a count. Three real exponents beat six with two invented.
