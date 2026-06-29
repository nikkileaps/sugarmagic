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

Apply the pattern to sugarmagic as a **two-store decomposition**. The existing `UIStateStore` is already a mix of domain + presentation concerns (it carries `loginModalOpen` alongside `visibleMenuKey + isPaused + savePresent`). The split untangles them along the domain/presentation seam.

### Two stores, one criterion

| Store | Lives in | Holds | Owns |
|---|---|---|---|
| **`GameStateStore`** (NEW) | `packages/runtime-core/src/game-state/` | `lifecycle`, `savePresent`, future region/quest/score | the Model — what's the state of the GAME |
| **`UIStateStore`** (slimmed + renamed) | `packages/runtime-core/src/ui-state/` (rename from `ui-context/`) | `activeOverlayMenuKey` (renamed from `visibleMenuKey`, semantic narrows to non-lifecycle overlays), `loginModalOpen`, future UI-only concerns | the View — what's on screen |

Criterion: is this **state of the GAME** (lifecycle, save, world data) or **state of the UI** (panels visible, modals open, hover/animation)? The fact that the runtime-mode resolver READS both stores (to derive input mode) is normal MVVM composition, not a reason to merge them.

### GameStateStore

```ts
type GameLifecycle =
  | "booting"      // page loading, providers resolving
  | "start-menu"   // on the start menu, player chooses New Game / Continue
  | "playing"      // gameplay active
  | "paused"       // pause menu visible
  // | "game-over"  // future, when wordlark has a death/end flow

GameStateStore {
  lifecycle: GameLifecycle
  savePresent: boolean
}
```

`visibleMenuKey === "start-menu"` and `visibleMenuKey === "pause-menu"` and `isPaused` all derive from `lifecycle`. The original three fields go away (after consumers migrate).

### UIStateStore (slimmed)

```ts
UIStateStore {
  activeOverlayMenuKey: string | null   // "dialogue" / "inventory" / plugin overlays; NEVER "start-menu" / "pause-menu" (those become lifecycle)
  loginModalOpen: boolean
}
```

