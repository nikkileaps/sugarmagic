# Domain Terms

Status: Updated in Epic 090

The nouns sugarlang uses, and the distinctions between the ones that sound
alike. Every definition below cites the type or file that owns it; if the code
and this document disagree, the code is right and this document is stale.

For how these fit together as a system, see [domain-model.md](./domain-model.md).

---

## The core terms

These are the ones that get confused with each other, ordered as the data
actually flows.

### Atlas

The shipped per-language dictionary. Static reference data, identical for every
player and every game -- the only thing here not derived from authored content.

- `data/languages/es/cefrlex.json` -- 11,000 Spanish entries
- `data/languages/it/cefrlex.json` -- 6,370 Italian entries
- Read through `CefrLexAtlasProvider` (`runtime/providers/impls/cefr-lex-atlas-provider.ts`)

### Lemma

One atlas entry. A headword, **not** an inflected surface form.
Type: `AtlasLemmaEntry` (`runtime/contracts/providers.ts:40-49`).

```jsonc
{
  "lemmaId": "queso",
  "lang": "es",
  "cefrPriorBand": "A1",
  "frequencyRank": 1350,
  "partsOfSpeech": ["noun"],
  "glosses": { "en": "cheese" }
}
```

`cabeza` is a lemma; `cabezas` is a surface form of it. `LemmaRef`
(`{ lemmaId, lang }`) is the lightweight reference passed between systems.

The headword-vs-surface-form distinction is load-bearing in one place worth
knowing about: the reverse gloss index is keyed on the exact English gloss, so
`cheese` resolves and `cheeses` does not (`resolveFromGloss`,
`cefr-lex-atlas-provider.ts:208-215`).

### Lexicon

The whole word stock of a language. In this codebase that **is** the atlas --
the interface is literally `LexicalAtlasProvider`
(`runtime/contracts/providers.ts:152`). "Lexicon" and "atlas" name the same
thing; atlas is the file, lexicon is the concept.

The word is overloaded on two other things, so check which one is meant:

| Use | What it actually is |
|---|---|
| `LexicalAtlasProvider` | the lexicon. The dictionary. |
| `SceneVocabularyModel` | **not** a lexicon -- one scene's slice of it. See scene vocabulary below. |
| `interpretLexicon` | unrelated. Surface forms grouped by category, used to interpret what the *player* typed (`buildInterpretLexicon`), not to teach. |

### Scene vocabulary

Which lexicon entries one scene's authored text actually uses, plus the proper
nouns in it. An **index into** the lexicon -- a list of ids -- not a copy of it;
band, rank and part of speech are looked up by id.

`SceneVocabularyModel` (`runtime/contracts/scene-lexicon.ts`), carrying
`lemmaIds: string[]` and `properNouns: string[]`. It was `CompiledSceneLexicon`
and stored copies of atlas fields; calling a scene's subset a "lexicon" is what
made it read as a second dictionary, and copying the fields is what let the two
drift.

**Lexicon vs scene vocabulary:** the lexicon is every word in the language; the
scene vocabulary is which of them this text uses.

### Concept

An English word plus its part of speech and provenance, inferred from prose by a
model. Introduced by Plan 090.

```jsonc
{ "word": "cheese", "pos": "noun", "provenance": "npc:finnick:bio" }
```

A concept is *what a piece of content is about, or does*. It is **demand**: it
says "this is relevant here" and nothing about what to teach. Resolution then
looks it up in two supply tables -- the atlas and the competency inventory --
and it may hit both, one, or neither. The atlas half is a mechanical lookup; the
competency half is a judgment the **Teacher** makes, not the code. See
[domain-model.md](./domain-model.md).

| concept | atlas | competency |
|---|---|---|
| `cheese` | queso | -- |
| `greeting` | saludo | `greet` |
| `self introduction` | -- | an act |

So a concept has no kind, and its label is not constrained to one word: a phrase
simply misses the atlas, and that miss is the signal to try the other table.

### Situation

One scene at one moment: a compiled half (`sceneContext`, what the scene is
about) and a live half (`runtime`, quest state / time of day / world events),
plus the NPC and recent turns. Type: `Situation`
(`runtime/situation/situation.ts`), built by `composeSituation`, which is
**total** -- it always returns one, and represents absence inside the structure.

One of the two content doors into the Teacher. The other is the learner.

### Runtime fact

`RuntimeFact<T>` (`runtime/situation/runtime-fact.ts`) -- available with a
value, or unavailable. The distinction between "there is no active quest" and
"we could not read the quest system" is load-bearing and survives all the way
into the prompt, where it renders as `(none)` versus `(unknown)`.

### Dialogue blob

A compile-time unit of authored text, one per dialogue node. Not linguistic --
it is a scanning and hashing unit. Emitted by `collectDialogueBlobs`
(`runtime/compile/scene-traversal.ts:204-213`).

```jsonc
{
  "sourceKind": "dialogue",
  "sourceId": "<dialogueDefinitionId>:<nodeId>",
  "text": "...",
  "weight": 1
}
```

`weight` is how much that kind of source counts toward `sceneWeight`. The full
table (`TEXT_BLOB_WEIGHTS`, `scene-traversal.ts:95-103`):

| sourceKind | weight |
|---|---|
| `dialogue`, `npc-bio`, `quest-objective-display-name`, `lore-page` | 1 |
| `quest-objective` | 0.95 |
| `item-label` | 0.7 |
| `region-label` | 0.4 |

