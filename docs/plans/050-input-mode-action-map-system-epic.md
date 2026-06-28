# Plan 050: Input Mode / Action Map System

**Status:** Proposed
**Date:** 2026-06-26

> Surfaces from a Plan 047 §47.7.5 follow-up: with the LoginModal
> rendering over the runtime canvas, in-game keyboard shortcuts
> (`i` for inventory, `j` for journal, etc.) started firing while
> the user typed their email into the modal. The autofocus
> band-aid fixed that specific case, but the deeper bug is that
> runtime-core's shortcut handlers consult only
> `event.target instanceof HTMLInputElement` — they never check
> the runtime's pause / menu state. Hitting `i` during the game's
> own start menu still opens the inventory. This plan replaces
> the per-handler check pattern with a Unity/Unreal-style input
> mode + action map system.

## Epic

### Title

Input modes + action maps as a first-class runtime contract.

Sugarmagic's runtime today wires every keyboard shortcut as an
independent `window.addEventListener("keydown")` that decides for
itself when to fire. Inventory, journal, quest, document, spell
menu, dialogue, debug HUD all do it. The pause + menu state lives
in `UIStateStore` but no handler reads it. As we add more handlers
(SugarProfile login modal, SugarAgent conversation, future
sugarlang prompts), the cross-cutting "should this shortcut fire
right now?" question gets more brittle.

Unity and Unreal both settled on the same architectural answer:
**explicit input contexts that the runtime swaps based on game
state**. Unity's Input System uses Action Maps you `Enable()` /
`Disable()` in bulk; Unreal uses InputMappingContexts + InputModes
(`GameOnly`, `UIOnly`, `GameAndUI`). The principle is the same:
handlers don't ask "am I paused?" — the input system enables /
disables the right action map based on the active mode, and only
active handlers fire.

Plan 050 ports that shape to sugarmagic:

- A top-level `RuntimeMode` enum + state machine
- Per-mode action maps that declare which shortcuts are active
- A central input router that owns keyboard listeners + dispatches
  to handlers registered in the active mode's action map
- Plugin contributions for new modes (SugarProfile's "logging-in"
  mode; SugarAgent's "in-conversation" mode; sugarlang's
  "answering-question" mode in the future)

### Goal

- **Eliminate per-handler `event.target instanceof HTMLInputElement`
  checks** at the call sites. The input router owns the
  "is the user typing into an input?" question once and routes
  accordingly. Handlers register *intent* (e.g. "fire when inventory
  action triggers"), not *plumbing* (e.g. "register a window
  keydown listener").
- **The active mode gates which actions fire.** Mode `in-game`
  enables inventory / journal / pause / spells; mode `paused`
  enables only resume / quit-to-menu; mode `dialogue` enables
  advance / option-pick; mode `login-modal` enables nothing
  (typing into the input is the only behavior). Handlers don't
  consult `isPaused` directly.
- **Plugin contributions for modes.** SugarProfile contributes
  `login-modal` (entered when its modal opens, exited on close).
  SugarAgent contributes `agent-conversation`. Sugarlang
  contributes `language-prompt`. Same shape as the existing
  `runtime.banner` / `debug.hudCard` contribution kinds — modes +
  actions are first-class contributable resources.
- **Existing handlers stay structurally similar**, but their
  binding mechanism changes. Instead of
  `window.addEventListener("keydown", handleI)`, an inventory
  handler registers `{ actionId: "toggle-inventory", modes:
  ["in-game"], handler: openInventory }` with the input router.
- **DevTools-friendly.** The active mode is visible in the
  debug HUD (extends the Session card from Plan 047 §47.5.5).
  Misfiring shortcuts become trivially diagnosable: "you're in
  mode `dialogue`, only these actions are active right now."

### Context

The current state is partially layered:

- `UIStateStore` (`packages/runtime-core/src/ui-context/index.ts`)
  carries `visibleMenuKey` + `isPaused` — half the input-mode
  abstraction.
- `UIActionRegistry` (`packages/runtime-core/src/ui-actions/index.ts`)
  registers menu-driven actions (`start-new-game`, `pause-game`,
  `resume-game`). That's UI-side semantic actions, not keyboard
  bindings.
- Keyboard listeners are scattered: inventory, quest journal,
  document, dialogue, spell menu, debug HUD, runtime input
  manager — all register their own `window.addEventListener`.
- The runtime input manager (`input/index.ts`) tracks pressed
  keys for movement (`w`/`a`/`s`/`d` etc.); shortcut handlers
  are independent of it.

So sugarmagic has the data (`isPaused`) and the menu-action
abstraction (`UIActionRegistry`) but not the keyboard-binding
abstraction that would tie them together. Plan 050 lands that
binding layer.

### What is NOT in scope

- **Gamepad input.** Plan 050 covers keyboard + mouse only. The
  abstraction's mode + action shape works for gamepad too (Unity
  + Unreal share it across input devices), but landing gamepad
  expands testing surface significantly. Defer to a follow-up.
