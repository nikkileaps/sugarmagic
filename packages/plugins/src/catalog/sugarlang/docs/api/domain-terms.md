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
| `sceneLexicon` / `CompiledSceneLexicon` | **not** a lexicon -- one scene's slice of it. See scene vocabulary below. |
| `interpretLexicon` | unrelated. Surface forms grouped by category, used to interpret what the *player* typed (`buildInterpretLexicon`), not to teach. |

### Scene vocabulary

Which lexicon entries one scene's authored text actually uses, plus the proper
nouns in it. An **index into** the lexicon -- a list of ids -- not a copy of it;
band, rank and part of speech are looked up by id.

Today it is `CompiledSceneLexicon` / `SceneLemmaInfo`
(`runtime/contracts/scene-lexicon.ts`) and does store copies of atlas fields.
Plan 090 collapses it to ids and renames it, because calling a scene's subset a
"lexicon" is what made it read as a second dictionary.

**Lexicon vs scene vocabulary:** the lexicon is every word in the language; the
scene vocabulary is which of them this text uses.

### Concept

An English word plus its part of speech and provenance, inferred from prose by a
model. Introduced by Plan 090.

```jsonc
{ "word": "cheese", "pos": "noun", "provenance": "npc:finnick:bio" }
```

A concept is *what a piece of content is about*, and it is deliberately upstream
of the atlas -- concepts are English and language-neutral until they are
resolved to a lemma. `cheese` is a concept; `queso` is the lemma it resolves to.

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

Only the first exists in shipped code, and it is why a cheese-obsessed NPC never
taught `queso`: his lines are generated at runtime, so "cheese" was never in
authored text for the scan to find. Plan 090 adds the second.

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

In code the umbrella is `ScheduledTeachable` (`runtime/scheduler/teach-schedule.ts`),
whose `kind` is still `"lemma" | "function"` -- see Competency below.

### Competency

One communicative act the learner can perform, with a CEFR descriptor and a
band. Ten in Spanish: `greet`, `thank`, `request`, `ask-where`, `buy`,
`refuse-politely`, and so on.

The phrases that perform it are its **exponents** (`"donde esta"`,
`"donde está"`). Note an exponent is NOT the same as a **chunk**: a chunk is any
multi-word expression, which is what `MultiWordExpressionExtractor` finds in
authored text; an exponent is specifically a phrase that performs *this* act.

A competency is language-neutral; only its exponents are per-language.

**The code still says `function`** -- `FunctionEntry`, `functionId`,
`function-inventory.json`, `kind: "function"`. That name collides with the
programming sense on every read and is scheduled for rename after Plan 090
ships (the rename is a data migration, not just a code change). New code uses
`competency`; do not half-rename existing identifiers in passing.

### Diglot weave

Substituting target-language words into otherwise-English text, so a beginner
reads mostly English with real target words embedded. Implementation:
`runtime/classifier/diglot-weave.ts`. It is a renderer: it substitutes what it
is handed and makes no decision about what should be taught.

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
- **avoid** -- currently conflates *too hard right now* with *deliberately
  withheld*. See [domain-model-after-epic-090.md](./domain-model-after-epic-090.md).
- **lexicon** -- the atlas, a scene's subset of it, or the player-input
  `interpretLexicon`. See Lexicon above.
