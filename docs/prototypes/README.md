# Prototypes

Throwaway pages that answer one question each. Not product code, not imported by
anything, safe to delete once the question is settled.

Serve them with `python3 -m http.server` from this directory -- `file://` is
blocked for some tooling.

---

## paper-dialogue-box*.html

**Question:** can a paper card with a deckled edge and a fibrous texture flex to
arbitrary width and height -- the way the design sheet requires -- without moving
text layout into three.js?

**Answer: yes, and the layout half is free.** The scripted dialogue box is
already DOM (`ScriptedDialogueBox.ts`), and its existing structure is already the
design sheet's component tree:

| design sheet | `ScriptedDialogueBox.ts` |
|---|---|
| `DialogueBox` | `container` |
| `NameChip` | `speaker` (`.sm-dialogue-box-speaker`) |
| `Panel` | `box` (`.sm-dialogue-box`) |
| `TextContainer` | `body` |
| `ArrowButton` | `advance` |

Auto-width chip, auto-height panel, reflow, corner anchoring and UI scaling are
all native CSS. The design sheet's recommendation to rebuild this in three.js
would solve the easy half (shader-driven edges) by making the hard half -- text
layout, wrapping, reflow -- dramatically worse.

### CHOSEN: E1, in `paper-dialogue-box-v4.html`

nikki, 2026-08-01: *"I actually like E1 the best -- it maintains the shape of the
box the best while still having the rough edges and a slightly hand worn look."*

```js
amp:  2.4    // displacement in px along the outward normal
rad:  30     // corner radius
step: 2.5    // perimeter sampling -- see the Nyquist note below
rim:  0.16   // edge stroke opacity; the paper-thickness read
mottle: 0.12 // parchment turbulence alpha (the "rich" variant is 0.22)
harmonics: [[2,1],[5,.55],[11,.3],[23,.16],[47,.09]]
```

The harmonics are INTEGERS on purpose. They are harmonics of the perimeter, so
the noise is periodic over it and closes exactly -- no seam where the walk
started.

### What each version established

- **v1** -- three techniques compared. 9-slice `border-image` ELIMINATED: on a
  tall box it did not merely tile visibly, it split the panel in half with text
  spilling through the gap. Canvas cut its corners off. SVG turbulence survived.
- **v2** -- canvas corners fixed (v1's edge walker traced the four straight sides
  and skipped the corner arcs entirely, so `closePath` joined them with
  diagonals). Attempted to de-jag the SVG with blur + alpha re-sharpen.
- **v3** -- the de-jagging attempt was wrong. `feDisplacementMap` does not
  displace geometry, it displaces a RASTERISED buffer sampled on the filter's
  pixel grid, so the edge is quantised before anything else happens -- and a
  steep alpha ramp then pulls the blurred steps back into hard transitions. Blur
  and sharpen were fighting each other. FIX: stop using a filter for the SHAPE.
  The outline became a real `<path>`, which the rasteriser antialiases as vector
  geometry at full device resolution. Turbulence still does the FILL, where there
  is no silhouette to stair-step.
- **v4** -- v3 read as "wobbly" rather than "torn". The cause was FREQUENCY, not
  amplitude: the reference has many small fibre-scale nicks, v3 had a few long
  smooth waves. Three things capped the detail -- a 6px perimeter step (Nyquist:
  nothing finer than ~12px could be represented at all), noise built from four
  low-frequency sines, and midpoint smoothing flattening what survived.

  **D1 and E1 have nearly the same displacement (2.6 vs 2.4px) and read
  completely differently.** That is the whole finding: spread over long waves it
  looks tidy; broken into fibre-scale octaves it looks hand-worn.

### Still open before this lands in the product

- Restyle `ScriptedDialogueBox` and wire path regeneration into its lifecycle
  (the path must be rebuilt on resize; it is string building, so cheap).
- Try it against a real game backdrop -- these pages use a brown gradient
  stand-in, not actual scene art.
- The FONT. The reference's rounded humanist face does a lot of the work and
  none of these pages match it.
- The gold/blue introduce/reinforce treatments and the celebrate animation are
  carried through UNCHANGED and must stay that way. They are not decoration:
  gold means new, blue means review, and the animation fires when the player
  types a taught word.

### Trap worth remembering

`calc((var(--pad)+6px) * var(--ui-scale))` cost a debugging round. CSS `calc`
requires whitespace around `+`, so once `--pad` substituted to `28px` the value
was invalid -- and a `var()` substitution failure is *invalid at computed-value
time*, which falls back to the property's INITIAL value (0), NOT to the `padding`
shorthand on the line above. Result: `padding-top: 0` while the other three sides
stayed 28px, and every first line of text slid under the name chip. It is
invisible reading the source; it took dumping the parsed CSSOM to see it.
