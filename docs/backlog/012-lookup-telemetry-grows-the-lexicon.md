# 012 -- Lookup telemetry grows the lexicon

Split out of backlog 011 (2026-07-30) because it was buried inside a
translation-fallback item and is not that. 011 is "answer a word the shipped
atlas cannot". THIS is a change to **where curriculum comes from**.

Date: 2026-07-30
Owner: nikki

---

## The idea

nikki, 2026-07-30. A per-install translation cache is the small version. The
real one is a **global cache in the gateway server**, shared across users, with
a promotion rule:

> when X% of users at level Y look up the same span, add it to the lexicon
> automatically

Today the atlas is a fixed shipped artifact (~11,000 entries for es) and the
only way a word enters it is an authoring decision. This inverts that: **player
curiosity becomes a source of curriculum.** The words learners actually reach
for get promoted into the thing that teaches them, with nobody maintaining a
list.

That is a genuinely different claim from anything else in the language stack,
which is why it is not a bullet under a caching story.

## Why it is not just "cache the translations"

The cache is the mechanism; the promotion rule is the feature. They separate
cleanly:

| Shared cache | cost optimisation -- one translation serves every user |
| Promotion rule | curriculum change -- a looked-up span becomes teachable |

You can ship the first without the second. The second is what needs thinking
about, and it cannot be inferred from lookup counts alone.

## Open questions, none of them small

- **Whose band counts.** A C1 word looked up by A1 learners means something
  different from the same word looked up by B2 learners. The first is probably
  "the generator is drifting above band"; the second is "these learners are
  ready for this". The same raw count supports opposite conclusions.
- **What "added to the lexicon" concretely means.** An atlas entry carries a
  CEFR band and a frequency rank, and both have to come from somewhere. Options:
  derive a band from who is looking it up (circular, but maybe usefully so), or
  admit a lighter gloss-only tier the Teacher may name while the band envelope
  treats it differently. The second avoids inventing numbers.
- **Privacy and aggregation.** Lookups are player behaviour leaving the device.
  What is stored, at what granularity, for how long, and does a player know.
- **Poisoning.** A shared cache written from model output is a shared cache of
  UNREVIEWED translations. Promoting one into the atlas promotes it into
  teaching. Some confidence gate or review step stands between "cached" and
  "curriculum", and deciding what it is is most of the work.
- **Feedback loop.** Words in the atlas are more likely to be taught, taught
  words are more likely to be looked up, looked-up words get promoted. Worth
  checking whether the rule is self-reinforcing in a way that narrows the
  curriculum rather than growing it.

## Depends on

Backlog 011 §A (the translation fallback and its per-install cache) -- there is
nothing to aggregate until spans are being translated and recorded. And on
lookup telemetry existing at all, which Plan 090 story 090.12 emits.

## Revisit trigger

When there is enough lookup telemetry to answer the prior question: **do the
same spans recur across users at all?** If they do not, the shared cache buys
nothing and the promotion rule has no input, and this item closes without being
built. Measure before designing.
