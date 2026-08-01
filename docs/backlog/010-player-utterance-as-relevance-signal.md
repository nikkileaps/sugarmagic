# Backlog 010 -- the player's utterance is not a relevance signal

Raised 2026-07-30, from a Finnick playthrough during Plan 090.

## What was observed

```
Player       Oh okay great! I'm looking for my suitcase ... have you seen one around here?
Finnick      Oh man, ¿una maleta? No no, haven't seen one around la estación ...
```

`maleta` arrived unglossed and untracked. The player named a concept out loud,
the generator translated it correctly and spontaneously, and nothing in the
selection path noticed that a teaching opportunity had just walked in.

## Root cause

Nothing that computes relevance takes the player's current utterance as an
input. Relevance is derived entirely from **authored, static** content:

- `runtime/compile/scene-context-extractor.ts` -- concepts extracted from
  authored NPC prose, regions, quests, documents, lore, dialogue.
- `runtime/budgeter/scoring.ts:36-53` -- `SCORING_WEIGHTS` has `w_scene: 0.9`
  and `w_npc: 0.7`, both keyed to authored content. There is no term for
  "the player just said this."

`scoring.ts:47-49` even uses this exact case as its worked example of correct
behavior:

```
/** NPC relevance: bonus for words from the NPC the player is currently
 *  talking to. "queso" from Rick Roll's lore should outrank "maleta"
 *  from the Station Manager's quest when talking to Rick. */
```

That reasoning is right. Cheese vocabulary SHOULD beat luggage vocabulary when
talking to a cheesemonger. The formula is not wrong; it is missing a term.

## The shape of the fix (nikki's framing -- do not lose this)

Relevance is a property of the scene **AND** the moment -- the situation. Not
one or the other.

An utterance-derived signal is a **weighted term, not an override**. Something
the player said gets weighted up, but it may still lose to a scene concept that
is prevalent enough -- cheese, when talking to the cheesemonger, can legitimately
keep winning. The goal is that `maleta` becomes *competitive*, not that it wins.

That should be a matter of tuning weights in `SCORING_WEIGHTS`, alongside the
existing scene/npc/frequency terms, rather than a new special-cased path.

Open question for when this is picked up: what is the decay? An utterance is a
spike, not a standing property -- a word the player said eight turns ago should
not still be outranking the scene.

## Related, but do NOT fix here

Found in the same investigation, deliberately deferred:

- **Ambient marking does not exist.** The `focus | recall | challenge | ambient
  | unmarked` role set is prose in the `graded-text-marker.ts` header and in the
  090 plan; there is no role type in code, and the marker never runs on
  free-form NPC replies (only item views and scripted dialogue). This is 090.11
  scope and is being handled there. It is the *detector* that would have
  surfaced this case without a playthrough.
- **Synonym families fragment at the atlas join.** `resolveFromGloss` indexes
  only the primary (first) gloss (`cefr-lex-atlas-provider.ts:153`), so
  `suitcase -> maleta` (A1, rank 700), `luggage -> equipaje` (A1, rank 1865),
  and `baggage -> bagaje` (**B2, rank 10328**) are three unrelated rows. A
  reasonable A1 concept label can therefore yield an out-of-reach B2 word, and
  on the LLM Teacher path nothing filters it -- `formatTeachableHere`
  (`prompt-builder.ts:419-453`) applies no band, learner-status, or count
  filter. The primary-only rule exists for a good reason (see the `claim` /
  `afirmar` comment at `:148-152`); this needs its own think, not a quick patch.
- `{ miss: "no-gloss" }` has no diagnostics counter
  (`scene-teachable-resolver.ts:191-198` counts only `pos-filtered` and
  `multi-word`). Concepts that reach the atlas and miss are invisible except by
  subtraction.
- `MAX_SCENE_LEMMAS = 6` (`prompt-builder.ts:57`) is dead; no references
  repo-wide.

## Related

- [009](009-target-language-ratio-drift.md) -- same structural shape: a
  one-sided model of a quantity that has more than one side.