Overlay menus are presentation: which panel is visible while gameplay runs. Their gameplay side effects (input gating, player can't move during dialogue) are DERIVED via the runtime-mode resolver — they aren't authoritative domain state.

### WebRuntimeHost transition methods

The host exposes named methods that mutate `gameState` (+ side effects for the destructive `startNewGame`):

```ts
host.startNewGame(): Promise<void>   // destructive: save reset + sessionStorage flag + reload
host.continueGame(): void            // lifecycle = "playing"; boot already loaded save
host.pauseGame(): void               // lifecycle = "paused"
host.resumeGame(): void              // lifecycle = "playing"
host.quitToMenu(): void              // lifecycle = "start-menu"; save untouched
```

Overlay mutations (open-inventory, show-dialogue, login-modal-open) go through different paths — direct `setState` on `uiState` from the relevant subsystem (DialoguePanel, inventory action, App.tsx's modal toggle). They aren't lifecycle transitions, so no transition-method ceremony needed.

### How everything composes

- **ui-actions handlers** become one-line delegates for the lifecycle ones: `"start-new-game"` -> `host.startNewGame()`, `"pause-game"` -> `host.pauseGame()`, etc. The `host.start({onStartNewGame})` option goes away. Overlay handlers (`"open-inventory"`, etc.) stay direct.
- **Runtime-mode resolver** reads from BOTH stores (composes them into input mode). This is the normal MVVM pattern: View Model + Model compose into derived concerns.
- **React + HUD + menus** subscribe to either store via `useSyncExternalStore` against `host.state.gameState` or `host.state.uiState`. GameUILayer renders lifecycle menus from `gameState` and overlay menus from `uiState`.

After this, the answer to "where is the game in progress flagged?" is one observable, one field: `host.state.gameState.getSnapshot().lifecycle === "playing"`. The answer to "where is the dialogue overlay flagged?" is `host.state.uiState.getSnapshot().activeOverlayMenuKey === "dialogue"`. Two distinct questions, two distinct stores.

## Non-goals

- **GameSession (playtime span)** — the analytics-style "sessions table" concept from the scrapped Plan 055. Not in 054. Revisit when there's a concrete consumer (recent-play-history UI, telemetry dashboard, etc.).
- **Plugin lifecycle hook contribution kind** — no `gameState.onLifecycleChange` plugin contribution. Plugins that need to react subscribe to `host.state.gameState` directly via the existing ObservableValue pattern. If we see every plugin re-implementing the same subscription shape, extract a contribution kind THEN.
- **Replace `RuntimeMode` from Plan 050** — that's input-mode (in-game / dialogue / inventory / login-modal / paused), orthogonal to lifecycle. Stays. Its resolver gets cleaner because it reads two well-named stores instead of one overloaded one.
- **Merge GameStateStore + UIStateStore into one** — would re-conflate what we're untangling. Two stores, two concerns. The composition cost (resolvers read both) is small and explicit.

## Stories

### 054.1 — Audit consumers of `visibleMenuKey` and `isPaused` ✓ done

Catalog every read + write site, categorize as "lifecycle" (goes to `GameStateStore`) or "overlay" (stays in `UIStateStore` under new field name). See appendix at bottom of this doc.

### 054.2 — Create `GameStateStore`; keep legacy fields on `UIStateStore` as derived

In `packages/runtime-core/src/game-state/` (new directory):

- Define `GameLifecycle` type and `GameStateStore` interface.
- Implement `createGameStateStore(initial?)` — same shape as the existing `createUIStateStore` (subscribe / getState / setState).
- Initial state: `{ lifecycle: "booting", savePresent: false }`.
- Export from runtime-core barrel.

In `packages/runtime-core/src/ui-context/` (still named that until 054.4):

- DON'T remove `visibleMenuKey` or `isPaused` yet — preserve writers + readers. But:
- When `setState` writes `visibleMenuKey: "start-menu"` / `"pause-menu"` / `null` or `isPaused: true/false`, ALSO derive a lifecycle and write it into the GameStateStore via a coordinating closure (the host wires the two stores together — see 054.3).
- This is the migration scaffolding: both stores stay in sync during 054.4, then legacy fields retire.

Tests:
- `GameStateStore` round-trips: subscribe / setState / getState semantics match `UIStateStore`'s.
- Initial state defaults are correct.

### 054.3 — Host owns both stores; add transition methods

In `targets/web/src/runtimeHost.ts`:

- Construct both stores at host boot. Expose via `host.state.gameState: ObservableValue<GameStateSnapshot>` and `host.state.uiState: ObservableValue<UIStateSnapshot>`. ObservableValue-style, matching `host.state.activeProviders`.
- Add the transition methods:
  - `startNewGame()` — destructive: read `state.activeProviders.getSnapshot()`, call `saveStore.resetForNewGame(userId)`, set sessionStorage flag, `window.location.reload()`. Lifecycle transition is implicit via post-reload boot.
  - `continueGame()` — `gameState.setState({ lifecycle: "playing" })`. Save already loaded at boot.
  - `pauseGame()` — assert `lifecycle === "playing"`, then `gameState.setState({ lifecycle: "paused" })`.
  - `resumeGame()` — assert `lifecycle === "paused"`, then `gameState.setState({ lifecycle: "playing" })`.
  - `quitToMenu()` — assert `lifecycle === "playing" || "paused"`, then `gameState.setState({ lifecycle: "start-menu" })`. Does NOT touch save.
- During the migration window: wire legacy `UIStateStore.setState({visibleMenuKey, isPaused})` calls so they ALSO update `GameStateStore.lifecycle` (the host installs this coordinating subscription). Keeps both stores coherent until 054.4 migrates the writers.
- `host.start({onStartNewGame})` option retires.
- Move `freshStart.ts` machinery (sessionStorage key + `consumeFreshStartFlag()` + reset+reload sequence) inside the host as a private helper. `freshStart.ts` removed from public target-web exports.

Tests: unit-test each transition method against the resulting `gameState` snapshot + side effects (mock saveStore + sessionStorage + reload).

### 054.4 — Migrate writers + readers per audit

Per the 054.1 audit table. Two passes:

**Pass A — writers (lifecycle category)**:
- `ui-actions/index.ts` handlers: replace direct `stateStore.setState({visibleMenuKey, isPaused})` with calls to `host.startNewGame()` / `continueGame()` / etc. Drop the `onStartNewGame` / `onContinueGame` callback params from `DefaultUIActionOptions` (the host owns the wiring).
- `runtimeHost.ts:957-963` (Q key pause toggle): replace direct setState with `host.pauseGame()` / `host.resumeGame()`.
- `runtimeHost.ts:1832` (`showStartMenu()`): retire or rewrite to call `host.quitToMenu()` (depending on caller context).
- `runtimeHost.ts:1473-1474` (boot initial state): initialize via `lifecycle: "booting"`.
- Fixtures (`bootPreviewSession.ts`, `apps/studio/src/preview/sampleRuntimeContext.ts`): initialize via `lifecycle`, drop the legacy field writes.

**Pass B — overlay writers + readers**:
- `DialoguePanel.ts:781, 797`: writes `visibleMenuKey: "dialogue"` / clearing. Migrate to write `uiState.setState({ activeOverlayMenuKey: "dialogue" })`. The `visibleMenuKey === "dialogue"` read at line 796 becomes a read against `activeOverlayMenuKey`.
- Rename the field everywhere from `visibleMenuKey` to `activeOverlayMenuKey` in `UIStateStore`. The narrowed semantic: only overlay keys (`"dialogue"`, future inventory / plugin overlays). Never carries `"start-menu"` or `"pause-menu"` after this.

**Pass C — readers**:
- `input-modes/runtime-mode.ts`: split the resolver to read both stores. `lifecycle === "paused"` -> `"paused"` mode. `activeOverlayMenuKey` lookup -> overlay-driven modes. `loginModalOpen` stays in `uiState`.
- `GameUILayer.tsx`: derive menu definition lookup from `(lifecycle, activeOverlayMenuKey)` — lifecycle menus first (`lifecycle === "start-menu"` -> start menu def; `lifecycle === "paused"` -> pause menu def), then overlay menus.
- `runtimeHost.ts:1640, 1768, 1775` (menu-sound transitions): emit on EITHER store changing; subscribe to both.

After all three passes:
- Retire `visibleMenuKey` / `isPaused` legacy fields entirely from `UIStateStore`.
- Rename `UIStateStore` location to `runtime-core/src/ui-state/` (from `ui-context/`).
- Retire the host's coordinating subscription from 054.3 (it was only for the migration window).

### 054.5 — Verify in prod + final cleanup

- End-to-end: New Game in prod (player at origin post-reload). Continue (player at saved position).
- Add a Pause button to wordlark's start menu definition; verify Pause / Resume / Quit-to-Menu flows.
- Delete `freshStart.ts` from `targets/web/src/save/`. Confirm zero external references.
- `useUserContext` reverts to pre-054 shape (or retires entirely if it has zero consumers — verify with grep).
- Memory rule update if a new constraint emerges (likely: "lifecycle reads come from `gameState`, overlay reads come from `uiState`; do not conflate them").

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

1. **Lifecycle menus** — `"start-menu"` and `"pause-menu"`. Set when the game lifecycle transitions. These MIGRATE to `GameStateStore.lifecycle`.
2. **Overlay menus** — `"dialogue"` (and future: inventory / custom plugin UIs). Set while gameplay is running, gates input mode (Plan 050 RuntimeMode), renders plugin-contributed UI. These STAY in `UIStateStore`, in a field renamed from `visibleMenuKey` -> `activeOverlayMenuKey` (semantic narrows to non-lifecycle overlays only).

`loginModalOpen` is already a separate field on `UIStateStore` and stays there — it's pure UI presentation.

`isPaused` is the legacy "is gameplay frozen" flag. After the migration it's purely derived from `gameState.lifecycle !== "playing"`. Retires from the store shape.

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
