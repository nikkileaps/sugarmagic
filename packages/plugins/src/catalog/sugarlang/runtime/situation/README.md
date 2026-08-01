# Situation Runtime Module

The SITUATION is what the Teacher reads: the cached, scene-scoped half composed
with the runtime facts only the live game knows.

```
SceneContextModel        compile-time, cached on content hash
  + quest node, time of day, learned facts, recent world events
  --------------------------------------------------------------
= SITUATION              what the Teacher is handed
```

Source of truth:
- `SceneContextModel` (owned by the compile pass) for what the scene is ABOUT
- `ConversationRuntimeContext` (owned by runtime-core) for the live half

Single enforcer:
- `composeSituation` is the only way a Situation is built

## Import through `index.ts`

Everything outside this directory imports from `runtime/situation`.

## Two rules that are easy to break

**1. Empty is not missing.** Every runtime field is a `RuntimeFact<T>`, not
`T | undefined`, so `?? []` cannot silently turn "we could not read what the
player knows" into "the player knows nothing". Anything rendering a fact to the
Teacher must branch on `available`. This bug shape has appeared three times in
epic 090 -- a vacuous `every` over an empty array, an `undefined === undefined`
band comparison, and this -- so the type makes it hard rather than the comment
asking nicely.

**2. Composition is total.** `composeSituation({ sceneId })` with nothing else is
valid and returns a situation where every field is unavailable. The blackboard is
raw untyped state that can be missing for reasons this module cannot see; if
absence were an error the Teacher would be unreachable whenever the world was
mid-transition.

## Does NOT do

**Filter NPC presence.** A situation may name an NPC who has left the scene.
That is deliberate (Plan 090.3): presence is a placement with an optional
condition, so "left the scene" and "gated behind a world flag" are one mechanism,
and the shared evaluator denies any flag-gated presence when no flag predicate is
supplied -- which the plugin-visible runtime context does not have. Filtering
would delete an NPC who IS standing there, silently. A stale name is visibly
wrong; a vanished NPC is not.
