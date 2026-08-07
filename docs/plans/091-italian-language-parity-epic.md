# Plan 091 -- Italian Language Parity

Status: DRAFT -- **NOT LOCKED, and the gate did not converge.** Three
epic-review rounds run (2026-08-07); each found a load-bearing defect in the
draft the previous round produced, and round 3 was still finding them at the
same rate. All findings are applied, but the rounds have not damped, so this
plan has NOT earned the locked-plan contract. Do not execute stories against it
as written -- see "Where this stands" below.

Round 1 falsified the first draft's organizing claim ("this is a data epic") --
Italian has zero authored forms. Round 2 falsified the rewrite's central
story: forms were scoped to verbs when Spanish parity needs nouns and
adjectives too, and the deriver story named the wrong pass. Round 3 found five
more, three of which made a story exit unexecutable as written. See "What the
review rounds changed".
Owner: nikki + claude
Date: 2026-08-07
Branch: `italian-parity`
Ticket: `sugarmagic-italian-m1h`

Related:
- Plan 085 (functions-as-chunks curriculum) -- SHIPPED: built the competency /
  exponent model this epic populates for a second language
- Plan 090 (concept-opportunity scanner) -- the Teacher reads
  `availableCompetencies`; for Italian that list is empty today
- `packages/plugins/src/catalog/sugarlang/data/languages/README.md:104-122` --
  the authoritative six-step "Adding A Language" checklist. This epic executes
  it; the first draft skipped steps 2 and 3
- `scripts/data-prep/DICTIONARY-AUTHORING.md` -- how word forms get authored.
  **Carries a documentation bug this epic must fix first: it describes `forms`
  as verbs-only.** See 091.1
- `scripts/data-prep/EXPONENT-AUTHORING.md` -- how exponents get authored
- `docs/api/sugarlang-competency-inventory.md` -- invalidated in three places by
  091.6

---

## What the review rounds changed

**Round 1.** The first draft claimed "this is a data epic, not a code epic" and
that "the only genuinely new authoring is `it/exponents.json`." Both were wrong,
and the draft's own cited source said so: it quoted
`languages/README.md:110-114` starting mid-sentence at "Decide the tense
scope..." and dropped the words opening that step -- **"Author the forms.
Verbs need `forms`."** The sentence refuting the framing was cut; the one
supporting it was kept.

**Round 2.** The rewrite fixed the framing and then introduced a defect at the
center of its own reorganization. Three faces of one mistake:

- It sized forms authoring at **1,366 verbs**. That number is correct as a
  verb count and wrong as the job: measured `es/cefrlex.json` forms by shape is
  **noun 6,000, adjective 2,336, verb 1,447**, and
  `data/schemas/cefrlex.schema.json` defines noun (`sg`/`pl`) and adjective
  (`ms`/`fs`/`mp`/`fp`) forms as siblings of the verb shape. Italian has
  **4,507 noun/adj lemmas** with zero forms. The old 091.3's own exit
  demanded `problemi` and `sistemi` -- noun plurals no story authored.
- It said the new deriver should mirror "the Spanish third pass
  (`:751-759`)". **Wrong pass.** `buildSpanishMorphologyData` (`:762-770`) runs
  TWO: `addSpanishMorphologyForms` (`:556-562`, inverting authored forms via
  `spanishSurfacesOf` `:512-524`) and `addSpanishDerivedForms` (`:751-759`,
  deriving tenses the dictionary does not store).
  `buildItalianMorphologyData` (`:772-776`) runs ONE, in the *second*-pass slot.
  Italian needs both, and the plan had one story naming the wrong one.
- Its exit listed `vorrei` as an authored form. The verb schema requires exactly
  `pres`/`pret`/`imp`/`ger`/`part` with `additionalProperties: false`;
  `vorrei` is conditional and comes from the third pass
  (`spanishDerivedTenses`, `:465-509`). It cannot be authored.

Round 2 also caught that deleting the Italian rule path wholesale is a
capability loss, not a cleanup -- see "Merge, do not delete" below.

**Round 3.** Five new defects in the round-2 draft, all verified at the
producing line:
- **091.17's band-pin mechanism did not exist.** The `self-report` event has no
  production dispatcher (type at `learner-state-reducer.ts:97`, case at `:303`,
  one reducer test, nothing else), and prescribing it reinvented two shipped
  mechanisms -- `config.debugBandOverride` and `applyDebugBandOverride`.
- **`quanto costa` does not throw; it resolves to the wrong lemma silently.**
  The draft's headline failure list conflated two failure modes. See "Two
  failure modes" below -- this is the finding with the widest blast radius,
  because it means a green build proves nothing about attribution.
- **"Retire the rule by coverage" had nowhere to live.** `buildMorphologyData`
  has exactly three tiers and both were spoken for.
- **091.2's exit did not test 091.2's scope** -- "coverage is non-zero" was
  satisfiable by thirteen verbs, i.e. by the exact defect round 2 found. The
  round-2 failure shape, recurring one level down.
- **Elision was unowned.** `dov'è` tokenizes to `["dov", "è"]`, and Spanish has
  zero apostrophes in 2,896 phrases, so no existing convention covers it.

**The corrected framing:** Italian is missing both halves of the language data.
The corpus import delivered a lemma list and bands; it did not deliver forms
or a usable morphology, and the dictionary half blocks the exponent half.

## Where this stands

Three rounds, three load-bearing defects, no damping. Round 1 hit the framing,
round 2 the central story, round 3 the exits and two unowned work items. That
trend is the reason this is not locked: the rounds were still paying for
themselves when they stopped, so the next one would likely find something too.

What is stable and can be trusted:
- **Every measured number.** All three rounds verified the counts independently
  and they held exactly.
- **The corpus-vs-authored framing**, once corrected for forms.
- **The partial-authoring analysis** and why A1-first is required.
- **The runtime cost analysis** -- the eleven silent catch sites and what each
  costs an Italian player.

What is least settled, and where a fourth round would look:
- **091.2's true size and tooling.** ~5,900 sets of forms with the generation
  mechanics still only gestured at.
- **091.3's fourth-tier change to `buildMorphologyData`**, which is a signature
  change to a shared function that no round has reviewed as written.
- **091.19 and 091.20**, both created in round 3 and never reviewed.

## Why now

