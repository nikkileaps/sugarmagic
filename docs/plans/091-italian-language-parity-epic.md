# Plan 091 -- Italian Parity, and a Repeatable Way to Add a Language

Status: DRAFT -- NOT LOCKED. Rewritten 2026-08-07 after building lesson 1 for
real, which falsified the previous draft's process. Three epic-review rounds ran
against that draft; their surviving findings are folded in, but the story graph
is new and has not been gated. See "What building lesson 1 changed".
Owner: nikki + claude
Date: 2026-08-07
Branch: `italian-parity`
Ticket: `sugarmagic-italian-m1h`

Related:
- `scripts/data-prep/EXPONENT-AUTHORING.md` -- the authoring contract. **This is
  the process.** The previous draft contradicted it
- `scripts/data-prep/DICTIONARY-AUTHORING.md` -- how word forms get authored
- `packages/plugins/src/catalog/sugarlang/data/languages/README.md:104-122` --
  the six-step "Adding A Language" checklist
- Plan 085 -- SHIPPED: built the competency / exponent model this populates
- Plan 090 -- the Teacher reads `availableCompetencies`; empty for Italian today

---

## Two goals, and the second one is the durable one

1. **Italian reaches parity with Spanish.**
2. **Adding a language becomes a repeatable process** -- specifically, adding
   French must mean *writing French files*, not *editing shared ones*.

Goal 2 is not speculative scope. Every defect this plan exists to fix is the
same defect: **a Spanish assumption living in language-agnostic code.** Italian
is where they surfaced; French is the test of whether they were actually fixed.

## What building lesson 1 changed

Lesson 1 of A1 (`social-contact`, 18 competencies) is authored and building. It
falsified the previous draft's central claim.

**The previous draft had the process backwards.** It made word forms block
exponents: author ~5,900 sets of forms, then the morphology, then exponents. The
documented process is the reverse, and `EXPONENT-AUTHORING.md:3-5` says so in
its opening lines -- read `DICTIONARY-AUTHORING.md` first "because **this work
surfaces gaps in it**."

The real loop, now executed end to end:

```
curriculum (language-agnostic)
  -> author the lesson's exponents
  -> the build reports exactly which words do not resolve
  -> fill in those words' forms in the dictionary
  -> regenerate morphology FROM the dictionary
  -> rebuild the inventory
```

**Measured on lesson 1: 17 words needed forms. Every one was already in the
Italian dictionary; zero new entries.** Against a plan that said ~5,900 sets of
forms had to exist before any exponent could be written. You author what the
lesson surfaces, and the surfaced set is small because a lesson is small.

**One code change was genuinely required**, and it is the previous draft's 091.3
in miniature, now done: `addItalianMorphologyForms` never read `entry.forms` at
all -- it only guessed from the lemma, so filling the dictionary changed nothing
(morphology stayed at 12,943 forms). It now inverts authored forms when present
and falls back to the rule when absent. Morphology went to 13,169 and the lesson
built. Kept rather than deleted, because the rule is right for most `-o`/`-e`
noun plurals and Italian's dictionary is nearly empty; each lemma with authored
forms stops going through it, so its errors retire gradually.

**A green build does not mean correct attribution.** The first attempt "passed"
because I used the per-wording `lemmas` override 33 times to silence words that
did not resolve -- exactly what `EXPONENT-AUTHORING.md` forbids: "a word that
does not resolve at all needs the dictionary, not an override." After doing it
properly, **4 overrides survive**, and they are the legitimate case: `sei`
resolves to the numeral, `abito` to the noun, because
`buildMorphologyData:639-641` gives every headword priority over any derived
form. Spanish uses the same escape hatch in 388 wordings.

**What lesson 1 could NOT resolve** -- 5 tokens, in exactly two classes, and
both are language-rule gaps rather than authoring gaps:
- **Elision**: `c`, `qual`, `dov` (from `non c'è male`, `qual è`, `di dov'è`)
- **Polite imperative / attached pronoun**: `senta`, `figurati`

## The architecture this epic owes: three tiers

The rule is one sentence: **a language's rules live in that language's files;
shared code holds only what is true of every language.** Today that is violated,
and the violations are exactly what broke Italian.

