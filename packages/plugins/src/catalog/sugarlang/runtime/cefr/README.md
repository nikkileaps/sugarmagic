# CEFR Runtime Module

The CEFR band scale: which bands exist, and what "higher" means.

Source of truth:
- `CEFRBand` -- the six bands
- `CEFR_BAND_ORDER` -- their order, ascending

Single enforcer:
- `compareCefrBands` / `isBandAbove` / `bandIndex` are the only supported way to
  compare bands

## Why this is its own module

A band is not a learner fact. A **word** has a band (the atlas), a stretch of
**text** has a band (the classifier), a **placement question** has a band, and a
learner has one too. Filing the scale under any one of those owners forces the
other four to depend on a module they have no business depending on.

It used to live in `contracts/learner-profile.ts`, which meant the Studio density
histogram imported a learner contract in order to draw a bar chart. The result
was seven copies of the same six-element array, under seven names, across
classifier / learner / scheduler / grading / placement and twice in the Studio
shell -- not because anyone was careless, but because there was no home every
caller could legally reach.

## Depends on

Nothing. That is the point: everything that speaks about level can depend on it.

## Note on `delta`

`isBandAbove(band, reference, delta)` takes a delta because the call sites
genuinely disagree, and must keep disagreeing: `delta 0` is a strict stretch gate
on competencies, `delta 1` is the in-reach boundary on lemmas. Folding those into
one number is a behavior change, not a cleanup.