Italian is a configured, selectable target language -- `config.ts:37`
(`type SugarlangTargetLanguage = "es" | "it" | ""`) and `config.ts:100`
(`VALID_TARGET_LANGUAGES`) -- and a player who picks it gets a game that runs,
never errors, and quietly teaches a fraction of what Spanish teaches. Nothing in
the product says so.

## What Italian has and lacks (measured 2026-08-07, not quoted from the READMEs)

|  | es | it |
|---|---|---|
| `cefrlex.json` | 4,747 KB / 10,618 lemmas | 1,090 KB / 6,370 lemmas |
| -- lemmas carrying `forms` | **9,783** (noun 6,000, adj 2,336, verb 1,447) | **0** |
| `morphology.json` | 10,583 KB / 103,229 forms | 1,321 KB / 12,943 forms |
| -- of those, rule-derived | (guessing path deleted) | **6,573 (51%)** |
| `placement-questionnaire.json` | 4 KB | 4 KB, but see 091.14 |
| `frequency.json` | (none needed) | 772 KB |
| `competency-inventory.json` | 2,046 KB | **MISSING** |
| `exponents.json` | 634 KB | **MISSING** |
| `always-target.json` | 305 bytes / 8 lemmas | **MISSING** |
| `english-collisions.json` | 761 bytes / 24 surfaces | **MISSING** |

Italian lemmas by part of speech: **verb 1,366, noun/adjective 4,507, other
497.** That is the forms-authoring job, and it is roughly 5,900 entries, not
1,366.

**Italian has no finite verb forms at all.** `sono`, `ho`, `hai`, `ha`, `sto`,
`stai`, `sta`, `vado`, `va`, `chiamo`, `chiami`, `parlo`, `capisco`, `facendo`,
`dicendo`, `venuto`, `bevuto` -- every one MISSING from `it/morphology.json`.
So A1 exponents like `mi chiamo`, `come stai` and `non capisco` fail token
resolution at `competency-inventory.ts:232-240` and throw at `:275-277`.

## Two failure modes, and only one of them is loud

Round 3 correction. An earlier draft lumped `quanto costa` in with the list
above. It does not throw -- and that is worse.

**Loud: the token resolves to nothing.** `!lemma` at `:235` appends to
`failures` and the build throws with the list. This is the case the missing
missing forms produce, and it is self-announcing.

**Silent: the token resolves to the WRONG lemma.** `costa -> costa` (the noun,
coast) and `sei -> sei` (the numeral) both resolve today, so no `failures` entry
is written and the build is green. **This survives 091.2-091.4 untouched**:
`buildMorphologyData:639-641` claims every headword before any derived form and
`addMorphologyEntry:533-535` refuses to overwrite, so the headword wins
regardless of authoring. `languages/README.md:97`: "A wrong lemma is worse than
a missing one."

**The remedy already ships and no earlier draft mentioned it.**
`AuthoredExponent.wordings[].lemmas` (`competency-inventory.ts:44-49`) is
consulted at `:234` *before* the morphology index. **Spanish uses it in 388
wordings**, and the shipped `cuánto cuesta` carries `{"cuesta": "costar"}` --
the exact analogue of the Italian case. Same shape for `llama -> llamar`,
`vivo -> vivir`, `siento -> sentir`.

Consequence for this epic: a green build is not evidence of correct
attribution, so "zero `failures`" cannot be a band story's only structural exit.
Italian needs its own homograph list, and the override belongs in the authoring
guidance. 091.19 owns this.

Both READMEs are stale on their counts and `it/README.md` documents two files
that do not exist (`kelly-subset.json`, `review-queue.yaml`). Do not trust
either; 091.18 fixes them.

Provenance fact recorded nowhere and relevant to sizing 091.2: of the 9,783
Spanish lemmas with forms, **`formsSource` is `generated` for 9,378 and
`authored` for 405.** `es/README.md:20-22` says the files are "rebuilt from the
real ELELex Spanish source", concealing that 88% of Spanish forms are
machine output that, per `DICTIONARY-AUTHORING.md:45`, "nobody has checked."
Italian is not held to a higher bar than Spanish actually meets.

## Merge, do not delete: the Italian rule path

