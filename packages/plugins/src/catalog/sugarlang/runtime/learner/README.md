# Learner Runtime Module

This module owns sugarlang's learner state: its types, its write path, its
persistence, and what the learner knows.

Source of truth:
- `LearnerProfile` in the blackboard for the live runtime view
- `CardStore` for persisted lemma-card durability
- `LearningStatus` for where a learner stands on any one item

Single enforcer:
- `LearnerStateReducer` is the only supported writer of the learner profile fact
- `DUE_RETRIEVABILITY_FLOOR` / `FLUENCY_RETRIEVABILITY_FLOOR` are declared here
  and nowhere else; the scheduler re-exports them rather than redeclaring

Primary responsibilities:
- learner-state types (`LearnerProfile`, `LemmaCard`, session signals, assessment)
- CEFR posterior math
- learning status -- unseen / learning / due / known / out-of-reach
- session-signal derivation
- learner-profile save/load helpers
- blackboard fact definitions
- card-store and teach-record-store implementations

## Import through `index.ts`

Everything outside this directory imports from `runtime/learner`, never from a
file inside it. That rule used to live in this README as "editor UI must not
depend on its internals" and was unenforceable: there was no public entry, so
every caller deep-imported and "internals" described the whole module.

`LearnerStateReducer` is exported despite being the single writer -- something
has to construct it, and `runtime-services` does. "Single enforcer" means it is
the only supported *writer*, not that it is unreachable.

## Does NOT own

The CEFR band scale. A word has a band and a paragraph has a band, so the scale
lives in `runtime/cefr` and this module depends on it. `LearningStatus` is the
join of the two: a card's state (here) against an item's band and the learner's
band (there).
