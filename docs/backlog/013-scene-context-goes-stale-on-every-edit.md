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

## The cheap mitigation, independent of the above

Whatever the trigger ends up being, `(not-built)` should be VISIBLE where it
matters -- the debug HUD already says it, but the person affected is looking at
a conversation, not the HUD. A one-line warning in the teacher trace when
`sceneContext.available` is false would have made this diagnosable in seconds
instead of a full session.

## Related, found while diagnosing this

Nothing validates that a Teacher-named lemma exists in the atlas. With no scene
context the Teacher freelanced `estación` / `llegada` / `hola` from the quest
text; those happen to be real, but an invented word would pass through
`repairDirective` (its membership filter has been `null` since 090.4 removed the
prescription fence) and reach the learner with no gloss, no band, and a LemmaCard
for a word the dictionary does not have. Worth a drop-with-telemetry guard.