`addItalianMorphologyForms` (`sugarlang-language-data.ts:565-613`) guesses. The
equivalent Spanish path was deleted deliberately with the reason at `:543-555`
(`caso -> casa`, `puerto -> puerta` -- "not inflections, they are different
words, and the index claimed otherwise"). The obvious move is to delete
Italian's too. **That would be wrong, and round 2 caught it.**

Measured breakdown of the 6,573 derived entries: **~4,200 noun/adjective
plurals, 1,216 gerunds, ~1,150 participles.** Of the plurals, by lemma ending:
1,976 from `-o` (rule emits `-i`, correct for *regular* masculine), 1,162 from
`-e` (rule emits `-i`, correct), 1,029 from `-a` (rule emits `-e`, correct for
feminine `casa -> case`, wrong for masculine `problema -> problemi`).

**The `-o` bucket is not uniformly correct, and round 3 caught the overstatement.**
Italian inserts `h` before a plural `-i`/`-e` after `c`/`g`. Measured in the
shipped index: `banci -> banco` (real `banchi`, absent), `parci -> parco`
(`parchi`, absent), `lagi -> lago` (`laghi`, absent), `amice -> amica`
(`amiche`, absent), plus `poci` and `gioci`. **312 noun/adjective lemmas end in
`-co/-go/-ca/-ga`, and the 83 `-ca/-ga` ones are uniformly wrong.** This is the
same class as Spanish `respellBeforeE` (`:421-427`), which
`spanish-derivation.test.ts:22` titles "THE ONE THAT WAS WRONG". 091.5's fixture
must include it or the regression test this plan designs would not catch it.

With that correction, the majority of the rule's noun output is still correct
Italian. Spanish could
delete its guesser safely **because the dictionary already held 8,336 noun and
adjective form sets**; Italian's holds none. Deleting before authoring drops
thousands of correct forms -- including `case` (->casa) and `figure` (->figura),
which are on this epic's own measured collision list. Per
`feedback_merge_duplicate_enforcers`: diff the behaviours, keep what the rule
gets right until authored forms cover it, then retire it.

The genuine defects stand and are what 091.5 pins: non-words (`probleme`,
`sisteme`, `poete`, `fando`, `fato`) and `teme -> tema`, which claims a finite
verb form for a noun -- the exact `caso -> casa` failure.

## What the absence costs at runtime

`competency-inventory-loader.ts:96` throws for a language it has no inventory
for. **Eleven call sites catch that and continue** -- each with an explanatory
comment, none with a warning or telemetry:
`runtime/middlewares/sugar-lang-observe-middleware.ts:460-464`,
`runtime/middlewares/sugar-lang-verify-middleware.ts:225-230`,
`runtime/middlewares/sugar-lang-context-middleware.ts:164-167`,
`runtime/middlewares/sugar-lang-teacher-middleware.ts:113-120`,
`runtime/teacher/prompt-builder.ts:483-491`,
`runtime/inventory/describe-competency.ts:53-68`,
`runtime/inventory/competency-inventory-loader.ts:186-192` (the loader's own
internal catch), `ui/shell/editor-support.ts:871-875` and `:932-936`, plus two
that degrade through `getCompetencyForExponent` rather than throwing:
`runtime/grading/highlight-terms.ts:200` (hover competency attribution) and
`runtime/inventory/card-display-name.ts:60,87` (learner-card display names).

So an Italian game loses, silently: all competency teaching
(`availableCompetencies` is `[]`), all multi-word chunk detection in the observe
path (the matcher is `null`, so no `exponent:` card is ever banked), social-move
recognition, the always-target prompt rules, and the English-collision guard.

That last is the only active harm rather than a missing capability. Ticket `ipx`
found English words banking maximum-strength FSRS credit on core Spanish verbs;
the guard returns an empty set for Italian (`english-collisions.ts:46`) and is
optional-chained at `coverage.ts:169`. **This epic does not fix that until
091.16, which is near the end** -- see that story for why shipping it early
trades pollution for starvation. That is a deliberate, stated cost.

## The producer question, answered

- cefrlex / morphology / frequency / placement come from **corpus imports** with
  scripts under `scripts/data-prep/` -- but **no atlas builder exists for either
  language** (091.18). `sugarlang-language-data.ts` exports only frequency,
  morphology and placement builders.
- exponents, always-target and english-collisions were **LLM-authored** against
  `EXPONENT-AUTHORING.md`, then reviewed. nikki, 2026-08-07: "the data came from
  you Claude it turns out LLMs are the best way to produce this data. And when I
  have credits with the other AI i'll have it review it."
- Forms are **dictionary-authored** per `DICTIONARY-AUTHORING.md`, which
  carries the measured argument for a model over a conjugation library
  (`:9-12`). Round 2 confirmed no conjugation library is installed and that the
  argument's mechanism ("stem changes are invisible in the infinitive",
  `:117-120`) holds for Italian's irregulars. Authoring is the right call.
- **`competency-inventory.json` is DERIVED, not authored.**
  `build-spanish-competency-inventory.ts:31-46` joins
  `data/curriculum/{a1..c1}.json` + `exponents.json` + `morphology.json`. The
  curriculum is language-independent (confirmed: zero language-specific keys;
  nikki: "The competency list should be language independent yes").

Exponent authoring size, measured against shipped Spanish: 635 competencies (A1
172, A2 129, B1 111, B2 116, C1 107), 2,526 entries, 2,896 wordings.

## What "parity" means here

nikki, 2026-08-07: "the goal is to bring it up to parity with Spanish in a way
that is correct for Italian."

**Parity is equivalent CAPABILITY, not a mirrored file.** The measure is that an
Italian learner can be taught competencies, have multi-word chunks detected and
banked, get social-move recognition, and be protected by the collision guard.

1. **Author Italian, do not translate Spanish.** The unit of correspondence is
   the competency, which is language-neutral. What performs it is chosen by what
   an Italian speaker actually says.
2. **Entry counts will not match, in both directions, and that is not a defect.**
   The grouping test is applied to Italian on its own terms: "would meeting this
   phrase teach the learner the other one?"
3. **Structural differences change the SHAPE of the data.** Passato prossimo is
   compound, so Italian's everyday past is a multi-word exponent where the
   Spanish preterite was one word.

**Making this falsifiable, corrected after round 2.** The rewrite proposed "a
band whose per-competency entry counts are identical to Spanish's fails review."
Round 2 is right that this is inert: identical counts across all 172 A1
competencies is a near-impossible event, so the check is falsifiable in form and
detects nothing. It is dropped as a gate and kept only as a smell.

The real gate is the human/second-model review nikki described, and it is
written into each band story's exit rather than left as prose. A band is not
done because it builds; it is done because it was read. This is the one exit in
the epic that no CI run can replace, and pretending otherwise with a mechanical
proxy is worse than naming the limit.

## Two properties of the build that shape the stories

**1. Partial authoring is valid, and A1-first specifically is REQUIRED.**
`competency-inventory.ts:193` iterates authored exponents only, so unauthored
competencies are absent rather than a failure; `:280-294` filters lessons the
same way ("Only lessons that something in this language can actually teach").
The load-bearing fact: **`a1.json` holds the only `isItemZero` competency
(`meta-language`, `placementGateBand: "A2"`) and all four
`interpretLexiconCategory` competencies (`greet`, `thank`, `farewell`,
`acknowledge`); a2 through c1 have zero of each.** Authoring any other band
first yields an inventory missing the item-zero and social-move machinery.

**Valid is not the same as playable.** `prompt-builder.ts:513-515` filters by
`competency.band === learnerBand` -- **exact match, not band-and-below.** An
Italian learner at A2 or B1 sees `- (none)` against an A1-only inventory. Every
playability exit must therefore pin the band; see 091.17 for the mechanism.

**2. The build reports unresolved tokens precisely.**
`competency-inventory.ts:232-240` resolves every token through
`morphology.forms`; an unresolved token becomes a `failures` entry that throws
at `:275-277` with the full list. This is a per-band regression check, not a
discovery mechanism -- the first draft used it to defer a question one command
answered.

## Decisions to settle before authoring (091.1)

**Variety: SETTLED.** Standard Italian. nikki, 2026-08-07: "the answer is just
'standard'." Spanish needed an explicit Latin American decision and a
substitution table because its varieties diverge on everyday nouns; Italian
needs no equivalent. Production narrow, recognition wide still applies.