- **Remappable key bindings.** Users overriding the default
  `i = inventory` to e.g. `Tab = inventory` is a real feature
  but expands persistence + settings UI. Out of scope; the
  action map's bindings are author-defined for now.
- **Localized input strings.** "Press [I] to open Inventory"
  text appears in the existing inventory header (`packages/
  runtime-core/src/inventory/index.ts:177`). Once bindings are
  remappable, that string becomes dynamic — but localization +
  remap-aware UI is its own concern.
- **Pause-on-blur / pause-on-tab-switch.** Useful but separate
  from the mode system.

## Deliverables (rough — fill in when scoping stories)

- New `packages/runtime-core/src/input-modes/index.ts` with
  `RuntimeMode` type + `RuntimeModeRegistry` + active-mode state
  machine.
- `RuntimeActionRegistry` for keyboard-bound actions: registering
  `{ actionId, modes, key, handler }` tuples; the router consults
  the active mode + active action's binding to dispatch.
- Central keyboard listener that replaces the scattered
  `window.addEventListener` calls. Handlers stop owning
  registration; they only own the handler function.
- Plugin contribution kinds: `input.mode` (a plugin contributes a
  named mode) and `input.action` (a plugin contributes a
  keyboard-bound action that belongs to one or more modes).
- Migration of existing handlers: inventory, quest journal,
  document panel, spell menu, dialogue, debug HUD.
- Studio + published-web boot path tells the router which mode to
  start in (`loading` -> `main-menu` once boot.json hydrates ->
  `in-game` once the player dismisses the start menu).
- LoginModal (Plan 047 §47.7.5) registers `login-modal` mode +
  scopes its inputs to it; the autofocus band-aid retires.

## Resolved Decisions

- *(to be filled in as the design firms up)*

## Open Questions

- **Granularity of modes.** Coarse (`in-game` / `paused` / `menu` /
  `dialogue`) vs. fine (`in-game-walking` / `in-game-cursor-mode` /
  ...). Probably coarse to start; modes can split when behavior
  diverges.
- **Stack vs. swap semantics.** Does opening the inventory PUSH
  `inventory-open` onto a mode stack (so Esc pops back to
  `in-game`), or SWAP the active mode to `inventory-open` (so the
  next state-change instruction has to know what to restore to)?
  Unreal does push/pop with InputMappingContexts; Unity does
  swap. Push/pop is cleaner for nested UIs (dialogue inside
  inventory inside in-game), but Unity's swap is simpler for the
  flat case.
- **What about non-keyboard input?** Pointer / touch events
  currently bypass the runtime input manager too. Should the
  router also wrap pointer events, or stay keyboard-focused?
- **Plugin contribution shape.** Does a SugarAgent dialogue mode
  REPLACE the `dialogue` mode runtime-core ships, or stack on
  top of it? Probably stack; the plugin can add its own actions
  to the existing mode rather than redefining it.

## Stories

*(Empty — stories get fleshed out once the open questions are
settled. Likely shape: contract definition, registry, router,
handler migration, plugin contribution wiring, DevTools surface,
docs pass.)*

## Builds On

- [Plan 047: SugarProfile User Management Plugin](/docs/plans/047-sugarprofile-user-management-plugin-epic.md)
  — surfaced the bug that motivated this work (LoginModal +
  in-game shortcuts colliding).
- [AGENTS.md — Non-Negotiable Principles](/AGENTS.md)

## Followed By

- Gamepad input support
- Remappable keybindings + settings UI
- Localized binding strings ("Press [I] to open Inventory" with
  remap-aware display)
