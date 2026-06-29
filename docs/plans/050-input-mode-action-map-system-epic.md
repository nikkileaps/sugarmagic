# Plan 050: Input Mode / Action Map System

**Status:** Proposed
**Date:** 2026-06-26 (scoped down 2026-06-29)

> Surfaces from a Plan 047 §47.7.5 follow-up: with the LoginModal
> rendering over the runtime canvas, in-game keyboard shortcuts
> (`i` for inventory, `j` for journal, etc.) started firing while
> the user typed their email into the modal. The autofocus
> band-aid fixed that specific case, but the deeper bug is that
> runtime-core's shortcut handlers each register their own
> `window.addEventListener("keydown")` and consult only
> `event.target instanceof HTMLInputElement` — they never check
> the runtime's pause / menu state. Hitting `i` during the game's
> own start menu still opens the inventory. This plan replaces
> the per-handler check pattern with a single central registry
> + active-mode state.

## Epic

### Title

Input modes + action maps as a first-class runtime contract.

### Why now (not later)

Six shortcut handlers exist today (inventory, quest journal,
document, spell menu, dialogue, debug HUD), each owning its own
`window.addEventListener` + DIY gating. Every new plugin or
handler that lands without a central registry cements the
duplication; the migration grows linearly with handler count.
AGENTS.md is explicit: "If two systems appear to enforce the
same behavior, that is a bug, not flexibility." Refactor now,
while the surface area is bounded — six handlers is the
cheapest moment to land the single-enforcer pattern.

### Goal

- **One source of truth for "should this shortcut fire right
  now?"** — a `RuntimeMode` value derived from `UIStateStore`,
  read by the central input router on every keydown. Handlers
  declare *intent* (`{actionId, modes, key, handler}`), not
  *plumbing* (window listener + state check).
- **The active mode gates which actions fire.** Mode `in-game`
  enables inventory / journal / spells / pause; mode `paused`
  enables only resume; mode `dialogue` enables advance / option
  pick; mode `login-modal` enables nothing (typing into the
  input is the only behavior). Handlers don't consult
  `isPaused` directly anywhere.
- **The six existing scattered handlers stop owning their
  registration.** They register against the central registry on
  mount, unregister on unmount. The DIY
  `event.target instanceof HTMLInputElement` checks delete.
- **The autofocus band-aid from Plan 047 §47.7.5 retires.** The
  `login-modal` mode disables in-game actions structurally;
  autofocus becomes a UX nicety rather than a correctness
  band-aid.

### Context

The current state is partially layered:

- `UIStateStore` (`packages/runtime-core/src/ui-context/index.ts`)
  carries `visibleMenuKey` + `isPaused` — exactly the data the
  active-mode resolver needs.
- `UIActionRegistry` (`packages/runtime-core/src/ui-actions/index.ts`)
  registers menu-driven semantic actions (`start-new-game`,
  `pause-game`, `resume-game`). That's UI-side actions invoked
  by mouse-click on a menu — orthogonal to keyboard bindings.
- Keyboard listeners are scattered: inventory, quest journal,
  document, dialogue, spell menu, debug HUD — each registers
  its own `window.addEventListener("keydown")`. None consult
  `UIStateStore`.
- The runtime input manager (`input/index.ts`) tracks held keys
  per-frame for `w`/`a`/`s`/`d` movement — that's a continuous
  game-loop concern, separate from the discrete-shortcut
  problem this plan addresses.

So sugarmagic has the data (`isPaused` + `visibleMenuKey`) but
not the binding-layer abstraction that ties it to keyboard
actions. Plan 050 lands that layer.

### What is NOT in scope

Out of scope deliberately, to keep this epic from sprawling:

- **Plugin contribution kinds for modes / actions.** No new
  `input.mode` or `input.action` contribution shape in this
  epic. The five concrete modes (`in-game`, `paused`,
  `start-menu`, `dialogue`, `login-modal`) are runtime-core-
  defined; the six concrete actions are registered at handler
  mount-time directly. When a real plugin (SugarAgent dialogue
  mode, sugarlang prompt mode) actually needs to contribute,
  that's a small additive change — add the contribution kinds
  then, on real evidence, not now on speculation.
- **DevTools surface (active-mode badge in the Session HUD).**
  Useful but not blocking. The mode value is exposed on
  `UIStateStore` for any future debug surface to read.