**Tense scope for A1-B1: OPEN, and it is ONE decision serving two documents.**
`languages/README.md:110-114` (step 2) and `DICTIONARY-AUTHORING.md:107-111` ask
the same question, for forms and exponents respectively. Settling it twice
is the duplicate-enforcer shape AGENTS.md warns about.

It does not follow from "correct for Italian." That principle settles WHICH form
is right (passato prossimo, not a calque of the Spanish preterite); it does not
settle HOW MUCH belongs at A1-B1. Passato prossimo needs an auxiliary,
participle agreement and the essere/avere split, so admitting it early costs
more than the Spanish preterite did. Futuro semplice is the mirror case -- one
word and common, so possibly cheaper than Spanish's, where `ir a` + infinitive
covered A1-B1. This decides which forms 091.2 authors and the shape of a few
hundred wordings.

---

## Stories

Dependencies only. No priority ordering is implied.

### 091.1 Italian authoring decisions, and the verbs-only doc bug
Settle tense scope for A1-B1 once, covering forms and exponents. Record it
with the settled variety in `it/README.md`; point
`DICTIONARY-AUTHORING.md:107-111` and `languages/README.md:110-114` at that
record rather than restating it.

**Also fix the documentation bug that caused round 2's finding**, because 091.2
is authored from these documents and would inherit it:
`DICTIONARY-AUTHORING.md:35` (`"forms": { ... }, // verbs only`), `:85`
(`## FORMS (verbs)` -- the doc has no noun or adjective section) and
`languages/README.md:110` ("Verbs need `forms`") are all stale against
`cefrlex.schema.json`, which defines noun and adjective forms, and against
8,336 shipped Spanish noun+adjective form sets.

`EXPONENT-AUTHORING.md` gets a companion note, not a substitution table: an
author arriving at the Spanish variety section must not conclude Italian has an
equivalent list.
**Blocks:** 091.2, 091.8-091.12.
**Exit:** `it/README.md` states tense scope and variety with a date; the other
documents defer to it; `DICTIONARY-AUTHORING.md` documents the noun and
adjective shapes. No code change.

### 091.2 Author Italian forms -- verbs, nouns and adjectives
The step `languages/README.md:110` names. Author `forms` per
`DICTIONARY-AUTHORING.md` at the 091.1 tense scope, with `formsSource` recorded
honestly per entry. **~5,900 entries: 1,366 verbs and 4,507 noun/adjective
lemmas.** Nouns and adjectives are not optional -- they carry gender and plural
information no rule can recover (`problema`/`sistema`/`poeta` are masculine
`-a` nouns pluralizing in `-i`; `casa`/`figura` take `-e`), and Spanish ships
8,336 of them.
**Tooling:** `scripts/generate-atlas-glosses.ts` is the existing shape and is
already language-parameterized (`LANGUAGES = ["es","it"]`, batched through the
gateway, fill-never-overwrite); `DICTIONARY-AUTHORING.md:21-23` names it. Point
the forms pass at that pattern rather than leaving the mechanics unstated --
~5,900 entries is not hand work.

**Split by part of speech, because the exit must test the scope.** Round 3
caught that the previous exit ("`forms` coverage is non-zero") was satisfiable
by thirteen verbs -- it could not distinguish full coverage from the verbs-only
defect round 2 found. Two sub-stories with separate coverage floors:
- **091.2a verbs** (1,366)
- **091.2b nouns and adjectives** (4,507)

**Depends on:** 091.1. **Blocks:** 091.3, 091.4.
**Exit:** `it/cefrlex.json` validates against `cefrlex.schema.json`; **`forms`
coverage is reported per part of speech and meets a stated floor for each**, not
merely non-zero; every entry with `forms` carries `formsSource`; the A1 probe
list -- `sono`, `ho`, `hai`, `ha`, `sto`, `stai`, `sta`, `vado`, `va`, `chiamo`,
`chiami`, `parlo`, `capisco` -- is **present in the authored forms**; and
`problema`, `sistema`, `poeta`, `banco`, `parco`, `lago`, `amica` are authored,
since 091.3's and 091.5's exits name them specifically.
(Deliberately not "resolves": resolution goes through `it/morphology.json`,
which does not change until 091.3. `vorrei` is likewise absent from this exit --
it is conditional, which the schema cannot store, and arrives in 091.4.)

### 091.3 Italian morphology: invert the authored forms (second pass)
Give Italian the pass Spanish has at `addSpanishMorphologyForms` (`:556-562`)
via `spanishSurfacesOf` (`:512-524`), which handles all three shapes
(`"pres" in f` / `"sg" in f` / else adjective). This is the slot
`addItalianMorphologyForms` currently occupies -- `buildItalianMorphologyData`
(`:772-776`) passes it as `buildMorphologyData`'s second argument.

**Retire the rule path by coverage, not by date -- and this needs a FOURTH
priority tier that does not exist yet.** Round 3 found the previous wording had
nowhere to put the surviving rule. `buildMorphologyData` (`:615-667`) takes
exactly two callbacks and runs three passes: headwords (`:639-641`),
`addLanguageSpecificForms` (`:643-645`), `addDerivedForms` (`:657-661`). If the
forms inverter takes slot 2 and derived tenses take slot 3, folding the rule
into slot 2 recreates the documented bug at `:647-656`: "within one pass
whichever lemma is visited first wins ... Measured: 112 surfaces changed owner."

Concretely, it would break this story's own exit: `tema` is atlas index 341,
`temere` 1742, so an unauthored `tema` lets the rule claim `teme` before
`temere`'s forms are reached -- and `teme -> tema` is exactly what the exit
forbids.

**So this story owns extending `buildMorphologyData` with a fourth, lowest tier**
for rule-guessed forms, below both authored inversion and derived tenses. That
is a signature change to a shared function; it is not incidental and no other
story covers it. Do not delete `addItalianMorphologyForms` before authored
coverage replaces it -- move it down the ladder.
**Depends on:** 091.2. **Blocks:** 091.8.
**Exit:** the A1 probe list from 091.2 **resolves** through
`it/morphology.json`; 091.5's test passes; total derived non-word count is zero
against 091.5's fixture; `problemi` and `sistemi` present, `probleme`,
`sisteme`, `poete`, `fando`, `fato` and `teme -> tema` absent.