### Tier 1 -- language-agnostic (verified, keep)
- The curriculum and its competencies. Measured: zero language-specific keys.
- `cefrlex.schema.json` form shapes -- verb `pres`/`pret`/`imp`/`ger`/`part`,
  noun `sg`/`pl`, adjective `ms`/`fs`/`mp`/`fp`. **Checked against French before
  relying on it**: passé simple is literary and fits `pret` the same way
  Italian's passato remoto does; participe présent fits `ger`; French gender and
  number fit the adjective shape. The schema needs no change for a third
  language.
- `buildMorphologyData`'s pass structure (headwords, then language forms, then
  derived).
- `authoredSurfacesOf` -- renamed this session from `spanishSurfacesOf`, which
  was a misnomer: it branches on the SHAPE of `forms`, never on language, so
  every language inverts through it.
- `buildCompetencyInventory`, band logic, FSRS, the Teacher.

### Tier 2 -- per-language RULES (code). **This tier has no home today.**
This is the whole architectural gap. These are code, not data, and they are
currently scattered between a shared build file and the insides of
language-agnostic functions:

| rule | lives today | why it is language-specific |
|---|---|---|
| function words with no lexical content | `competency-inventory.ts:103-120`, a **Spanish** list applied to every language | Italian needs `il`/`gli`/`ti`/`ci`/`ne`; `su` and `tu` are in the Spanish list and wrong for Italian |
| elision | **nowhere** | `c'è`, `dov'è`; French `j'ai`, `l'eau`, `qu'il`. Spanish has none, which is why it was never needed |
| derived tenses | `spanishDerivedTenses` + 2 irregular tables, shared file | subjunctive/conditional/future stems are per-language |
| clitic attachment | `SPANISH_ENCLITICS`, shared file | Italian `dirmi`, `figurati` have no Spanish-shaped rule |
| fallback form guessing | `addItalianMorphologyForms`, shared file | `-o`->`-i` is Italian; Spanish deleted its guesser |
| subject pronoun in output | `band-envelope.ts:142-151` | **the code already says this**: "justified entirely by Spanish pro-drop ... simply wrong for a language that requires the subject -- French, German" |
| corpus POS mapping | `mapSpanishPos` / `mapItalianPos` | per source corpus |
| placement questions | `buildSpanishQuestionnaire` / `buildItalianQuestionnaire` | per language |

### Tier 3 -- per-language DATA (files). Already correct.
`data/languages/<lang>/`: cefrlex, morphology, exponents, always-target,
english-collisions, placement-questionnaire. This tier is fine and needs no
change beyond filling Italian in.

### The conformance test
**Adding French must touch only French files plus one registry line.** That is
falsifiable, it is 091.13's exit, and it is the only way to know tier 2 actually
got separated rather than merely rearranged.

## Elision, and why it is the sharpest example

Two tokenizers disagree, and neither is right for an elided language:

- **Build** (`competency-inventory.ts:156-161`) replaces every non-letter with a
  space: `dov'è` -> `["dov", "è"]`. `dov` is a fragment no dictionary will hold.
- **Runtime** (`classifier/tokenize.ts:60`) uses `Intl.Segmenter(lang)`, which is
  locale-aware and keeps it whole: `dov'è` -> `["dov'è"]`. Verified, along with
  French `j'ai` -> `["j'ai"]`, `l'eau` -> `["l'eau"]`.

So the build produces fragments and the runtime produces an unknown token.
Spanish never hit either, because Spanish does not elide. French would hit it in
almost every sentence. The fix is a per-language elision rule that both
pipelines consult -- tier 2, and 091.2 owns it.

## What Italian has and lacks (measured 2026-08-07)

|  | es | it |
|---|---|---|
| `cefrlex.json` | 10,618 lemmas | 6,370 lemmas |
| -- carrying `forms` | 9,783 (noun 6,000, adj 2,336, verb 1,447) | **17** (this session; was 0) |
| `morphology.json` | 103,229 forms | 13,169 forms |
| -- rule-guessed | (guesser deleted) | ~6,500 |
| `exponents.json` | 2,526 entries / 2,896 wordings | **51 entries** (lesson 1) |
| `competency-inventory.json` | 2,046 KB | builds, 18 competencies |
| `always-target.json` | 8 lemmas | **MISSING** |
| `english-collisions.json` | 24 surfaces | **MISSING** |
| `placement-questionnaire.json` | present, has defects (091.11) | present, has defects |