### Why the distinction matters

Two paths read the same authored content and ask different questions:

```
blobs -> scene vocabulary     what words are IN this text
prose -> concepts -> lemmas   what this content is ABOUT
```

Both exist. For a long time only the first did, and it is why a cheese-obsessed
NPC never taught `queso`: his lines are generated at runtime, so "cheese" was
never in authored text for the scan to find. Scanning the words that happen to
be *present* cannot reach a word that is merely *relevant*, which is what the
second path is for.

---

## Learner and teaching terms

### Band

A CEFR level -- A1, A2, B1, B2, C1, C2. Both a property of a lemma
(`cefrPriorBand`: roughly "how advanced is this word") and of a learner
(`estimatedCefrBand`). Canonical ordering helper: `cefr-band-utils.ts`.

### Posture

How much target language a rendering should carry, derived from the learner's
band. `anchored` (A1), `supported` (A2), `target-dominant` (B1+), `target-only`.
Source of truth: `postureForBand` and `TARGET_LANGUAGE_RATIO_BY_POSTURE`
(`runtime/teacher/band-envelope.ts`).

### Directive

The Teacher's output for a conversation: what to introduce, reinforce and
avoid, plus posture, ratio, complexity cap and whether to run a comprehension
check. Type: `PedagogicalDirective` (`runtime/contracts/pedagogy.ts`). Cached per
conversation by `DirectiveCache`.

### Slate

The teaching half of a directive: which teachables to `introduce`, `reinforce`
and `avoid` on this turn. `SlateItem` / `SlateAction`
(`runtime/situation/slate.ts`); the actions are `introduce | reinforce | probe |
skip`.

"Slate" is the decision; "directive" is the slate plus the rendering envelope
(posture, ratio, complexity cap).

### Realization

Turning a directive into text. One operation at two moments -- **build time**
for authored dialogue lines (producing a cached variant) and **runtime** for
agent-generated lines. Both shape a generator; neither substitutes words into
already-written text.

### Ambient span

Target language in a line that the atlas knows but the slate never asked for.
Found by `findAmbientSpans` (`runtime/grading/ambient-spans.ts`), marked so the
player can select it for a translation, deliberately left unstyled -- the styled
treatment belongs to what is actually being taught.

### Constraint

The directive re-expressed for the renderer, carried on the conversation
execution as an annotation. Type: `SugarlangConstraint`. Where the directive is
a decision, the constraint is instructions to whatever produces the text.

### Card

The learner's memory record for one lemma -- review count, stability,
retrievability. Drives what is due for review. Lives on the learner profile as
`lemmaCards`.

### Teachable

Anything the Teacher can teach. Two subtypes today:

- **vocabulary** -- one word. `cheese` -> `queso`.
- **competency** -- one thing the learner can do. *"Can ask where a place or
  person is"* -> `donde esta`.

A third (conjugation) is anticipated, not built. Both subtypes share a shape: a
language-neutral thing plus how this language performs it.

The kinds are `TEACHABLE_KINDS` (`runtime/contracts/scene-teachable.ts`).
Two shapes carry them, and the difference is where they came from:

| type | file | what it is |
|---|---|---|
| `SceneTeachable` | `runtime/contracts/scene-teachable.ts` | what a scene's concepts resolved to -- the supply available here |
| `ScheduledTeachable` | `runtime/scheduler/teach-schedule.ts` | what the outer-loop scheduler has queued for this learner |

### Competency

One communicative act the learner can perform, with a CEFR descriptor and a
band. Ten in Spanish: `greet`, `thank`, `request`, `ask-where`, `buy`,
`refuse-politely`, and so on.

The phrases that perform it are its **exponents** (`"donde esta"`,
`"donde está"`). Note an exponent is NOT the same as a **chunk**: a chunk is any
multi-word expression, which is what `MultiWordExpressionExtractor` finds in
authored text; an exponent is specifically a phrase that performs *this* act.

A competency is language-neutral; only its exponents are per-language.

Named `function` until 2026-07-29, after CEFR's "functional syllabus". Renamed
because it collided with the programming sense on every read; `Competency`,
`competencyId`, `competency-inventory.json`, `kind: "competency"` throughout now.

### Diglot weave (deleted)

Substituting target-language words into otherwise-English text, so a beginner
read mostly English with real target words embedded.

**Gone as of Epic 090.** The target language is now written by the model that
writes the line, at whatever ratio the posture directs -- so there is nothing
left to weave in afterwards. Kept in this glossary only because the word still
appears in older commits and comments; if you find code doing substitution on
finished text, it is a survival and should be deleted.

### Variant

A pre-rendered version of an authored line for a specific language, band and
posture, baked at compile time and read from cache at runtime. Keyed
`{ lang, band, contentHash, variantPromptVersion }` -- note there is no learner
in that key.

---

## Terms that mean two things

Worth flagging, because each has bitten:

- **floor** -- in this codebase always a numeric threshold
  (`DUE_RETRIEVABILITY_FLOOR`, `probeFloorState.hardFloorReached`). It is not a
  scope tier.
- **bake** -- narrowly, compiling scripted line *variants*. Other compile-time
  pipelines (chunks, intents, concepts) are not "baking".
- **avoid** -- conflates *too hard right now* with *deliberately withheld*. Both
  reach the directive's `avoid` list and nothing downstream can tell them apart.
- **lexicon** -- the atlas, a scene's subset of it, or the player-input
  `interpretLexicon`. See Lexicon above.