### 091.4 Italian morphology: derived tenses (third pass)
`buildItalianMorphologyData` passes only two arguments; Spanish passes three
(`:762-770`). Add the Italian third pass mirroring `addSpanishDerivedForms`
(`:751-759`) and `spanishDerivedTenses` (`:465-509`), which is where forms the
schema cannot store come from -- conditional (`vorrei`), future, subjunctive --
at the 091.1 tense scope. `addSpanishExtraForms` (`:715-749`) is the shape to
follow, not the content.

Italian-specific surfaces with no Spanish counterpart, each of which must be
owned here or explicitly deferred:
- **Articulated prepositions** (`nella`, `della`, `dallo`). Single tokens, so
  they behave like any other derived form.
- **Reflexive infinitives** (`chiamarsi`, `alzarsi`) and **clitic attachment**
  (`dirmi`, `farlo`). Spanish gets the analogous forms from `SPANISH_ENCLITICS`
  (`:678-680`); Italian has no counterpart and round 3 found none planned.
- **Irregular plurals** (`uomo/uomini`, `dito/dita`). The schema's `sg`/`pl`
  shape handles these once authored, so they belong to 091.2b -- named here so
  the boundary is explicit rather than forgotten between the two stories.
- **Elided forms** (`dell'`, `all'`, `c'`) are NOT this story. They are a
  tokenizer problem, not a morphology one -- see 091.20.
**Depends on:** 091.2. **Blocks:** 091.8.
**Exit:** `vorrei` resolves to `volere`; articulated prepositions and enclitic
forms resolve; 091.5's test is unskipped and green (no new non-words).

### 091.5 `italian-derivation.test.ts`
`spanish-derivation.test.ts` is the established "derived forms are real words"
pattern; Italian has no counterpart. **Write it first, red**, against today's
data -- `teme -> tema`, `probleme`, `sisteme`, `poete`, `fando`, `fato` -- so it
is a regression test for 091.3/091.4 rather than a rubber stamp written after
the fix.
**Depends on:** 091.1 (its verb-form assertions depend on the tense scope).
**Blocks:** 091.3's and 091.4's exits.
**Exit:** the test fails on `main`'s data and passes after 091.3. **It must land
skipped or `.fails`-marked** so the suite is not red for the duration of the
largest story in the epic; the story that turns it on is 091.3.

### 091.6 Generalize the competency-inventory build
Replace `build-spanish-competency-inventory.ts` with a lang-parameterized
script. `buildCompetencyInventory` takes `lang` from `exponents.lang` (`:170`),
so the plumbing is fine -- but **`NO_LEXICAL_CONTENT`
(`competency-inventory.ts:103-120`) is a hardcoded Spanish table consulted
language-blind at `:241`**, and the rewrite's claim that the builder "needs no
change" was wrong. For Italian it strips the wrong things in both directions:
`il`, `gli`, `uno`, `ti`, `ci`, `ne` are absent and should strip, while `su`
(preposition "on"; the comment at `:100-101` says "Prepositions are NOT here")
and `tu` (subject pronoun, outside the stated scope) are present and should not.
**The check is keyed by lemma id, not surface** (`:241`), so the Italian list is
stated as lemma ids -- `i` and `vi` are absent from `it/morphology.json`
entirely and would fail at `:235` before reaching `:241`, so they are omitted
rather than listed inertly (Spanish already carries two such inert entries: `os`
resolves to lemma `o`, `les` to `l`). Key the table by language inside the
build; do not add a second table beside it.
**Deletion:** `build-spanish-competency-inventory.ts` is removed.
**Depends on:** none. **Blocks:** 091.7, 091.8.
**Exit:** one script builds the es inventory byte-identically to the checked-in
file and an it inventory from an it exponents file; the Italian
`NO_LEXICAL_CONTENT` set is covered by a test. `grep -r build-spanish-competency-inventory packages scripts docs/api` returns
nothing, which requires updating
**six sites** (verified complete):
`docs/api/sugarlang-competency-inventory.md:21,31,231`,
`scripts/data-prep/EXPONENT-AUTHORING.md:184`,
`runtime/contracts/competency-inventory.ts:107`,
`data/languages/README.md:80`.

### 091.7 `exponents.schema.json` + validation
There is no schema for `exponents.json`, `always-target.json` or
`english-collisions.json` -- only for the generated inventory. `readJsonFile` is
an unchecked cast (`sugarlang-language-data.ts:1010-1012`), so a malformed
authored entry crashes with a raw TypeError at `competency-inventory.ts:206`
(`const [canonical] = entry.wordings`) or `:217` (`Object.keys(wording.gloss)`)
instead of the designed named `failures` list. Authoring ~2,500 entries with an
LLM is what validation is for.

**Avoid a second enforcer.** `competency-inventory.ts:189`/`:274-277` already
owns *semantic* failure reporting (unresolved token, missing gloss, unknown
competency). The schema owns *structural* validity only -- shape, required keys,
types -- and validation runs **inside the build**, before the semantic pass, so
one command reports both. An Ajv test in `tests/data/` alone would not stop the
build's TypeError, which is the failure this story exists to remove.
**Depends on:** 091.6 (the validation call lives in the script 091.6 creates).
**Blocks:** 091.8.
**Exit:** a deliberately malformed exponent entry produces a named validation
error from the build, not a TypeError.

### 091.8 `it/exponents.json` -- A1 (172 competencies)
Per `EXPONENT-AUTHORING.md`, one lesson at a time. Phrases and glosses only.
**Depends on:** 091.1, 091.3, 091.4, 091.6, 091.7, 091.19, 091.20.
**Exit:** the build produces `it/competency-inventory.json` with every A1
competency present and zero `failures`; the Italian arm of 091.13 passes;
`it/README.md` updated; **and the band has been read end to end by a second
model or a human, with the reviewer and date recorded in `it/README.md`.** The
last clause is the parity gate and no build result substitutes for it.

### 091.9 A2 exponents (129) -- **depends on:** 091.8
### 091.10 B1 exponents (111) -- **depends on:** 091.9
First band where the 091.1 tense decision applies at scale.
### 091.11 B2 exponents (116) -- **depends on:** 091.10
### 091.12 C1 exponents (107) -- **depends on:** 091.11