Scope of the authoring ahead: A1 15 lessons / 172 competencies, A2 13 / 129,
B1 12 / 111, B2 13 / 116, C1 12 / 107. **Lesson 1 of A1 is done.**

## What the absence still costs at runtime

`competency-inventory-loader.ts:96` throws for a language with no inventory, and
**eleven call sites catch it and continue** with an explanatory comment and no
telemetry (`sugar-lang-observe-middleware.ts:460-464`,
`sugar-lang-verify-middleware.ts:225-230`,
`sugar-lang-context-middleware.ts:164-167`,
`sugar-lang-teacher-middleware.ts:113-120`, `teacher/prompt-builder.ts:483-491`,
`inventory/describe-competency.ts:53-68`,
`inventory/competency-inventory-loader.ts:186-192`,
`ui/shell/editor-support.ts:871-875` and `:932-936`, plus
`grading/highlight-terms.ts:200` and `inventory/card-display-name.ts:60,87`
which degrade through `getCompetencyForExponent`).

Until `it` is registered (091.9), Italian silently has no competency teaching,
no chunk detection, no social-move recognition, no always-target rules and no
collision guard. The collision guard is the only *active* harm -- ticket `ipx`
found English words banking maximum-strength FSRS credit on core Spanish verbs,
and the same mechanism runs unguarded for Italian. It is fixed late (091.10) for
a reason stated in that story.

## Parity means correct-for-Italian

nikki: "the goal is to bring it up to parity with Spanish in a way that is
correct for Italian." Parity is equivalent CAPABILITY, not a mirrored file. The
unit of correspondence is the competency, which is language-neutral; what
performs it is what an Italian speaker actually says.

Lesson 1 produced real divergence rather than translation, which is the evidence
the principle is being applied: Spanish `greet` has 6 exponents, Italian 4,
because `buonanotte` is leave-taking only in Italian while Spanish `buenas
noches` also greets. Italian gained `non c'è male` and `figurati`, which have no
Spanish counterpart in the same competencies.

**This cannot be enforced by a build.** A fluent calque would pass every
mechanical check. The gate is a human or second-model read of each lesson,
recorded with reviewer and date -- named in the per-lesson exit rather than left
as prose. An earlier draft proposed "entry counts must differ from Spanish's" as
a proxy; it is kept as a smell, not a gate, because identical counts across a
whole band is a near-impossible event and so detects nothing.

**The `ciao` case, and how polysemy gets handled from here.** `ciao` is
genuinely both greeting and farewell in Italian, but
`competency-inventory.test.ts:145-161` forbids one phrase under two
competencies. Resolved 2026-08-07: bare `ciao` sits under `greet`, and
`farewell` gets `ciao ciao`, which is real idiomatic Italian and its own card.

This is the move Spanish already made rather than a workaround for the test:
`refuse-politely` does not reuse `gracias`, it authors `no gracias`; `request`
does not reuse `por favor`, it authors `me das` / `me puedes dar`.

The doc's "raise it" branch does NOT apply, and the distinction matters for the
lessons ahead. `EXPONENT-AUTHORING.md` says a phrase belonging equally to two
competencies signals that **the competencies overlap** -- but `greet` and
`farewell` do not overlap at all. It is the WORD that is polysemous. So the
other branch applies: author under the competency it most directly performs.

What is actually given up is small and worth stating: the learner card key is
`exponent:<id>`, derived from the phrase, so a player typing `ciao` on the way
out still banks the same card either way. Only the teaching side loses -- the
Teacher will not offer bare `ciao` as a way to perform `farewell`. **Do not
relax the test to fix this**; it protects a real invariant for Spanish too, and
the cost is one missing suggestion. If polysemy becomes a recurring cost across
later lessons, the fix is a real one-phrase-many-competencies model, which is a
much larger change and should not be driven by a single word.

---

## Stories

Dependencies only. No priority ordering implied.

### 091.1 Give per-language rules a home
Create the tier-2 contract and move the existing rules into it. Proposed shape,
mirroring how the repo already separates data by language:

```
scripts/data-prep/languages/
  language-rules.ts   -- the interface every language implements
  es.ts  it.ts        -- implementations
  registry.ts         -- lang -> rules
```