- **Stack vs swap semantics.** Choosing swap (Unity's model)
  for simplicity. Opening the inventory SETS the active mode;
  closing RESTORES based on `UIStateStore` re-derivation, not
  by popping a stack. Push/pop becomes additive later if nested
  UI needs it.
- **Gamepad input.** Keyboard only for this epic.
- **Remappable bindings.** Author-defined keys are hardcoded in
  each action registration; user-facing remap UI is its own
  concern.
- **Localized binding strings.** "Press [I] to open Inventory"
  text stays static.
- **Movement input (`w`/`a`/`s`/`d`).** Continuous game-loop
  input is a separate system (`runtime-core/src/input/`); the
  mode + action registry covers discrete shortcuts only.
- **Audio unlock listener** (`targets/web/src/audio/`). Browser
  autoplay-policy workaround; not a game shortcut.

### Resolved Decisions

- **Swap, not push/pop.** One active mode at a time, re-derived
  from `UIStateStore`. Trades nested-UI expressiveness for a
  simpler state machine. Revisit only when a real nested case
  hits.
- **Mode is derived, not stored.** `resolveRuntimeMode(uiState)`
  is a pure function over the existing `UIStateStore` shape; we
  don't add a new mutable `mode` field that could drift from
  `visibleMenuKey` / `isPaused`. AGENTS.md "one source of
  truth" — UIStateStore stays authoritative.
- **Central listener belongs to runtime-core.** Same package
  that owns `UIStateStore` and `UIActionRegistry`. Plugin code
  never registers `window.addEventListener("keydown")`
  directly; they call the registry.
- **No plugin contribution kinds yet.** Existing handlers in
  runtime-core register directly. When a plugin needs to
  contribute a mode or action, we add the contribution surface
  then — incremental, evidence-driven.
- **Action declares its modes; the registry doesn't enforce
  uniqueness across modes.** Two different actions can bind
  the same key in different modes (e.g. `Esc` opens pause in
  `in-game`, closes inventory in `inventory-open`). Same key
  is fine; same `actionId` is the conflict-detection unit.

### Open Questions

- **"Modeless" debug actions.** The debug HUD's keyboard
  shortcut probably wants to fire regardless of mode. Encode
  via `modes: "*"` / `modes: null` / explicit `"any"` mode?
  Lean toward the literal sentinel `modes: "any"` so the
  resolver doesn't have to special-case nullability. Resolve
  in 50.2 when the registry shape lands.
- **Login-modal mode trigger.** SugarProfile's modal is a
  plugin-side React component, but `login-modal` mode would
  belong to runtime-core's enum. Resolution: the modal flips a
  flag on `UIStateStore` (or similar) when it opens; the
  resolver maps that flag to `login-modal`. Plugin doesn't
  need to know about modes directly.

## Deliverables

- New `packages/runtime-core/src/input-modes/` module with:
  - `RuntimeMode` union type.
  - `resolveRuntimeMode(uiState)` — pure function mapping
    `UIStateStore` shape to the active mode.
  - `RuntimeActionRegistry` — `register({actionId, modes, key,
    handler})` / `unregister(actionId)`; emits the central
    `window.addEventListener("keydown")` ONCE for the runtime
    lifetime and dispatches to matching actions.
- Migration of the six existing scattered handlers:
  - `packages/runtime-core/src/inventory/index.ts`
  - `packages/runtime-core/src/quest/QuestJournal.ts`
  - `packages/runtime-core/src/document/index.ts`
  - `packages/runtime-core/src/caster/SpellMenuUI.ts`
  - `packages/runtime-core/src/dialogue/DialoguePanel.ts`
  - `packages/runtime-core/src/debug-hud/DebugHud.ts`
  Each one's `window.addEventListener("keydown")` deletes; the
  handler function moves into a `registerRuntimeAction({...})`
  call on mount, unregisters on unmount.
- `UIStateStore` flag for login-modal state (or equivalent),
  consumed by `resolveRuntimeMode`. SugarProfile's modal flips
  it.
- Retire the Plan 047 §47.7.5 autofocus band-aid. (Or keep it
  as a UX nicety; either way it stops being load-bearing.)

## Stories

### 50.1 — `RuntimeMode` + active-mode resolver

**Files (create):**

- `packages/runtime-core/src/input-modes/runtime-mode.ts`:
  - `RuntimeMode = "in-game" | "paused" | "start-menu" |
    "dialogue" | "login-modal" | "any"`. The `"any"` sentinel
    is what modeless actions (debug HUD) register against.
  - `resolveRuntimeMode(uiState: UIState): RuntimeMode` — pure
    function; reads `visibleMenuKey`, `isPaused`,
    `loginModalOpen` (new flag) and returns the single active
    mode.

**Tests:** pure-function unit tests in
`packages/testing/`. Matrix of `UIStateStore` permutations →
expected mode.

**Exit:** module exists, `resolveRuntimeMode` covers all
known UIStateStore states, no consumers yet.

### 50.2 — `RuntimeActionRegistry` + central keyboard listener

**Files (create):**

- `packages/runtime-core/src/input-modes/registry.ts`:
  - `registerRuntimeAction({actionId, modes, key, handler})`
    returns an unregister function.
  - Lifecycle: on first registration, subscribe to
    `UIStateStore` and install ONE
    `window.addEventListener("keydown")`. On last unregister
    (or runtime teardown), remove the listener + unsubscribe.
  - Dispatch logic: on keydown, derive the current mode via
    `resolveRuntimeMode`, walk registered actions, fire each
    whose `(modes.includes(currentMode) || modes.includes("any"))`
    AND whose `key` matches the event.

**Tests:** registry unit tests — registering / unregistering;
dispatch against synthetic keydown events with a stub
`UIStateStore`; assert correct handlers fire, others don't.

**Exit:** registry usable; nothing in the runtime calls it yet.

### 50.3 — Migrate inventory + quest journal handlers

**Files (modify):**

- `packages/runtime-core/src/inventory/index.ts`
- `packages/runtime-core/src/quest/QuestJournal.ts`

Each: delete the existing `window.addEventListener("keydown")`
+ its `event.target` guard. Replace with a
`registerRuntimeAction({modes: ["in-game"], key: "i" | "j",
handler: existingFn})` call on mount; capture the unregister
fn, call on unmount.

**Tests:** assert (via the registry's test seam) that pressing
`i` in `in-game` opens the inventory; pressing `i` in
`paused` / `start-menu` / `dialogue` does nothing.

**Exit:** inventory + quest journal shortcuts route through
the central registry. Manual smoke test in Studio confirms
behavior unchanged.

### 50.4 — Migrate document panel + spell menu handlers

**Files (modify):**

- `packages/runtime-core/src/document/index.ts`
- `packages/runtime-core/src/caster/SpellMenuUI.ts`

Same pattern as 50.3.

**Exit:** four of six scattered handlers retired. Repo grep
for `addEventListener.*keydown` in runtime-core returns only
the registry's call site + the remaining two unmigrated
handlers + the non-shortcut listeners (movement input, etc.).

### 50.5 — Migrate dialogue + debug HUD handlers

**Files (modify):**

- `packages/runtime-core/src/dialogue/DialoguePanel.ts` —
  registers `modes: ["dialogue"]`. The dialogue panel sets a
  UIStateStore flag (or the active-menu mechanism already
  does) that maps to `RuntimeMode "dialogue"` via
  `resolveRuntimeMode`.
- `packages/runtime-core/src/debug-hud/DebugHud.ts` —
  registers `modes: ["any"]` since debug shortcuts are
  intentionally global.

**Exit:** all six scattered keydown listeners gone from
runtime-core's shortcut handlers. Single repo-wide
`window.addEventListener("keydown")` in `input-modes/registry.ts`
+ the orthogonal ones (movement input, audio unlock, etc.).

### 50.6 — `login-modal` mode + retire the autofocus band-aid

**Files (modify):**

- `packages/runtime-core/src/ui-context/index.ts` — add a
  `loginModalOpen: boolean` flag to `UIState` (or equivalent
  signal `resolveRuntimeMode` can read).
- `apps/studio/src/plugins/catalog/sugarprofile/...` (and the
  runtime-side login modal): flip the flag on mount, unflip
  on unmount.
- Plan 047 §47.7.5 autofocus band-aid: retire or keep as a UX
  nicety with an updated comment explaining it's no longer
  load-bearing.

**Verification:**

- Open the login modal. Press `i`. Inventory does NOT open;
  focus is on the email input.
- Open the game's start menu. Press `i`. Inventory does NOT
  open (start-menu mode disables in-game actions).
- Resume play. Press `i`. Inventory opens.
- Open a dialogue. Press `i`. Inventory does NOT open;
  dialogue advance still works.
- Debug HUD shortcuts still fire in every mode.

**Exit:** the original motivating bug (login modal + in-game
shortcut collision) and the broader bug (start-menu + in-game
shortcut collision) both demonstrably fixed without per-
handler guards.

## Builds On

- [Plan 047: SugarProfile User Management Plugin](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
  — surfaced the login-modal-vs-shortcut collision.
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md) — the
  "single enforcer" principle this plan operationalizes for
  keyboard shortcuts.
