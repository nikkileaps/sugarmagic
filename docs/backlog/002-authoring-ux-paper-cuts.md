# Backlog: Authoring UX paper cuts

**Source:** Running collector for small authoring-side footguns discovered while making sandbox content. Not urgent individually; each one silently wastes minutes-to-hours the first time a new author hits it.

## Items

### 1. Talk-objective quest node saves valid without a dialogue link

**Severity:** Medium (silent authoring failure)

**Symptom:** Author creates a quest with an `objectiveSubtype: "talk"` node targeting an NPC, and separately authors a dialogue for that NPC. In preview, the "Press E to talk" prompt never appears. No error, no warning — it just doesn't work.

**Root cause:** `resolveNpcDialogueDefinitionId` (`packages/runtime-core/src/coordination/quest-dialogue.ts:90`) only returns non-null for a quest-scoped NPC if the active talk-objective node has its own `dialogueDefinitionId` field populated. Just having a dialogue exist that binds to the NPC is not enough — the objective node's field must be set. If empty, the NPC becomes quest-scoped (killing the ambient-dialogue fallback) AND has no override, so the prompt is dead. The graph is structurally valid, so save succeeds without complaint.

**Action:** In the Studio quest editor, make the dialogue picker on talk-objective nodes a required field — validation error / disabled save until a dialogue is selected. To keep the authoring flow smooth (author's typical pattern is graph-first, dialogue-content-later), the picker MUST include a `+ Add New Dialogue` option that creates a placeholder dialogue (e.g. titled `"Talk to [NPC display name]"`, bound to the NPC), auto-selects it in the picker, and returns focus to the graph editor. That way "required" costs nothing — the author can always satisfy the constraint in one click without leaving the graph. Post-picker they can write the actual dialogue content whenever; the binding is already there so the runtime works from the moment the placeholder exists.

**Bonus (nice-to-have, not needed for the core fix):** Rename-safety lint — if a talk-objective's `dialogueDefinitionId` references a dialogue that was later renamed or deleted, flag it. This is a distinct failure mode from the empty-picker case and the `+` shortcut doesn't cover it.

### 2. Quest action editor uses raw text fields for `targetId` / `value`; NPC / item / flag lookups should be typed dropdowns

**Severity:** Medium (silent authoring failures + confusing labels)

**Symptom:** Nikki (2026-07-02) tried to set up "move an NPC after a quest node completes" and hit two things at once: (a) the `moveNpc` action type looked like the obvious pick but doesn't do anything at runtime (see paper cut #3), and (b) the working workflow (`setFlag` + region behavior task) exposes a field labeled "Target ID" that is actually a flag key. Same "Target ID" label appears for `giveItem` (where it's an itemDefinitionId) and `emitEvent` (where it's an event name). Copy paste an itemDefinitionId into the wrong field, or fat-finger a flag name, and the action silently fails.

**Root cause:** `QuestActionDefinition` (`packages/domain/src/quest-definition/index.ts:40`) has one polymorphic `targetId: string` and one polymorphic `value: unknown`. The Studio quest editor renders these as raw text inputs regardless of action type. The semantic meaning of "Target ID" changes per action type:
- `setFlag` -> flag key (arbitrary string chosen by the author)
- `giveItem` / `removeItem` -> itemDefinitionId (must match a real item)
- `emitEvent` -> event name (arbitrary string)
- `moveNpc` / `teleportNpc` / `setNpcState` -> npcDefinitionId (must match a real NPC)

Author has to know the shape by muscle memory. No autocomplete, no validation, no clear label per type.

**Action:** In the Studio quest editor's action inspector, switch on `action.type` and render the appropriate input:
- `setFlag`: **Flag Key** (text input, autocomplete from existing flags in the project), **Value** (text/number/boolean input based on desired valueType)
- `giveItem` / `removeItem`: **Item** (dropdown of `ItemDefinition[]`), **Quantity** (number input)
- `emitEvent`: **Event Name** (text input, maybe autocomplete from events referenced by NPC behaviors + dialogue triggers)
- `moveNpc` / `teleportNpc` / `setNpcState`: **NPC** (dropdown of `NPCDefinition[]`), destination or state as appropriate

Same pattern as the fix for paper cut #1 (talk-objective dialogue picker): make the field's semantics obvious from its label + type, and use typed pickers so the author can't fat-finger an id that doesn't exist.

### 3. `moveNpc` / `teleportNpc` / `setNpcState` / `playSound` / `spawnVfx` quest action types have no runtime handler

**Severity:** High (silent no-op — author configures an action, ships it, nothing happens at runtime)

**Symptom:** `QuestActionDefinition.type` accepts these five values (`packages/domain/src/quest-definition/index.ts:34-37`), and the Studio quest editor lets the author pick them and fill in `targetId` / `value` / `position` fields, but the runtime handler at `gameplay-session.ts:1547-1571` (`questManager.setActionHandler`) only implements `giveItem` and `removeItem`. `setFlag` and `emitEvent` are implemented inside `QuestManager` itself (`QuestManager.ts:733,738`). Everything else silently no-ops.

**Root cause:** Enum-driven authoring surface with a partially-implemented dispatcher. Either the enum members shouldn't exist, or the dispatcher should implement them (or emit a `console.warn` for unknown types so the author sees SOMETHING).

**Action:** Either (a) implement the missing handlers (`moveNpc` -> set a WorldFlag that behavior tasks can react to, or directly emit a task override; `teleportNpc` -> write to the NPC's Position component; `setNpcState` -> depends on what "state" means; `playSound` -> emit an audio event; `spawnVfx` -> emit a vfx event), OR (b) trim the enum to only the working types and hide the others from the Studio picker until they're implemented. As a minimum-effort intermediate step: at the runtime dispatcher, add a `default:` case that emits a `console.warn` naming the unhandled type — silent failure is worse than a noisy failure.

**Meta-lesson:** Any authoring surface driven off a domain enum where a runtime dispatcher branches on that enum needs a compile-time or at least run-time assertion that every enum member has a corresponding handler. Otherwise adding an enum member is a silent-authoring-failure hazard.

### 4. Studio icon system: 3D glyph set replacing raw emoji

**Severity:** Low (polish; cross-platform consistency)

Tool rails and HUD buttons use raw Unicode emoji glyphs (brush,
bone, sparkles, magnet, eraser-sponge...). Rendering differs per
OS/browser, and Unicode has gaps (no eraser emoji — currently a
sponge). The 3D emoji aesthetic is a deliberate style choice
(anti-flat) and should be KEPT — just made consistent.

**Action:** Small curated PNG glyph set in packages/ui behind a
`GlyphIcon` component: [Microsoft Fluent Emoji 3D](https://github.com/microsoft/fluentui-emoji)
(MIT) for emoji-shaped glyphs + [3dicons](https://3dicons.co)
(CC0, Blender-made) for tool gaps; any remaining hero glyphs
(eraser, box-select marquee) can be one-off in-house Blender
renders in the same style. Sweep: landscape brush toolbar, weight
workbench rail, animation mode rail, preview HUD, mode tabs.

### 5. Undo/redo is unreliable: half the editor mutates the session outside command history

**Severity:** High (destroys trust in Cmd+Z; authors stop using it and hand-revert mistakes)

**Symptom:** nikki (2026-07-10), while blocking out the Arrival
Station region: undo behaves unpredictably — some edits undo,
some don't, and undoing past a non-undoable edit can appear to
"undo the wrong thing." Concrete symptom list still being
collected in the field; the architecture makes the general shape
inevitable (below).

**Root cause (structural):** two parallel mutation paths write to
the authoring session:
1. `applyCommand(session, ...)` — semantic commands, tracked by
   undo history (placements, transforms, landscape paint/sketch,
   channel edits, ...).
2. Direct `projectStore.updateSession(sessionFn(...))` — session
   helper functions that BYPASS history entirely. From one day's
   work alone: asset/texture/material/audio definition imports and
   removals, `updateAssetDefinitionInSession` (renames + surface
   slot bindings), scene updates, character model commits.

Undo pops commands off the history stack, but the un-tracked
mutations interleave with tracked ones. Undoing a tracked command
after an un-tracked mutation replays the older state WITHOUT the
un-tracked change's context — from the author's seat, undo
either "skips" edits or clobbers newer ones. There may also be
secondary issues (drafts/preview stores not resetting on undo)
but the two-path split is the disease.

**Action (needs a proper plan/epic, not a paper-cut fix):**
- Audit every `projectStore.updateSession` call site in
  apps/studio (grep is cheap; the list is long) and classify:
  should-be-a-command vs. legitimately-outside-history (project
  load, save-clean marking).
- Pick the architecture: either (a) promote everything user-
  visible to semantic commands so the command stack IS the
  truth, or (b) switch undo history to session snapshots
  (immutable spreads make structural sharing cheap; large blob
  payloads like sketch ink and paint need care) so ALL mutations
  are captured uniformly regardless of path. (b) is more robust
  to future drift — new code can't forget to be undoable.
- Whatever is chosen: one enforcer. A lint or runtime assert
  that flags new direct-mutation paths, or delete the direct
  path entirely.
- Include redo, and define undo scope boundaries (per-region?
  per-workspace? global?) explicitly instead of inheriting them
  from implementation accident.
