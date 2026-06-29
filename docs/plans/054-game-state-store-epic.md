# Plan 054 — GameStateStore + lifecycle transitions on the runtime host

Status: proposed
Owner: nikki + claude
Date: 2026-06-29

Supersedes: the original Plan 054 (PlayerSession), which conflated user-session with game-session and built the wrong abstraction. Scrapped after research on how Unreal / Unity / Godot / React actually do this — the consensus answer is canonical game-state-as-data with named transition methods, not an aggregator class with lifecycle events.

Related: [[stale-closure-react-state-in-effects]] (memory), Plan 050 (RuntimeMode + ActionRegistry — orthogonal axis to lifecycle), Plan 051 (SerializedSaveStore + ObservableValue + host.state pattern).

## Problem

When the player clicks New Game, no central state says "the game is now in progress." Today:

- `UIStateStore` (in `packages/runtime-core/src/ui-context/`) holds `visibleMenuKey + isPaused + savePresent`. All three are game-state concerns, not UI concerns. **The name is wrong.**
- "Game is in progress" is **derived** from `visibleMenuKey === null && !isPaused`. This is the inversion the research called out: the menu drives the state instead of the state driving the menu.
- New Game / Continue / Pause / Quit transitions are scattered across `freshStart.ts`, `runtimeHost.ts` callback opts, `App.tsx` / `preview.tsx` closures, individual ui-actions handlers. No single module owns them.
- The `freshStart.ts` name is opaque; the operation is "New Game." A future Pause / Quit button has nowhere obvious to call.

The 053.7 race bug + the stale-closure trap that gated the New Game flow were both surface symptoms of the deeper problem: lifecycle transitions aren't owned by anyone.

## What the research said

Industry consensus across engines:

- **Unreal Engine** — `GameState` is the canonical model. UMG Viewmodel pattern: "Separation of Concerns means your game should only worry about gaming and your UI about looking pretty."
- **Unity** — singleton `GameManager` with explicit `GameState` enum (`Playing | Paused | MainMenu | GameOver`). UI reads it. State machines for in-game entity AI are a SEPARATE concept; the high-level lifecycle is just an enum + transitions.
- **Godot** — autoload singleton for game phase, Resource for save/load. UI reads, doesn't drive.
- **React state management literature** — domain state vs UI state explicit; UI state is "modal visibility, form input values, loading indicators... distinct from domain/application state."
- **Game Programming Patterns** — "if a gameplay state also handles UI updates or manages audio settings, it can lead to a bloated class that's difficult to maintain... The fix for managing different types of state is to have two separate state machines."

All four sources land on the same pattern: a **Model** layer holding canonical game state, a **Controller** layer with named methods that transition it, a **View** layer that reads + renders. MVVM / MVP, but with the runtime host playing the controller role since the canvas isn't part of the React tree.

## What we want

Apply the pattern to sugarmagic:

- **`GameStateStore`** (renamed from `UIStateStore`, relocated) owns the canonical game lifecycle. One field:

  ```ts
  type GameLifecycle =
    | "booting"      // page loading, providers resolving
    | "start-menu"   // on the start menu, player chooses New Game / Continue
    | "playing"      // gameplay active
    | "paused"       // pause menu visible
    // | "game-over"  // future, when wordlark has a death/end flow
  ```

  `savePresent` stays (it's domain data — "does the user have a save?"). `visibleMenuKey` and `isPaused` collapse into derived selectors over `lifecycle`.

- **`WebRuntimeHost`** exposes named transition methods:

  ```ts
  host.startNewGame(): Promise<void>
  host.continueGame(): void
  host.pauseGame(): void
  host.resumeGame(): void
  host.quitToMenu(): void
  ```

  Each one mutates `gameState.lifecycle` (+ side effects for the destructive `startNewGame`). One module owns "what does each transition do."

- **ui-actions handlers** become one-line delegates: `"start-new-game"` -> `host.startNewGame()`, `"pause-game"` -> `host.pauseGame()`, etc. The `host.start({onStartNewGame})` option goes away; the host wires its own transitions.

- **React + HUD + menus** read `lifecycle` (via `host.state.gameState` observable, same `useSyncExternalStore` pattern as `activeProviders`) and re-render. They don't keep their own "is the menu open" copy.

After this, the answer to "where is the game in progress flagged?" is one observable, one field: `host.state.gameState.getSnapshot().lifecycle === "playing"`. Adding a Pause or Quit button later is a one-line ui-action handler + one method on the host.

## Non-goals

- **GameSession (playtime span)** — the analytics-style "sessions table" concept from the scrapped Plan 055. Not in 054. Revisit when there's a concrete consumer (recent-play-history UI, telemetry dashboard, etc.).
- **Plugin lifecycle hook contribution kind** — no `gameState.onLifecycleChange` plugin contribution. Plugins that need to react subscribe to `host.state.gameState` directly via the existing ObservableValue pattern. If we see every plugin re-implementing the same subscription shape, extract a contribution kind THEN.
- **UI-only state store** — don't speculatively create a sibling `UIStateStore` for presentation-only state. Create it when a real UI-only concern shows up (hover state, modal animation flags, etc.). Today nothing in the current `UIStateStore` qualifies.
- **Replace `RuntimeMode` from Plan 050** — that's input-mode (gameplay / dialogue / inventory / login-modal), orthogonal to lifecycle. Stays.

## Stories

### 054.1 — Audit consumers of `visibleMenuKey` and `isPaused`

Before any rename: catalog every read site. Output is a checklist appended to this plan doc. Covers at minimum:
- `packages/runtime-core/src/ui-actions/index.ts` — handlers mutate these fields directly
- `runtime-core` menu rendering / runtime-mode resolver / audio system
- `targets/web/src/App.tsx` — start-menu reopen logic, `isPaused`-driven render
- `apps/studio/src/preview.tsx` — same

Each row in the checklist has: file path, line, current usage, target migration (read `lifecycle` directly OR a named derived selector). Drives the 054.4 migration.

### 054.2 — Introduce `lifecycle` field; keep legacy fields as derived

In `packages/runtime-core/src/ui-context/` (rename to `game-state/` in 054.4):

- Add `lifecycle: GameLifecycle` to the store shape.
- Implement `visibleMenuKey` and `isPaused` as derived getters computed from `lifecycle`. Mutators that previously set them ALSO update `lifecycle` so writes stay coherent during migration.
- Default state on boot: `lifecycle: "booting"`. Boot path transitions to `"start-menu"` once providers resolve and the start menu opens.

Tests verify:
- Derived `visibleMenuKey` / `isPaused` agree with `lifecycle` across all transitions.
- Legacy `setState({visibleMenuKey, isPaused})` mutations also update `lifecycle`.

### 054.3 — Add transition methods on `WebRuntimeHost`

In `targets/web/src/runtimeHost.ts`:

- `startNewGame()` — destructive flow: read `state.activeProviders.getSnapshot()`, call `saveStore.resetForNewGame(userId)`, set sessionStorage flag, `window.location.reload()`. Lifecycle transition happens implicitly via post-reload boot.
- `continueGame()` — `gameState.lifecycle = "playing"`. Boot already loaded the save; this just hides the start menu.
- `pauseGame()` — assert `lifecycle === "playing"`, then `lifecycle = "paused"`.
- `resumeGame()` — assert `lifecycle === "paused"`, then `lifecycle = "playing"`.
- `quitToMenu()` — assert `lifecycle === "playing" || "paused"`, then `lifecycle = "start-menu"`. Does NOT touch the save.

`host.start({onStartNewGame})` option retires. The host's internal `registerDefaultUIActions` call wires the new ui-action handlers (054.5) to its own methods.

Move `freshStart.ts` machinery (the sessionStorage key + `consumeFreshStartFlag()` + the reset+reload sequence) inside the host as a private helper. `freshStart.ts` is removed from the public target-web exports.

Tests: unit-test each transition method. Mock save store / sessionStorage / reload. Verify lifecycle transitions and side effects.

### 054.4 — Migrate readers to `lifecycle`

Per the 054.1 audit. Each consumer migrated file-by-file (one commit per file or small group, easier review). Replace `visibleMenuKey` reads with `lifecycle` reads (or named selectors). Replace `isPaused` reads with `lifecycle !== "playing"` or a named `isGamePaused(state)` selector.

Once all consumers migrated:
- Retire `visibleMenuKey` and `isPaused` from the store shape entirely.
- Rename `UIStateStore` -> `GameStateStore`. Relocate `runtime-core/src/ui-context/` -> `runtime-core/src/game-state/`. Update barrel re-exports.
- Rename relevant types (`UIStateStoreSnapshot` -> `GameStateStoreSnapshot`, etc.).
- Update `host.state.uiState` (if exposed) to `host.state.gameState`.

### 054.5 — ui-actions handlers delegate to host

In `packages/runtime-core/src/ui-actions/index.ts`:

- `"start-new-game"` handler: call `host.startNewGame()` (passed in via `registerDefaultUIActions` opts). Drop the inline `onStartNewGame` callback parameter.
- `"continue-game"` -> `host.continueGame()`. Drop `onContinueGame`.
- Add `"pause-game"`, `"resume-game"`, `"quit-to-menu"` handlers wired to the corresponding host methods.
- Update `DefaultUIActionOptions` shape: instead of taking callbacks, takes a `host: WebRuntimeHost` reference (or just the relevant transition methods if we want a thinner contract).

Tests: unit-test that each dispatch reaches the right host method. Existing user-management.test.ts tests for start-new-game / continue-game adapt to the new shape.

### 054.6 — Verify in prod + final cleanup

- End-to-end: New Game in prod (player at origin post-reload). Continue (player at saved position). Add a Pause button to wordlark's start menu definition; verify Pause / Resume / Quit-to-Menu flows.
- Delete `freshStart.ts` from `targets/web/src/save/` (machinery moved into host in 054.3). Confirm zero external references.
- Update memory rules if any new constraint emerges (the [[stale-closure-react-state-in-effects]] rule still applies; might be worth adding a "lifecycle reads come from gameState observable, not derived UI state" rule).
- Drop the `useUserContext` shape change attempted in the scrapped 054 — `useUserContext` reverts to its pre-054 shape (or gets retired entirely if nothing reads it; it had zero consumers as of main).

## Open questions

- **`GameStateStore` location: runtime-core or target-web?** Lean runtime-core. `lifecycle` is target-agnostic (a future Electron / native target would have the same concept). Resolve in 054.2.
- **`booting` vs `start-menu`** — do both render the start menu UI (with `booting` showing a "Loading..." overlay)? Or is `booting` strictly pre-start-menu? Probably the former; the boot overlay is its own concern and can render on top of whatever menu state is active. Resolve in 054.2.
- **Transition method return types** — sync vs async. `startNewGame()` is async (awaits the store reset before reload). The rest are sync (just mutate lifecycle). Should all be uniform? Lean: keep mixed signatures; the awaits document themselves.
- **Validation of illegal transitions** — e.g. calling `pauseGame()` while on the start menu. Throw, no-op, or warn? Lean warn + no-op for v1; transitions are dispatched by ui-actions which already gate on `visibleMenuKey`, so illegal transitions only happen on programmer error. Revisit if a real ambiguity surfaces.

## Defers

- GameSession (the playtime-span concept) — revisit if/when analytics or session-history UI is concrete.
- Plugin lifecycle hook contribution kind — extract from the existing ObservableValue subscription pattern only when multiple plugins re-implement the same shape.
- `game-over` lifecycle — add when wordlark has the UI for it.
- Separate UI-only state store — create when a real UI-only concern needs persistence.
- Validation for illegal lifecycle transitions (above).

---

## 054.1 — Audit (appended after 054.1 ran)

`visibleMenuKey` carries TWO orthogonal concerns today that the rename has to untangle:

1. **Lifecycle menus** — `"start-menu"` and `"pause-menu"`. Set when the game lifecycle transitions; the menu UI renders to match. These MIGRATE to deriving from `lifecycle`.
2. **Overlay menus** — `"dialogue"` (and future: inventory / custom plugin UIs). Set while gameplay is running, to gate input mode (Plan 050 RuntimeMode) and to render plugin-contributed UI. These STAY in a per-overlay field (probably rename `visibleMenuKey` -> `activeOverlayMenuKey` once lifecycle menus are gone).

The split is the load-bearing insight: a single string field can't be both "what phase of the game am I in" and "what plugin overlay is showing." Today the field is overloaded and that's why it feels off.

### Writers

| Site | Current | Category | Target migration |
|---|---|---|---|
| `packages/runtime-core/src/ui-actions/index.ts:89` (start-new-game handler) | `setState({visibleMenuKey: null, isPaused: false})` | lifecycle | call `host.startNewGame()` |
| `packages/runtime-core/src/ui-actions/index.ts:99` (continue-game handler) | `setState({visibleMenuKey: null, isPaused: false})` | lifecycle | call `host.continueGame()` |
| `packages/runtime-core/src/ui-actions/index.ts:104` (pause-game handler) | `setState({visibleMenuKey: pauseMenuKey, isPaused: true})` | lifecycle | call `host.pauseGame()` |
| `packages/runtime-core/src/ui-actions/index.ts:110` (resume-game handler) | `setState({visibleMenuKey: null, isPaused: false})` | lifecycle | call `host.resumeGame()` |
| `packages/runtime-core/src/ui-actions/index.ts:116, 121` (quit-to-menu) | `setState({visibleMenuKey: startMenuKey, isPaused: true})` | lifecycle | call `host.quitToMenu()` |
| `targets/web/src/runtimeHost.ts:959, 963` (keyboard Q pause toggle) | direct setState of both fields | lifecycle | call `host.pauseGame()` / `host.resumeGame()` |
| `targets/web/src/runtimeHost.ts:1473-1474` (host start initial state) | initialize `{visibleMenuKey: null, isPaused: false}` | lifecycle | initialize `{lifecycle: "booting"}`; the legacy fields are derived |
| `targets/web/src/runtimeHost.ts:1832` (`showStartMenu()`) | `setState({visibleMenuKey: "start-menu", isPaused: true})` | lifecycle | call `host.quitToMenu()` (or rename `showStartMenu` -> bootstrap transition to `"start-menu"`) |
| `packages/runtime-core/src/dialogue/DialoguePanel.ts:781` (dialogue show) | `setState({visibleMenuKey: "dialogue"})` | overlay | STAYS — writes `activeOverlayMenuKey`, NOT lifecycle |
| `packages/runtime-core/src/dialogue/DialoguePanel.ts:797` (dialogue hide) | `setState({visibleMenuKey: null})` | overlay | STAYS — clears `activeOverlayMenuKey` |
| `targets/web/src/bootPreviewSession.ts:44-45` | initial fixture for preview sessions | lifecycle | initialize via `lifecycle` (derived `visibleMenuKey` / `isPaused` follow) |
| `apps/studio/src/preview/sampleRuntimeContext.ts:24-25` | fixture | lifecycle | initialize via `lifecycle` |

### Readers

| Site | Current | Category | Target migration |
|---|---|---|---|
| `packages/runtime-core/src/input-modes/runtime-mode.ts:110` | `state.visibleMenuKey !== null` -> mode-defining-menu-keys lookup | overlay | STAYS — but the input mode mapping for `"start-menu"` / `"pause-menu"` retires (lifecycle drives those modes directly: `lifecycle === "paused"` -> `"paused"` input mode; `lifecycle === "start-menu"` -> probably new `"start-menu"` input mode or just default) |
| `packages/runtime-core/src/input-modes/runtime-mode.ts:114` | `state.isPaused` -> `"paused"` input mode | lifecycle | read `lifecycle === "paused"` |
| `packages/runtime-core/src/dialogue/DialoguePanel.ts:796` | `visibleMenuKey === "dialogue"` (don't clear if non-dialogue overlay set itself first) | overlay | STAYS — reads `activeOverlayMenuKey` |
| `targets/web/src/runtimeHost.ts:957-963` (keyboard Q decision) | reads `visibleMenuKey === null` / `"pause-menu"` to decide pause vs resume | lifecycle | read `lifecycle === "playing"` / `"paused"` |
| `targets/web/src/runtimeHost.ts:1640, 1768, 1775` (menu-sound transitions) | `visibleMenuKey` snapshots before/after for sound emission | mixed | needs both `lifecycle` (for menu opens/closes from lifecycle transitions) AND `activeOverlayMenuKey` (for dialogue open/close). Simplest: emit on EITHER field changing |
| `targets/web/src/GameUILayer.tsx:142-145` | `visibleMenuKey === null` to hide all; else look up `menuKey` in menu definitions | mixed | render decision becomes: if `lifecycle === "start-menu"` -> show start menu definition; if `lifecycle === "paused"` -> show pause menu definition; if `activeOverlayMenuKey !== null` -> show that definition. Three-branch derived. |

### Knock-on observations

- **`ui-actions` `DefaultUIActionOptions`** currently passes `stateStore: UIStateStore` + several `on...` callbacks. After 054.3+054.5 this contracts to receive a `host: WebRuntimeHost` reference (or just the transition methods). The `stateStore` parameter retires for lifecycle handlers but stays for overlay handlers (open-inventory, etc.) where direct setState is still appropriate.
- **`MODE_DEFINING_MENU_KEYS`** in `runtime-mode.ts` currently maps `"start-menu"` and `"pause-menu"` into input modes. Those two entries retire when their menus stop appearing in `visibleMenuKey`. Remaining entries (`"dialogue"`, future overlays) stay.
- **`showStartMenu()`** in `runtimeHost.ts:1832` is called from the boot path and from sign-out flows. With lifecycle in place, the boot path sets `lifecycle = "start-menu"` directly, and sign-out flows call `host.quitToMenu()`. `showStartMenu` retires as a public method (or stays as a thin alias).
- **Plan 050's RuntimeMode** stays untouched as an axis. The mapping from `(lifecycle, activeOverlayMenuKey, loginModalOpen)` -> `RuntimeMode` becomes cleaner because lifecycle is its own first-class input.
- **No external tests** in `packages/testing/` directly read `visibleMenuKey` / `isPaused` (skipped from the audit grep, but worth re-grepping in 054.4 to confirm before deleting).

### Migration order (refining 054.4)

Per the audit:

1. Migrate WRITERS first (054.3+054.5). After this, only `lifecycle` is written for lifecycle concerns; only `activeOverlayMenuKey` is written for overlays. Legacy fields are derived.
2. Migrate READERS (054.4). Each consumer switches to reading `lifecycle` directly (or named selector) or `activeOverlayMenuKey` directly. The mixed-category sites (menu-sound transitions, GameUILayer render) split their reads into the two appropriate sources.
3. Once all readers migrated, retire the `visibleMenuKey` legacy compat (it gets renamed to `activeOverlayMenuKey` and its semantic narrows) and retire `isPaused` entirely.