The contract covers what the tier-2 table lists: function words, elision,
derived tenses, clitic attachment, fallback form guessing, POS mapping,
placement questions. `sugarlang-language-data.ts` keeps only the agnostic
pipeline.

**Deletion:** the six symbols defined once and never referenced go rather than
moving -- `mapSpanishPos` (`:191`), `rankToBand` (`:309`), `finalizeAtlasEntries`
(`:329`), `SPANISH_ATLAS_LIMIT` (`:138`), `SPANISH_SOURCE_BANDS` (`:137`),
`KellySubsetDataFile` (`:109`). Verified: one reference each, the definition.
AGENTS.md prefers deletion over coexistence.
**Blocks:** 091.2, 091.3.
**Exit:** `grep -i spanish scripts/data-prep/sugarlang-language-data.ts` returns
nothing; Spanish and Italian morphology and questionnaires rebuild
byte-identically to what is checked in.

### 091.2 Move the polluting rules out of agnostic code
Three violations, each with measured consequences:
- **`NO_LEXICAL_CONTENT`** (`competency-inventory.ts:103-120`, consulted
  language-blind at `:241`) becomes a per-language function-word list.
  **Measured in lesson 1: 6 leaks**, e.g. `come_ti_chiami -> come, ti, chiamare,
  si` and `il_mio_nome_e -> il, mio, nome, essere`. `il`/`ti`/`ci`/`si` are being
  banked as content. State the Italian list as lemma ids, since the check is
  keyed by lemma, not surface.
- **Elision** becomes a per-language rule consulted by both tokenizers. Build
  fragments (`dov'è` -> `dov`,`è`); runtime keeps the whole token via
  `Intl.Segmenter`. Reconcile them, and note `normalizeLemma:144-158` strips `'`
  while build-`tokenize` splits on it -- the two disagree today.
- **The subject-pronoun rule** (`band-envelope.ts:142-151`) is pro-drop-specific
  and its own comment names French and German as languages it is wrong for. It
  must take a language, or move. Whoever authors the second always-target list
  decides -- that is 091.8; this story only makes the seam exist.
**Depends on:** 091.1. **Blocks:** 091.4.
**Exit:** the 6 lesson-1 leaks are gone; `dov'è`, `c'è`, `un'amica` resolve in
the build; a test pins the Italian function-word list separately from Spanish's.

### 091.3 Generalize the inventory build script
Replace `build-spanish-competency-inventory.ts` with a lang-parameterized script.
`buildCompetencyInventory` already takes `lang` from `exponents.lang` (`:170`).
**Deletion:** the Spanish-named script is removed.
**Depends on:** 091.1.
**Exit:** one script builds both inventories; `grep -r
build-spanish-competency-inventory packages scripts docs` returns nothing, which
requires updating **six sites** (verified complete):
`docs/api/sugarlang-competency-inventory.md:21,31,231`,
`EXPONENT-AUTHORING.md:184`, `runtime/contracts/competency-inventory.ts:107`,
`data/languages/README.md:80`.

### 091.4 `exponents.schema.json` + validation inside the build
No schema exists for `exponents.json`, `always-target.json` or
`english-collisions.json`. `readJsonFile` is an unchecked cast
(`sugarlang-language-data.ts:1010-1012`), so a malformed entry throws a raw
TypeError at `competency-inventory.ts:206`/`:217` instead of a named failure.
Validation runs **inside the build, before the semantic pass**, so the existing
`failures` list (`:189`, `:274-277`) stays the single reporter of semantic
problems and the schema owns structure only.
**Depends on:** 091.3. **Blocks:** 091.5.
**Exit:** a malformed entry produces a named validation error, not a TypeError.

### 091.5 Author A1, one lesson at a time (15 lessons; lesson 1 done)
The loop from "What building lesson 1 changed", per lesson: author exponents,
run the build, fill in the forms it names, regenerate morphology, rebuild.
Lesson 1 is complete and is the worked example.