Each carries 091.8's exit shape, including the review record and the README
update. None may defer either to 091.18.

### 091.13 Extend the competency-inventory test suites to Italian
Two suites, neither owned by the first draft, and the first draft cited the
wrong file: `tests/data/language-data-foundation.test.ts` **never touches the
competency inventory** (verified: zero matches).
- `tests/data/competency-inventory.test.ts` imports `es` statically at `:22` and
  is es-hardcoded throughout. Its invariants each need an Italian arm: schema
  validation (`:37-46`), item-zero with `placementGateBand: "A2"` (`:48-56`),
  all four interpretLexicon categories non-empty (`:66-74`, `:205-212`), **every
  surface form reachable by the longest-match chunk matcher** (`:120-144`, whose
  own comment calls it "THE ONE THAT MATTERS"), no phrase under two
  competencies (`:145-161`).
- `scripts/data-prep/competency-inventory.test.ts:43-56` pins the checked-in
  inventory byte-identical to a fresh build, for `es` only (`realInputs()`
  `:33-38`). Without an Italian arm, `it/competency-inventory.json` drifts the
  moment it lands.

`homograph-audit.test.ts:36-40` filters on `"pres" in entry.forms`, so pointing
it at Italian passes vacuously until 091.2 lands -- extend it after, or it
guards nothing.

**A third suite, missed by every earlier draft.**
`tests/classifier/word-forms.test.ts:16` imports `es/cefrlex.json` and only
that. It is the forms validator -- `languages/README.md:87` names it as the
step-5 bar -- pinning six slots per tense (`:74`), target-language orthography
(`:85`) and provenance on every set of forms (`:99-103`, which already asserts no
entry has `forms` without `formsSource`). 091.2 authors ~5,900 sets of Italian
forms and nothing was extending this. An Italian arm is cheap and directly
guards 091.2's "recorded honestly" clause.
**Depends on:** 091.8 for the inventory suites; **091.2** for the forms
validator arm, which can land earlier.
**Exit:** all three suites run green for `it` and fail if
`it/competency-inventory.json` is hand-edited.

### 091.14 Repair the placement questionnaires
The first draft filed placement under "Italian already has all of it" on the
evidence of a byte count. It is hand-written TypeScript
(`sugarlang-language-data.ts:888-1000`) with defects a size comparison cannot
see, and it is **the first thing an Italian player touches**:
- `it-q8` `expectedLemmas: ["venire", "citta"]` (`:971`) -- **`citta` is not in
  `it/cefrlex.json`** (the headword is `città`), so it can never match. The
  Spanish counterpart resolves.
- Scoring lemmatizes free text (`placement-score-engine.ts:157-161`). With no
  finite Italian verb forms a learner writing "vengo" or "ho risolto" scores
  nothing; only a bare infinitive counts, making `it-q10` unpassable by a
  natural answer. 091.2/091.3 fix the cause; this story fixes the question data.
- Orthography is unaccented throughout -- `citta`, `perche`, `yesLabel: "si"`
  (that is the reflexive pronoun; yes is `sì`), `"La stazione e grande"`
  (`e` = "and"). `EXPONENT-AUTHORING.md:102` requires correct accents.
  **The Spanish bank has the same defect** and is fixed in the same pass:
  `yesLabel: "si"` (`:815`, `:844`), `"Yo ___ de Canada."` (`:806`),
  `"¿Cuanto tiempo vas a quedarte?"` (`:831`), `"La estacion es grande."`
  (`:834`), `"Explica por que vienes a esta ciudad."` (`:860`),
  `"¿Que documento presentas en la aduana?"` (`:868`). (Round 3 corrected two
  citations an earlier draft got wrong -- `:859` and `:875` -- and found three
  more sites.) Leaving `es` unaccented while fixing `it` would be a new
  inconsistency. `yesLabel` is presentational only
  (`placement-questionnaire-panel.tsx:190` renders it as the label for
  `value: "yes"`), so there is no saved-data concern.
- **The file is GENERATED.** `placement-questionnaire.json` comes from
  `build-placement-questionnaires.ts` and the runtime statically imports the
  JSON (`placement-questionnaire-loader.ts:18-19`), so editing
  `sugarlang-language-data.ts:888-1000` alone changes nothing until the build is
  re-run and the output committed. Unlike the competency inventory, **nothing
  pins generated == checked-in for this file**; add that pin while the story is
  open.
**Depends on:** 091.3 (the lemmatization half needs the rebuilt morphology).
**Exit:** every `expectedLemmas` entry in both banks resolves to a real atlas
lemma, asserted by a test; no unaccented target-language string remains in
either bank; a fresh build reproduces both checked-in questionnaires
byte-identically.

### 091.15 `it/always-target.json`
The Spanish file is 8 lemmas. Italian is pro-drop too, so the shape transfers
but membership is decided, not translated. Register `it` in
`always-target-words.ts:67-89`.

**This story owns a deferred decision the first draft did not acknowledge.**
`band-envelope.ts:142-151`: "Nothing enforces that today: the only gate is that
Spanish is the one language with an always-target list. Whoever authors the
second list decides whether this grows a language parameter or moves." 091.15
authors the second list and must answer it.

**Tests:** `tests/teacher/always-target-words.test.ts:92-96` uses `"it"` as its
example of "a language with no list" and WILL break. Repoint it, do not delete
it -- the assertion (zero characters, not a "(none)" line, because these reach
prompts cached on their own text) is load-bearing. The repoint is awkward:
`VALID_TARGET_LANGUAGES` is exactly `{es, it}` (`config.ts:100`), so the only
option is a non-configured code, which weakens the assertion; say so in the
test. The suite is also es-hardcoded at `:17` (`LEMMAS` from `es/cefrlex.json`),
so its membership guards -- "every word is a real dictionary entry" (`:99-105`)
and "function words only, NOUN IS NOT ALLOWED" (`:106-127`) -- need Italian
arms. Feasible: `io/tu/lei/lui/noi/mi/ti` are `pronoun` in `it/cefrlex.json` and
`sì` is `adverb`.
**Depends on:** none -- round 3 verified the membership guards resolve against
today's atlas (`io/tu/lei/lui/noi/mi/ti` are `pronoun`, `sì` is `adverb` in
`it/cefrlex.json`), so the earlier 091.2 dependency was over-constrained.
**Exit:** the Italian list passes both membership guards; the repointed no-list
test still asserts zero characters; the `band-envelope.ts` question is answered
in code with the comment updated.

