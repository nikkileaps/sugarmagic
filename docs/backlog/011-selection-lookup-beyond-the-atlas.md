# 011 -- Selection lookup beyond the atlas

Deferred from Plan 090 story 090.12 (select-to-translate), which ships
**atlas-only** lookup on conversation lines. This item is only about answering a
span the shipped atlas cannot. The larger idea -- lookups GROWING the lexicon --
was split out to backlog 012, because it changes where curriculum comes from
rather than how a lookup is answered.

Date: 2026-07-30
Owner: nikki

---

## A. Translate what the atlas cannot, and cache it

090.12 resolves a selected span by `MorphologyLoader` (surface -> lemma) then
`atlas.getGloss(lemmaId, targetLang, supportLang)`. That covers most of what a
player will select, because the generator is fenced to A1+1 band and instructed
never to invent words -- ambient target language is overwhelmingly atlas
vocabulary.

It misses in two places:

- **multi-word phrases the model composed**, which are not chunks, not
  competency exponents, and not in the atlas as a unit
- **genuinely out-of-atlas words** (the es atlas is ~11,000 entries)

The shape that was designed and deferred:

1. atlas lookup -- free, instant, offline
2. on miss, ONE gateway call translating that exact span
3. cache by `(normalizedText, targetLanguage, supportLanguage)`, permanently

**NOT NECESSARILY AN LLM CALL** (nikki, 2026-07-30). For a single word, a
machine-translation API is the far cheaper instrument. The cost structures are
different in kind, not degree: MT prices per CHARACTER with no per-call
overhead, while an LLM pays an unavoidable system-prompt tax on every call
regardless of how short the input is. A one-word lookup is close to free on MT
and structurally cannot be on an LLM.

The tradeoff is sense disambiguation, and it maps onto the same split:

| Selected span | Instrument | Why |
|---|---|---|
| single word, in the atlas | atlas gloss | free, offline, already curated |
| single word, out of atlas | MT | cheapest per lookup; sense errors possible (`banco` -> bank / bench) |
| multi-word phrase | LLM | needs the surrounding line to pick the right reading, and phrase meaning is not compositional |

So the fallback is plausibly TWO fallbacks, chosen by span shape. Worth
measuring before committing: if out-of-atlas single words turn out to be rare
(the generator is band-fenced), the MT tier may not earn its integration cost
and everything past the atlas could just be the LLM path.

The cache is what makes it affordable rather than a per-lookup bill: a phrase is
translated once, ever. Same content-hash-cache pattern the variant and chunk
pipelines already use, so it is a known shape here rather than a new one.
Latency only appears on a true miss, and the player has already committed to
waiting by selecting.

## B. Other surfaces

090.12 covers conversation lines only. The same gesture plausibly belongs on
item descriptions, lore pages and quest text -- everywhere target language is
rendered. Deferred because it widens the story past the seam
(`dialogueHighlight`) that 090.12 already has to touch.

## C. Lookups as a learner signal

Explicitly NOT built, and the reasoning should survive:

A lookup is evidence of INTEREST, not evidence of KNOWLEDGE STATE. FSRS models
the latter. Feeding "was curious about" into a decay curve built for
"knows / does not know" would corrupt the loop that currently works.

There is a real signal in it -- repeatedly looking up above-band words says the
learner is reaching, which is genuine capacity information the Teacher could
read. But that is speculative learner modelling of exactly the shape 090.5
deleted (the fatigue/strain curve, which shipped tuned constants for a
behaviour nobody had evidence players wanted).

So: **record lookups as telemetry, build nothing on them, decide later with
real data.** The telemetry is independently useful as authoring feedback --
"players keep looking up X in this scene" is a content signal.

## Revisit trigger

Take section A when a playtest shows selections landing on spans the atlas cannot
answer often enough to feel broken. Everything downstream of that -- shared
caching, lexicon promotion -- is backlog 012 and waits on the telemetry A
produces.
