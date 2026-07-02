# Backlog: Authoring UX paper cuts

**Source:** Running collector for small authoring-side footguns discovered while making sandbox content. Not urgent individually; each one silently wastes minutes-to-hours the first time a new author hits it.

## Items

### 1. Talk-objective quest node saves valid without a dialogue link

**Severity:** Medium (silent authoring failure)

**Symptom:** Author creates a quest with an `objectiveSubtype: "talk"` node targeting an NPC, and separately authors a dialogue for that NPC. In preview, the "Press E to talk" prompt never appears. No error, no warning — it just doesn't work.

**Root cause:** `resolveNpcDialogueDefinitionId` (`packages/runtime-core/src/coordination/quest-dialogue.ts:90`) only returns non-null for a quest-scoped NPC if the active talk-objective node has its own `dialogueDefinitionId` field populated. Just having a dialogue exist that binds to the NPC is not enough — the objective node's field must be set. If empty, the NPC becomes quest-scoped (killing the ambient-dialogue fallback) AND has no override, so the prompt is dead. The graph is structurally valid, so save succeeds without complaint.

**Action:** In the Studio quest editor, make the dialogue picker on talk-objective nodes a required field — validation error / disabled save until a dialogue is selected. To keep the authoring flow smooth (author's typical pattern is graph-first, dialogue-content-later), the picker MUST include a `+ Add New Dialogue` option that creates a placeholder dialogue (e.g. titled `"Talk to [NPC display name]"`, bound to the NPC), auto-selects it in the picker, and returns focus to the graph editor. That way "required" costs nothing — the author can always satisfy the constraint in one click without leaving the graph. Post-picker they can write the actual dialogue content whenever; the binding is already there so the runtime works from the moment the placeholder exists.

**Bonus (nice-to-have, not needed for the core fix):** Rename-safety lint — if a talk-objective's `dialogueDefinitionId` references a dialogue that was later renamed or deleted, flag it. This is a distinct failure mode from the empty-picker case and the `+` shortcut doesn't cover it.