### 091.16 `it/english-collisions.json`
Register `it` in `english-collisions.ts:38-47`. Membership is pinned by test
(`tests/classifier/english-collisions.test.ts:105`).

**Not independent, contrary to the first draft.** The observe-side guard
(`sugar-lang-observe-middleware.ts:147-151`) treats a collision surface as
unresolved unless `inChunk` or `trustedLemmaIds` proves it, and
`trustedLemmaIds` is "Empty for player free text, deliberately" (`:104`).
`inChunk` needs a chunk matcher, which is `null` for Italian until the inventory
lands (`:460-470`). Shipping the list first means a player typing genuine
Italian earns **zero** credit on `come`, `me`, `no`, `in`, `fine` -- trading a
pollution bug for a starvation bug. This is why the epic's one active harm
persists nearly to the end.
**Depends on:** 091.8, 091.17.

**The measurement method must be named.** `english-collisions.ts:27-30` says
"MEMBERSHIP IS MEASURED, NOT GUESSED" and the Spanish list was seeded from
captured phantom violations (ticket `psm`). There is no Italian capture corpus.
This story either names a capture run or changes the doctrine to a mechanical
intersection (English surface x `it/morphology.json` x atlas band) and records
that the provenance differs from Spanish's. It may not leave this implicit.

**Re-measure after 091.3.** The provisional set below was measured against
today's morphology, which 091.3 rebuilds: `a`, `area`, `case`(->casa), `come`,
`figure`(->figura), `fine`, `idea`, `in`, `me`, `no`, `via` at A1. `case` and
`figure` are rule-derived and may move. (The first draft named `he`, `sono` and
`pesto`; all three are absent from `it/morphology.json` and cannot collide.)
**Exit:** every entry cites its measurement; the pinned-membership test passes.

### 091.17 Register `it` in the competency-inventory loader
`competency-inventory-loader.ts:24` and `:77-79` statically import and register
Spanish only. Static import, so it cannot land before the file exists.
**Depends on:** 091.8.
**Exit:** an Italian game reaches the Teacher with a non-empty
`availableCompetencies`, verified in the running game **with the learner band
pinned to A1** -- `prompt-builder.ts:513-515` matches band exactly, so an
unpinned check is satisfiable only by luck.

**Mechanism, corrected in round 3.** An earlier draft prescribed the
`self-report` event (`learner-state-reducer.ts:303`). **That event has no
production dispatcher** -- repo-wide it appears only as the type (`:97`), the
case (`:303`), a comment (`:323`) and one reducer test -- so the exit would have
been unexecutable, and it reinvented two shipped mechanisms. Use either:
- `config.debugBandOverride` (`config.ts:57`, seeded at
  `runtime-services.ts:311-313`, fired as a synthetic placement completion at
  `:944-951`), already used by
  `tests/integration/end-to-end-conversation.test.ts:352,592`; or
- `applyDebugBandOverride(band, pin)` (`runtime-services.ts:470`), exposed as
  `window.__sugarlangDebug.setBand` (`manifest.ts:295-297`) and driven by the
  panel whose docblock says it overrides the band "without going through the
  placement flow" (`ui/shell/learner-override-section.tsx:4-5`).

Prefer the config route: it is Claude-drivable without touching the UI, per
`feedback_claude_owned_debug_tooling`.
**Note:** `es/competency-inventory.json` is 2.0 MB and statically imported;
adding `it` doubles that in every bundle regardless of the player's language.
Acceptable at two languages; trigger recorded in Deferred.

### 091.18 Documentation and provenance repair
Owns every doc this epic invalidates or that is already false.
- **`languages/README.md`** -- carries the epic's central claims and the first
  draft updated none of it. These become false: `:14-16`, `:124-127` ("Italian
  ... authors no `exponents.json`"), `:129-134` ("there is no Italian build
  script to run" -- 091.6 creates one), `:140-141` ("no forms yet" -- 091.2
  changes this). Pre-existing defects in the same file: `:3-5` claims "Runtime
  code never branches on language identity", contradicted by the per-language
  static-import maps in **six** loaders (`morphology-loader.ts:80`,
  `cefr-lex-atlas-provider.ts:135`, `placement-questionnaire-loader.ts:131`,
  `competency-inventory-loader.ts:77`, `always-target-words.ts:76`,
  `english-collisions.ts:40`).
