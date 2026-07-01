# Backlog: Authoring UX paper cuts

**Source:** Running collector for small authoring-side footguns discovered while making sandbox content. Not urgent individually; each one silently wastes minutes-to-hours the first time a new author hits it.

## Items

### 1. Talk-objective quest node saves valid without a dialogue link

**Severity:** Medium (silent authoring failure)

**Symptom:** Author creates a quest with an `objectiveSubtype: "talk"` node targeting an NPC, and separately authors a dialogue for that NPC. In preview, the "Press E to talk" prompt never appears. No error, no warning — it just doesn't work.

**Root cause:** `resolveNpcDialogueDefinitionId` (`packages/runtime-core/src/coordination/quest-dialogue.ts:90`) only returns non-null for a quest-scoped NPC if the active talk-objective node has its own `dialogueDefinitionId` field populated. Just having a dialogue exist that binds to the NPC is not enough — the objective node's field must be set. If empty, the NPC becomes quest-scoped (killing the ambient-dialogue fallback) AND has no override, so the prompt is dead. The graph is structurally valid, so save succeeds without complaint.

**Action:** In the Studio quest editor, make the dialogue picker on talk-objective nodes a required field — either block save with a validation error, or auto-open a picker (with an "Author new dialogue" affordance) when the objective's subtype is set to `talk` and `dialogueDefinitionId` is empty. Bonus: surface a global lint pass that flags all talk-objectives with no dialogue, since this can also happen when a dialogue gets renamed or deleted after the fact.
