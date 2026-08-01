# Backlog 009 -- target-language ratio drifts upward across a conversation

Raised 2026-07-28, from a Finnick playthrough during Plan 090.4.

## What was observed

An A1 learner, directed ratio 0.3, anchored posture. Measured Spanish per NPC
turn, eyeballed from the transcript:

```
15%  ->  40%  ->  30%  ->  20%  ->  20%  ->  45%  ->  35%  ->  90%
```

The last turn was effectively all Spanish, multi-clause, well past A1:

> "¡Wow! En cada estación, la comida de los animales cambia. El verano tiene
> hierba verde y fresca. El queso de verano es dulce y ligero..."

Every instruction in the generate prompt was correct at the time -- 30%,
anchored, single-clause, A1 envelope. The Teacher chose right; the generator
ignored it.

## Two mechanisms, both structural

Not "the model got carried away". Two things in the prompt's shape.

**1. The conversation few-shots itself.** The generator prompt ends with raw
history, including the model's OWN prior turns, unannotated:

```
Recent history:
assistant: ¡Sí, sí! Oh man, I'm so excited! ... queso fuerte or queso suave? ... in verano, you know?
```

A model infers register from two recent exemplars far more strongly than from an
instruction line further up. So turn N's output becomes turn N+1's style
exemplar, and any excursion above target becomes the new baseline. The
instruction is constant; the exemplar drifts. That is a fight the instruction
loses.

**2. A proportion enforced with a count.** The prompt asks for both:

- "about 30% of the reply" -- a PROPORTION
- "Reinforce: queso, verano. Introduce: estación, hacer" -- a COUNT

Those agree at exactly one reply length. Four Spanish words IS ~30% of a short
reply; in a long one, keeping four words natural across several sentences means
building Spanish sentences around them. The ratio climbs with length while the
model obeys both instructions.

The final turn is where the reply got long: turn path switched `social_fast` ->
`grounded` and the player asked "tell me why queso is different each season".
That is the 35% -> 90% step change -- a task change, not a mood. Same reason
`sentenceComplexityCap: single-clause` lost: you cannot explain seasonal milk
chemistry in single clauses, so something had to give.

## Already fixed (090.4)

`RatioConformance` had no `over-ratio` -- too much target language was not an
expressible verdict, so no gate could reject it. Added, with a ceiling of
`max(0.35, directed * 2)`, and the verify middleware now fails on it. Candidate
scoring changed from `min(measured/directed, 1)` (which scored 3x-over as
perfect) to distance-from-target.

**That stops the runaway; it does NOT remove the ratchet.** Drift can still walk
up to just under the ceiling and sit there, because each passing turn is still
the next turn's exemplar.

## Do the cheap experiment first (nikki)

Before plumbing anything: **hardcode the annotations into the prompt by hand and
see whether it even helps.** History belongs to sugaragent, so changing how it is
fed means touching a cross-plugin contract -- not worth doing on a hypothesis.

Concretely: paste a history block with per-turn ratio annotations ("this turn
was 45%, above target") into a generate prompt and compare output against the
same prompt with raw history. If register does not correct, mechanism 1 is not
the dominant term and the whole plumbing idea is dead.

Also worth measuring first: a scripted conversation at a fixed directed ratio,
logging measured ratio per turn. If it climbs steadily, it is feedback. If it is
flat with one spike at the explanation turn, it is purely the length mismatch
and only mechanism 2 needs fixing -- which is much cheaper.

## Candidate fixes, increasing intrusiveness

1. **Measure the conversation, not just the turn.** Verify already computes a
   per-turn ratio and nothing looks at the trend. If the last three turns
   averaged 0.55 against a directed 0.3, say so in the next turn's instruction.
2. **Reconcile the count with the length.** Scale how many slate items reach one
   turn by how long that turn is likely to be. A `grounded` explanation turn
   should carry fewer mandated words than a `social_fast` one, not the same two.
   (The per-turn cap is `MAX_PROMPT_INTRODUCE` in generator-prompt-overlay.)
3. **Stop handing the model raw history as an exemplar** -- annotate it, or feed
   a summary. The real fix, and the one that touches sugaragent.

## Related

- Sentence complexity may be unenforced entirely. The same turn violated
  `single-clause` and nothing caught it; the ratio gate is now two-sided but no
  equivalent check was found for complexity. Worth confirming before assuming
  it works.
- A test asserted the old one-sided behavior as correct ("returns conformant for
  full Spanish at anchored posture"). It was accurate when written and outlived
  its assumption. Inverted in 090.4.
