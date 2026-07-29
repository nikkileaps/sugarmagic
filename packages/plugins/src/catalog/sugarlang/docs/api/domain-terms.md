# Domain Terms

Status: Updated in Epic 090

The nouns sugarlang uses, and the distinctions between the ones that sound
alike. Every definition below cites the type or file that owns it; if the code
and this document disagree, the code is right and this document is stale.

For how these fit together as a system, see [domain-model.md](./domain-model.md).

---

## The core five

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

### Scene vocabulary

Which atlas lemmas one scene's authored text actually uses, plus the proper nouns
in it. An **index into** the atlas -- a list of ids -- not a copy of it; band,
rank and part of speech are looked up from the atlas by id.

Today it is `CompiledSceneLexicon` / `SceneLemmaInfo`
(`runtime/contracts/scene-lexicon.ts`) and does store copies. Plan 090 collapses
it and drops the "lexicon" name, because the atlas is the lexicon.

**Atlas vs scene vocabulary:** the atlas is the dictionary; the scene vocabulary
is which entries this text uses.

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

### Function / chunk

A **function** is a communicative move ("greeting", "asking price") rather than
a word; see [sugarlang-function-inventory](../../../../../../docs/api/sugarlang-function-inventory.md).
A **chunk** is a multi-word expression treated as one teachable unit
(`MultiWordExpressionExtractor`).

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