A1 must be finished before other bands: `a1.json` holds the only `isItemZero`
competency (`meta-language`, `placementGateBand: "A2"`) and all four
`interpretLexiconCategory` competencies (`greet`, `thank`, `farewell`,
`acknowledge`); a2-c1 have none. Note lesson 1 alone yields only three of the
four -- `acknowledge` is in a later lesson -- so this is a band-level
requirement, not satisfiable one lesson at a time.
**Depends on:** 091.2, 091.4.
**Exit, per lesson:** build green with zero `failures`; `lemmas` overrides only
where a word resolves to the WRONG lemma, never to silence a missing one;
`it/README.md` updated; **and the lesson read end to end by a human or second
model, with reviewer and date recorded.** Overlaps like `ciao` raised, not
authored around.

### 091.6 A2 (13) / B1 (12) / B2 (13) / C1 (12)
Same loop and same per-lesson exit. Sequenced after A1.
**Depends on:** 091.5.

### 091.7 Italian derived tenses and clitics (the third pass)
`buildItalianMorphologyData` passes two callbacks; Spanish passes three
(`:785-793`). Italian needs the third for forms the schema cannot store:
conditional (`vorrei`), future, subjunctive -- which is where lesson 1's `senta`
(polite imperative) comes from -- plus clitic attachment for `figurati`,
`dirmi`, `farlo`. `addSpanishExtraForms` (`:739`) is the shape; the content is
Italian and belongs in `languages/it.ts` per 091.1.
**Scoped by what the lessons surface**, not designed up front -- lesson 1
surfaced exactly two tokens of this class.
**Depends on:** 091.1, and whichever lesson first needs it.
**Exit:** `senta` and `figurati` resolve; no new non-words (091.12's test).

### 091.8 `it/always-target.json`
Italian is pro-drop like Spanish, so the shape transfers but membership is
decided, not translated. Register `it` in `always-target-words.ts:67-89`, and
**answer the deferred question 091.2 exposed** -- `band-envelope.ts:142-151`
says whoever authors the second list decides whether the rule grows a language
parameter or moves. French is the reason it matters.
**Tests:** `always-target-words.test.ts:92-96` uses `"it"` as its example of "a
language with no list" and WILL break. Repoint rather than delete -- the
assertion (zero characters, not a "(none)" line, because these reach prompts
cached on their own text) is load-bearing. Note `VALID_TARGET_LANGUAGES` is
exactly `{es, it}` (`config.ts:100`), so the repoint needs a non-configured
code; say so in the test. The suite is also es-hardcoded at `:17`, so its two
membership guards need Italian arms. Feasible: `io/tu/lei/lui/noi/mi/ti` are
`pronoun` and `sì` is `adverb` in `it/cefrlex.json`.
**Depends on:** 091.2.

### 091.9 Register `it` in the competency-inventory loader
`competency-inventory-loader.ts:24` and `:77-79` register Spanish only. Static
import, so it cannot land before the file exists.
**Depends on:** 091.5.
**Exit:** an Italian game reaches the Teacher with non-empty
`availableCompetencies`, verified in the running game **with the band pinned to
A1** -- `prompt-builder.ts:513-515` matches band exactly, so an unpinned check
passes only by luck. Pin via `config.debugBandOverride` (`config.ts:57`, fired
as a synthetic placement completion at `runtime-services.ts:944-951`, already
used by `tests/integration/end-to-end-conversation.test.ts:352,592`). An earlier
draft prescribed a `self-report` event that **has no production dispatcher**.
**Note:** `es/competency-inventory.json` is 2.0 MB and statically imported;
adding `it` doubles that in every bundle. Trigger for lazy loading in Deferred.

### 091.10 `it/english-collisions.json`
Register `it` in `english-collisions.ts:38-47`; membership pinned by test
(`english-collisions.test.ts:105`).

**Deliberately late.** The observe guard
(`sugar-lang-observe-middleware.ts:147-151`) treats a collision surface as
unresolved unless `inChunk` or `trustedLemmaIds` proves it, and
`trustedLemmaIds` is "Empty for player free text, deliberately" (`:104`).
`inChunk` needs a chunk matcher, which is `null` for Italian until the inventory
lands (`:460-470`). Shipping earlier trades a pollution bug for a starvation
bug: a player typing real Italian would earn zero credit on `come`, `me`, `no`,
`in`, `fine`.
**Depends on:** 091.5, 091.9.
**Measurement method must be named.** `english-collisions.ts:27-30` says
"MEMBERSHIP IS MEASURED, NOT GUESSED" and Spanish was seeded from captured
violations (ticket `psm`). There is no Italian capture corpus: either name a
capture run or adopt a mechanical intersection and record that the provenance
differs. **Re-measure after the morphology settles** -- the provisional set
(`a`, `area`, `case`, `come`, `figure`, `fine`, `idea`, `in`, `me`, `no`, `via`)
includes rule-derived entries that may move.

### 091.11 Repair the placement questionnaires
Hand-written TypeScript (`sugarlang-language-data.ts:801-1024`), and the first
thing a player touches. Italian: `it-q8` `expectedLemmas: ["venire","citta"]`
(`:971`) can never match -- the headword is `città`; and unaccented text
throughout (`perche`, `yesLabel: "si"` where yes is `sì`, `"La stazione e
grande"` where `e` = "and"). **Spanish has the same orthography defect** and is
fixed in the same pass (`:815`, `:844`, `:806`, `:831`, `:834`, `:860`, `:868`);
`yesLabel` is presentational only, so there is no saved-data concern.
**The file is generated** -- editing the builder changes nothing until the build
re-runs, and nothing pins generated == checked-in for it. Add that pin.
**Depends on:** 091.5 (scoring lemmatizes through morphology).
**Exit:** every `expectedLemmas` entry in both banks resolves, asserted by a
test; no unaccented target-language string in either bank; fresh build
reproduces both byte-identically.

### 091.12 Extend the test suites to Italian
Three suites, all es-only. The previous draft cited the wrong file:
`tests/data/language-data-foundation.test.ts` **never touches the competency
inventory** (verified: zero matches).
- `tests/data/competency-inventory.test.ts` (`es` imported statically at `:22`):
  schema (`:37-46`), item-zero with `placementGateBand: "A2"` (`:48-56`), all
  four interpretLexicon categories (`:66-74`, `:205-212`), **every surface
  reachable by the longest-match chunk matcher** (`:120-144`, "THE ONE THAT
  MATTERS"), no phrase under two competencies (`:145-161`).
- `scripts/data-prep/competency-inventory.test.ts:43-56` pins checked-in ==
  fresh build, `es` only (`:33-38`). Italian drifts without an arm.
- `tests/classifier/word-forms.test.ts:16` imports `es/cefrlex.json` only. It is
  the forms validator that `languages/README.md:87` names as the step-5 bar --
  six slots per tense (`:74`), orthography (`:85`), provenance (`:99-103`).
  Missed by every earlier draft.
- **New: an Italian derived-forms test**, the counterpart of
  `spanish-derivation.test.ts`. **Write it red** against today's data --
  `teme -> tema`, `probleme`, `sisteme`, `fando`, `fato`, plus the velar class
  (`banci` for `banchi`, `parci` for `parchi`, `lagi` for `laghi`, `amice` for
  `amiche`; 312 lemmas end `-co/-go/-ca/-ga` and the 83 `-ca/-ga` are uniformly
  wrong). Land it skipped so the suite is not red while A1 is authored.
`homograph-audit.test.ts:36-40` filters on `"pres" in entry.forms`, so it passes
vacuously for Italian until enough forms exist -- extend it after, not before.
**Depends on:** 091.5.

### 091.13 French conformance check
The exit for goal 2, and the only way to know tier 2 was actually separated.
**Not a French language pack** -- no exponents beyond one lesson, no shipping
French. A dry run that adds `languages/fr.ts` with French elision, function
words and derived-tense rules, registers it, and authors one lesson's exponents
against whatever French lemmas can be seeded.

What it is really testing: that `git diff --stat` shows **only new `fr` files
plus one registry line**. Any edit to a shared file is a tier-2 leak that 091.1
and 091.2 missed, and the specific things to watch are the ones that bit
Italian: the function-word list, the elision rule, and the pro-drop assumption
in `band-envelope.ts` -- French is not pro-drop, so an always-target list built
on that assumption is wrong for it.
**Depends on:** 091.1, 091.2, 091.8.
**Exit:** the diff-stat property holds, or the leak is fixed until it does.

### 091.14 Documentation and provenance repair
- **`languages/README.md`** -- `:14-16`, `:124-127` ("Italian ... authors no
  `exponents.json`"), `:129-134` ("there is no Italian build script to run"),
  `:139-141` all become false. Pre-existing: `:3-5` claims "Runtime code never
  branches on language identity", contradicted by per-language static-import
  maps in **six** loaders (`morphology-loader.ts:80`,
  `cefr-lex-atlas-provider.ts:135`, `placement-questionnaire-loader.ts:131`,
  `competency-inventory-loader.ts:77`, `always-target-words.ts:76`,
  `english-collisions.ts:40`).
- **`EXPONENT-AUTHORING.md`** gains the Italian companion note (standard
  Italian; correct-for-Italian rather than translated-from-Spanish; passato
  prossimo as the worked example) and, from lesson 1's mistake, **a louder
  statement of the override rule** -- the doc says it once and I violated it 33
  times.
- **`DICTIONARY-AUTHORING.md`** describes `forms` as verbs-only (`:35`, `:85`)
  and has no noun or adjective section, though the schema defines both and
  Spanish ships 8,336 of them.
- **`docs/api/sugarlang-competency-inventory.md`** -- 091.3 invalidates `:21`,
  `:31`, `:231`; `:235-236` ("`detectSocialMove` ... currently `es` only") is
  stale, it takes a `lexicon` parameter and is language-agnostic
  (`sugaragent/runtime/stages/interpretation.ts:117-135`).
- **Dead re-run commands.** `import-elelex.ts` and `build-italian-cefrlex.ts`
  are cited by `scripts/data-prep/README.md:12,15`, `es/README.md:55`,
  `it/README.md:56`. Neither exists, and **no atlas builder exists at all**,
  consistent with `languages/README.md:58-61` ("There is no importer"). Delete
  the commands; state the atlases are seeded-once.
- **Counts and phantom files.** `es/README.md:34-35` (measured A1 3,198 / A2
  2,591 / B1 1,850 / B2 1,352 / C1 1,627; total 10,618 not 11,000);
  `it/README.md:31` for A1-C1 (1,012 / 1,372 / 1,511 / 1,347 / 998; only its C2
  130 is right), `:26-28` and `:41-42` document `kelly-subset.json` and
  `review-queue.yaml` -- **neither exists** -- and `:37-38` describes a build
  strategy the code does not implement.
- **Provenance.** Record that exponents / always-target / english-collisions are
  LLM-authored, and the `formsSource` split (es: 9,378 `generated`, 405
  `authored`, 835 absent) -- 88% of Spanish forms are machine output that
  `DICTIONARY-AUTHORING.md:45` says "nobody has checked."
- **One "adding a language" checklist survives**; today there are four.
**Depends on:** 091.1, 091.3, 091.9, 091.13.
**Exit:** every Re-Run command runs or is deleted with its absence explained.

---

## Out of scope

- **Growing the Italian atlas beyond Kelly's 6,370 lemmas.** A real
  recognition-breadth difference, but a corpus problem. Lesson 1 needed zero new
  entries, so it is not blocking.
- **Shipping French.** 091.13 is a conformance check, not a language pack.
- **Re-reviewing the Spanish exponents.** The Italian pass will surface Spanish
  inconsistencies; file them.

## Deferred, with triggers

- **Loud reporting of a missing inventory.** `languages/README.md:129-134`
  argues the silence is right because a language can be legitimately
  half-authored. **Trigger:** once every language in `VALID_TARGET_LANGUAGES`
  has an inventory, the silence starts hiding regressions. Code comment at
  `competency-inventory-loader.ts` `load()`.
- **`dialogue-entry-decorator.ts:69`** initializes `currentTargetLanguage =
  "es"`, overwritten from `sugarlang.constraint` at `:87-96`. Only annotated NPC
  turns update it, so any hover before the first NPC turn queries with `"es"`.
  **Trigger:** the first Italian hover bug. **Code comment at `:69` carries
  this** -- required by `feedback_deferred_scope_triggers`, missing from earlier
  drafts.
- **Static-import bundle cost.** 091.9 doubles inventory bytes in every bundle.
  **Trigger:** a third language or the first size complaint; the loader's
  injectable `dataByLang` already accommodates lazy loading.

## Verification

Done when an Italian game is played, not when files exist. Start a game with
target language Italian, pin the band to A1 via `debugBandOverride`, hold a
conversation, and confirm a competency is taught, a multi-word chunk is banked
as an `exponent:` card, and the collision guard rejects an English word that
looks Italian. Placement is verified separately by 091.11.
