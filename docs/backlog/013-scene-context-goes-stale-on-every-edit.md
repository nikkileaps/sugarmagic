# 013 -- Scene context goes stale on every authoring edit

Found in play 2026-07-31 (nikki). Add a dialogue node, start a conversation, and
the Teacher gets NO vocabulary at all -- not a degraded list, none.

Date: 2026-07-31
Owner: nikki

---

## What happens

The scene context model is keyed on `{contentHash, supportLanguage, promptVersion}`.
Editing any authored content in a scene changes its content hash, so the cached
model no longer matches and the runtime reports it absent:

```
SITUATION:
- about: (unknown)
- teachable here: (unknown)
```

`sceneContext.available: false`. The debug HUD shows `context (not-built)`.

The Teacher then has no concepts, and concepts are where ALL vocabulary comes
from (concept -> atlas resolution -> lemma). Competencies still appear, because
those come from the static inventory file and do not depend on the scene -- which
is why the prompt shows a competency menu and no vocabulary, and why a
cheese-obsessed NPC taught `estación` and `llegada` instead of `queso`.

## Why it is worse than "stale cache"

Nothing tells the author. The conversation still runs, the NPC still speaks, the
language ratio is still right -- it just quietly stops teaching anything the
scene is about. The failure presents as "the Teacher made a boring choice",
which is indistinguishable from a tuning problem and sent one debugging session
looking at the wrong layer entirely.

Extraction is a gateway call and a Studio-only pass, so the runtime cannot
rebuild it lazily the way it can rebuild the vocabulary model. Someone has to
press Rebuild, and nothing says so.

## What nikki wants

> "make it so we can make changes to the scene auto rebuild asynchronously so
> this doesn't keep happening"

An async rebuild triggered by authoring changes, rather than an explicit manual
step the author has to remember after every edit.

## Things that have to be decided

- **What triggers it.** On save, on a debounce, on scene close, on preview
  launch. `notifySceneChanged` and `scheduleDialogue` already exist with ZERO
  callers repo-wide (noted in 090.1) -- the debounce seam was built and never
  wired, so this may be less new work than it looks.
- **Cost.** Extraction is a gateway call per scene. A rebuild on every keystroke
  is unaffordable; a rebuild on every save might be fine. Needs a real number.
- **What the author sees while it runs.** A scene mid-rebuild has no context, so
  a preview launched during one hits exactly today's bug. Either block, or show
  it clearly, or serve the previous model until the new one lands.

## Where the "not built" signal belongs

NOT in the runtime, and not in the teacher trace (nikki, 2026-07-31):

> "the person affected is playing a game -- i'm not going to surface fucking
> errors to that person unless its catastrophic and the game cannot be played
> any more or data would be lost"

Worth noting the trace is more player-facing than it looks: `traceEnabled()`
returns true for ANY browser with the flag unset, so it is on in a shipped game,
not only in a Studio preview. A stale-context warning there would put an
AUTHORING failure in a player's console.

This is an authoring problem and the signal belongs on the authoring side --
Studio already shows `context (not-built)` in the debug HUD. If that needs to be
louder, it gets louder in Studio.

## Related, found while diagnosing this

Nothing validates that a Teacher-named lemma exists in the atlas. With no scene
context the Teacher freelanced `estación` / `llegada` / `hola` from the quest
text. They reach the learner with no gloss and no band, and a LemmaCard is
created for a word the dictionary does not have.

DO NOT DROP THEM (nikki, 2026-07-31):

> "if we drop them how the fuck are we going to make coherent sentences?"

The atlas is ~11,000 entries -- an INCOMPLETE dictionary. A Spanish word missing
from it is a gap in our lexicon, not an invented word, so discarding the
Teacher's choice lets a limited dictionary veto a sound pedagogical judgment and
leaves the line with less to teach for no gain.

EMIT TELEMETRY INSTEAD, and note where it points: a Teacher-chosen lemma the
atlas cannot supply is the same signal as
[backlog 012](./012-lookup-telemetry-grows-the-lexicon.md) -- a word the
curriculum reached for and the dictionary could not answer. Arguably a better
source than player lookups, because it is the Teacher reaching rather than a
player guessing. The missing gloss is the real user-visible symptom and is worth
solving on its own (011's MT/LLM fallback would answer it).