- **`docs/api/sugarlang-competency-inventory.md`** -- 091.6 invalidates `:21`,
  `:31`, `:231`. Required at epic wrap regardless per
  `feedback_update_api_docs_each_epic`. Also `:235-236` ("`detectSocialMove`
  ... currently `es` only") is stale: it takes a `lexicon` parameter and is
  language-agnostic (`sugaragent/runtime/stages/interpretation.ts:117-135`).
- **Dead re-run commands.** `import-elelex.ts` and `build-italian-cefrlex.ts`
  are cited by `scripts/data-prep/README.md:12,15`, `es/README.md:55` and
  `it/README.md:56`. Neither exists -- and no atlas builder exists at all, so
  neither `cefrlex.json` can be regenerated. This is consistent with
  `languages/README.md:58-61` ("There is no importer"), so the READMEs are wrong
  and the code is right. Resolution: delete the commands and state the atlases
  are seeded-once artifacts.
- **Dead helpers**, each defined once and never referenced (verified):
  `mapSpanishPos` (`:191`), `rankToBand` (`:309`), `finalizeAtlasEntries`
  (`:329`), `SPANISH_ATLAS_LIMIT` (`:138`), `SPANISH_SOURCE_BANDS` (`:137`),
  `KellySubsetDataFile` (`:109`). AGENTS.md: "Prefer deletion over coexistence."
- **Counts and phantom files.** `es/README.md:34-35` band distribution and total
  are wrong (measured A1 3,198 / A2 2,591 / B1 1,850 / B2 1,352 / C1 1,627;
  total 10,618, not 11,000). `it/README.md:31` likewise for A1-C1 (measured
  1,012 / 1,372 / 1,511 / 1,347 / 998; only its C2 130 is right); `:26-28`
  documents `kelly-subset.json` and `:41-42` `review-queue.yaml` -- **neither
  exists** -- and `:37-38` describes a build strategy
  `addItalianMorphologyForms` does not implement.
- **The `verb-forms.test.ts` phantom path**, cited at `languages/README.md:87`,
  `DICTIONARY-AUTHORING.md:183`, **and in the test file's own header docblock**
  (`tests/classifier/word-forms.test.ts:2`, which names itself
  `verb-forms.test.ts`). Three sites, not two.
- **Provenance.** Record that exponents / always-target / english-collisions are
  LLM-authored, and record the `formsSource` split (es: 9,378 `generated` / 405
  `authored` / 835 absent).
- **Four overlapping "adding a language" checklists** now exist
  (`languages/README.md`, `DICTIONARY-AUTHORING.md`, `EXPONENT-AUTHORING.md`,
  `docs/api/sugarlang-competency-inventory.md:227-240`). One survives; the rest
  reference it.
**Depends on:** 091.2, 091.3, 091.6, 091.15, 091.17 (it documents their
outcomes; 091.15 is included because nothing else depends on it and 091.18 would
otherwise re-stale `languages/README.md`).
**Exit:** every command in every Re-Run section runs, or is deleted with its
absence explained. `grep -r "verb-forms.test" packages scripts` returns nothing.

### 091.19 Italian homograph list and the `lemmas` override
Owns the silent failure mode described in "Two failure modes" above. Two parts:
- **Authoring guidance.** `AuthoredExponent.wordings[].lemmas`
  (`competency-inventory.ts:44-49`, consulted at `:234`) is how a wording pins a
  token to the right lemma. Spanish uses it in 388 wordings. Neither
  `EXPONENT-AUTHORING.md` nor any earlier draft of this plan mentions it, so an
  Italian author would not know it exists. Document it with the `quanto costa`
  case.
- **A measured Italian homograph list**, the analogue of the Spanish overrides:
  surfaces where an inflected form collides with a different headword
  (`costa`/costare vs coast, `sei`/essere vs six). Because
  `buildMorphologyData:639-641` always gives the headword priority, these can
  never be fixed in morphology and must be fixed per wording.
**Depends on:** 091.3 (the collision set is measured against the rebuilt index).
**Blocks:** 091.8, whose exit consumes it.
**Exit:** every A1 wording whose tokens collide with a headword carries a
`lemmas` override; a test asserts no A1 exponent resolves a token to a lemma
outside the wording's own competency without an explicit override.

### 091.20 Elision and the tokenizer
`tokenize` (`competency-inventory.ts:156-161`) replaces every non-letter with a
space. Verified by execution: `dov'è -> ["dov", "è"]`, `c'è -> ["c", "è"]`,
`un'amica -> ["un", "amica"]`. `dov` and `c` are fragments no stored form will ever
produce, so a core A1 exponent throws at `:275`.

**This class does not exist in Spanish** -- measured: **zero apostrophes across
all 2,896 shipped Spanish phrases** -- which is why no earlier draft saw it and
why no existing convention covers it. Note also that `normalizeLemma:144-158`
strips `'` while `tokenize` splits on it, so the two normalizers disagree
(`c'è` -> `cè` vs `["c","è"]`); whatever this story decides must reconcile them.

Decide and own one of: teach `tokenize` about elision; or require a `lemmas`
override on every elided wording (091.19's mechanism, but at a scale that makes
it a policy rather than an exception). **The decision gates A1 authoring**, so
it cannot be discovered during 091.8.
**Depends on:** none. **Blocks:** 091.8.
**Exit:** `dov'è`, `c'è` and `un'amica` resolve to their real lemmas through the
build, asserted by a test.

---

## Explicitly out of scope

- **Growing the Italian atlas beyond the lemma list Kelly provides.** 6,370 vs
  10,618 is a real recognition-breadth difference and a corpus problem; no story
  here improves it. **Narrower than the first draft's claim**, which lumped
  morphology in and called the whole gap "not an authoring one." The morphology
  half is an authoring and correctness problem: 091.2, 091.3, 091.4.
- **A third language.** 091.6's generalization is what this epic needs, no more.
- **Re-reviewing the Spanish exponents.** The Italian pass will surface Spanish
  inconsistencies. File them.

## Deferred, with triggers

- **Loud reporting of a missing inventory.** `languages/README.md:129-134`
  argues the silence is correct because a language can be legitimately
  half-authored. **Trigger:** once every language in `VALID_TARGET_LANGUAGES`
  has an inventory, the silent catch stops protecting a real case and starts
  hiding a regression. A code comment at `competency-inventory-loader.ts`
  `load()` carries this trigger.
- **`dialogue-entry-decorator.ts:69`** initializes `currentTargetLanguage =
  "es"`, overwritten from `sugarlang.constraint` at `:87-96`. **More reachable
  than the first draft allowed:** only annotated NPC turns update it and player
  turns carry no constraint, so any hover before the first NPC turn queries the
  Italian atlas as `"es"`. Not fixed here because the fix belongs with whoever
  owns lookup lifecycle. **Trigger:** the first Italian hover bug, or any work
  making lookups available before dialogue starts. **A code comment at `:69`
  carries this trigger** -- required by `feedback_deferred_scope_triggers` and
  missing from both earlier drafts.
- **Static-import bundle cost.** 091.17 doubles the inventory bytes in every
  bundle. **Trigger:** a third language, or the first bundle-size complaint; the
  fix is lazy per-language loading, which the loader's injectable `dataByLang`
  already accommodates.

## Documentation is part of done

Two obligations, and only the first is 091.18: repair what is already wrong, and
**keep `it/README.md` current as each band lands.**
`languages/README.md:121-122` makes the language README "the single source of
truth for where that language's data came from and what has been reviewed"; a
band story adding 129 exponents without touching it breaks that contract. Per
`feedback_docs_describe_present_not_history` these state what exists now, not a
changelog.

## Verification

The epic is done when an Italian game is played, not when the files exist. Per
`feedback_verify_ui_before_claiming_done`: start a game with target language
Italian, self-report A1 (see 091.17 for why placement must be skipped for this
check), hold a conversation, and confirm a competency is taught, a multi-word
chunk is detected and banked as an `exponent:` card, and the collision guard
rejects an English word that looks Italian. Placement itself is verified
separately by 091.14, which is the only story that should complete it.
