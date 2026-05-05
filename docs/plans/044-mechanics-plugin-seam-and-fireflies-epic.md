# Plan 044: Mechanics Plugin Seam + Fireflies Mini-Game Epic

**Status:** Implemented
**Date:** 2026-05-04

## Epic

### Title

Generic plugin seams for hooking arbitrary UI / gameplay code
into the mechanics system, plus a first reusable mini-game
plugin (Fireflies) that demonstrates the pattern. The Sugarmagic
engine adds two world-agnostic affordances: a
`mechanics.emitHandler` plugin contribution kind so plugins can
subscribe to any mechanics `emit` event, and a `trigger-castable`
item interaction kind so any item placed in the world can fire a
castable when interacted with. The Fireflies plugin lives
outside the engine in `packages/plugins/src/catalog/fireflies/` and
provides a generic firefly-pattern puzzle that ANY game can wire
to whatever stat / event makes sense for it. No game-specific
("Rackwick", "wordlarky", "resonance") code enters the engine
or the plugin itself — that wiring lives in each game's project.

### Goal

- **One new plugin contribution kind** —
  `"mechanics.emitHandler"` joins the existing 9 kinds in
  `packages/runtime-core/src/plugins/index.ts`. Plugins
  declare which emit kinds they care about and provide a
  handler. The gameplay session dispatches every executor
  `emit` through registered handlers in addition to the
  existing in-engine subscribers (e.g. the spell-effect
  dispatcher).
- **The plugin handler context exposes a `dispatchCastable`
  API** — `MechanicsEmitHandlerContext.dispatchCastable(invocation:
  CastableInvocation): CastableExecutionResult`. This is
  what closes the loop: a plugin's mini-game completion
  fires a configured castable BACK INTO the engine, where
  the executor mutates stats / fires further events per
  authored data. No JS callback in the plugin's host-game
  setup; the result of the mini-game is wired through the
  same DSL the rest of mechanics uses.
- **One new item interaction kind** — `"trigger-castable"`
  joins `none | readable | examine | consumable` in the
  `ItemViewKind` union. Items configured this way fire a
  named castable on interact, building the cast scope from
  the player's StatCarrier and the item's authored args.
  Generally useful — not resonance-specific.
- **A new generic plugin: Fireflies** at
  `packages/plugins/src/catalog/fireflies/`. Provides the
  firefly-pattern puzzle UI as a reusable mini-game.
  Reads its configuration from the project's existing
  `pluginConfigurations` field on `GameProject` — NOT via
  a JS `register()` call. The plugin's `config` declares
  which emit kind the plugin subscribes to AND which
  castable to dispatch on success / fail. Zero knowledge of
  "resonance," "battery," "Rackwick," or any specific
  game's stats.
- **A worked example of integration in the wordlarky
  project — pure data, zero glue code.** The wordlarky
  game's project file authors:
  - An `attune-to-resonance-point` castable in its
    mechanics block that emits `open-fireflies`
  - A `gain-resonance` castable in its mechanics block
    whose `onCast` is `[{ op: "set", target:
    "caster.resonance", value: "min(caster.resonance +
    self.amount, 100)" }]`
  - A Resonance Point item placed in a region with
    `interactionView.kind === "trigger-castable"`
  - Plugin configuration enabling Fireflies with
    `emitKind: "open-fireflies"` and `onSuccess:
    { id: "gain-resonance", args: { amount: 25 } }`

  All wordlarky-specific logic lives in wordlarky's
  project data. The engine never sees wordlarky strings;
  the plugin never sees wordlarky strings; nothing
  bootstraps wordlarky in JS code.

### Why this epic exists

Plan 043 generalized stats and castables as data-driven
mechanics, but mini-games (UI, real-time puzzles, animations)
are not data — they are gameplay code, and Unity / Unreal both
treat them as such. Sugarmagic needs an integration seam so
games can attach gameplay code to authored mechanics events
without that code living in the engine.

The Fireflies puzzle from sugarengine is the first port. It is
NOT specific to Rackwick / wordlarky — it is a UI pattern
(player traces a sequence of glowing motes) that any game
might want. Implementing it as a generic plugin behind a
generic engine seam means:
- Wordlarky's port works
- A future game with totally different stats can reuse the
  same plugin by wiring it differently
- Adding a SECOND mini-game (e.g., a memory puzzle, a timing
  test) is a sibling plugin that uses the same seam — no
  engine changes
- The engine never sees a single line of mini-game code

This epic deliberately does NOT introduce per-project plugin
discovery (loading plugins from project-relative paths
instead of the engine repo). That's a real future change
worth its own epic — for now, the Fireflies plugin lives in
`packages/plugins/src/catalog/` next to sugarlang, and projects
opt in via the existing plugin enablement mechanism.

### Goal-line test

After this epic lands:

- The wordlarky game enables the Fireflies plugin in its
  project configuration.
- Its mechanics block contains an `attune-to-resonance-point`
  castable whose `onCast` is `[{ op: "emit", kind:
  "open-fireflies" }]`.
- Its content includes a Resonance Point item with
  `interactionView.kind === "trigger-castable"` and the
  castable id pointing at `attune-to-resonance-point`.
- A region has the resonance-point item placed.
- In-game: player walks up to the resonance point → presses
  interact → Fireflies puzzle opens → player solves it →
  on success, wordlarky's authored castable mutates the resonance
  stat → next spell cast benefits from the chaos dampening
  formula already in the mechanics block from Plan 043.
- A second project (none exists yet, but as a thought
  experiment) could enable the same Fireflies plugin with
  different glue: on success, mutate a `moonlight` stat,
  trigger a `evidence-gathered` quest event, anything. Same
  plugin, different game.
- The engine has zero references to "fireflies", "resonance
  point", or "Rackwick" anywhere outside test fixtures and
  the wordlarky project file.

## Scope

### In scope

**Engine generic seams** (engine code, no game knowledge):

- New `RuntimePluginContributionKind` value
  `"mechanics.emitHandler"` in
  `packages/runtime-core/src/plugins/index.ts`. Payload
  shape:
  ```ts
  {
    emitKinds: string[];          // which kinds this handler responds to
    setup: (context: MechanicsEmitHandlerContext) => {
      handle: (input: {
        emitKind: string;
        payload: Record<string, unknown> | undefined;
        caster: StatCarrier;
        target: StatCarrier | null;
      }) => void;
      dispose?: () => void;
    };
  }
  ```
  `MechanicsEmitHandlerContext` provides what plugins need
  at startup — at minimum a DOM mount root for UI plugins.
- Gameplay session (`gameplay-session.ts`) collects all
  `mechanics.emitHandler` contributions, calls each
  plugin's `setup(context)` once at boot, retains the
  returned `handle` functions keyed by the `emitKinds` they
  declared, and dispatches every executor `emit` event
  through matching handlers in addition to the existing
  in-engine subscribers (e.g. the spell-effect dispatcher
  in `CasterManager`).
- New `ItemViewKind` value `"trigger-castable"` in
  `packages/domain/src/item-definition/index.ts`. Item's
  `interactionView` for this kind carries
  `castableInvocation: CastableInvocation` (the same
  `{ id, args }` shape spells use).
- Runtime dispatch for `trigger-castable` items: when the
  player interacts with such an item, the existing item
  interaction system builds the cast scope (player's
  StatCarrier as `caster`, no `target`) and dispatches
  through `CastableExecutor`. Mirrors how `readable` items
  open the document reader — same plumbing site, new
  branch.
- Studio Item inspector adds the `Trigger Castable` view
  type option, with a Select for picking which castable to
  fire and a small JSON5 editor for the args (or a
  generated form from the castable's `inputs[]` schema —
  decide during the story; form is friendlier).

**Fireflies plugin** (lives outside the engine, in
`packages/plugins/src/catalog/fireflies/`):

- Plugin manifest registering one
  `mechanics.emitHandler` contribution.
- **Configuration is data, not code.** The plugin reads its
  config from the project's existing
  `pluginConfigurations` field on `GameProject` — the same
  mechanism every other plugin uses. No JS `register()`
  API. Project file shape (matching the existing
  `PluginConfigurationRecord`: `{ identity, pluginId,
  enabled, config }`):
  ```ts
  {
    pluginId: "fireflies",
    enabled: true,
    config: {
      triggers: [
        {
          emitKind: string;        // which emit opens this puzzle
          difficulty?: "easy" | "medium" | "hard";
          onSuccess?: CastableInvocation;   // dispatched on solve
          onFail?: CastableInvocation;      // dispatched on fail
        }
      ]
    }
  }
  ```
  Multiple triggers per game are supported (e.g. an
  `open-fireflies` and an `open-fireflies-hard` with
  different difficulty / payouts). Each trigger maps to a
  CastableInvocation the plugin will dispatch on
  completion.
- The plugin's setup function reads its config from the
  project's `pluginConfigurations`, registers handlers for
  each declared `emitKind`, and stores the corresponding
  `onSuccess` / `onFail` invocations.
- On player completion of a puzzle, the plugin calls
  `context.dispatchCastable(invocation)` (the new engine
  API) with the appropriate invocation. The engine's
  executor runs that castable's `onCast`, which mutates
  whatever stats the project authored. Plugin remains
  ignorant of what those stats are.
- The puzzle UI itself: a fullscreen DOM overlay (480px
  centered panel, 400×300 canvas, dark-space gradient).
  **Pattern-emergence puzzle** — the player observes
  fireflies twinkling in waves along hidden trajectories
  and must identify which of four trajectory previews
  matches the main pattern revealed by the coherence wave.
  Concrete spec including timing constants, difficulty
  parameters, render order, color palette, and key
  bindings is in Story 44.3.
- Pure gameplay code with a config-driven public surface.
  Zero JS code in any consumer game.

**Wordlarky integration — pure data, zero glue code:**

- Wordlarky's project file (`project.sgrmagic`):
  - Mechanics block gains an `attune-to-resonance-point`
    castable: `onCast: [{ op: "emit", kind: "open-fireflies" }]`.
  - Mechanics block gains a `gain-resonance` castable:
    ```json5
    {
      id: "gain-resonance",
      inputs: [{ id: "amount", type: "number", required: true, default: 25 }],
      cost: null,
      acceptsTarget: false,
      onCast: [
        { op: "set", target: "caster.resonance",
          value: "min(caster.resonance + self.amount, 100)" }
      ]
    }
    ```
  - Item definition: a Resonance Point item with
    `interactionView.kind === "trigger-castable"` and
    `castableInvocation: { id: "attune-to-resonance-point", args: {} }`.
  - `pluginConfigurations` adds:
    ```json5
    {
      pluginId: "fireflies",
      enabled: true,
      config: {
        triggers: [{
          emitKind: "open-fireflies",
          difficulty: "medium",
          onSuccess: { id: "gain-resonance", args: { amount: 25 } }
        }]
      }
    }
    ```
  - One placed resonance-point in an existing region.
- **No bootstrap JS code anywhere.** No glue file in the
  wordlarky project. No callback registration in
  apps/studio. The wordlarky game ships only data and
  asset files; engine + plugin handle everything via the
  configured castable dispatch.

**Tests:**
- Domain test for the new `trigger-castable` ItemViewKind
  and round-trip serialization.
- Runtime test that a `trigger-castable` item interaction
  dispatches the correct castable and produces the correct
  emit.
- Plugin contribution test: registering a
  `mechanics.emitHandler` plugin and verifying the
  gameplay session dispatches matching emits to it.
- Fireflies plugin test: simulate the trigger emit, assert
  `onComplete` fires with expected result shape.
- End-to-end test: wordlarky-shaped fixture (mechanics
  block + item + plugin enabled) → simulated interact →
  emit dispatched → fireflies plugin's setup runs (mock
  the UI; just assert the handler chain) → callback fires.

### Out of scope

- **Per-project plugin discovery** — loading plugins from
  the project's own directory instead of the engine repo.
  Real architectural change. Worth a follow-up epic. For
  now Fireflies sits in `packages/plugins/src/catalog/`
  alongside sugarlang.
- **Other mini-games** — memory puzzles, timing puzzles,
  pattern-matching variants. Each is its own plugin
  following the same seam. Defer to actual demand.
- **Generalizing item interactions further** — only
  `trigger-castable` is added in this epic. Other kinds
  (`trigger-emit`, `trigger-quest-event`) are obvious
  follow-ups but not needed for the goal-line test.
- **Plugin sandbox / safety boundaries** — the Fireflies
  plugin runs in the same JS context as the engine.
  Untrusted plugin execution (user-installed third-party
  plugins) needs a separate security story; not part of
  this epic.
- **Non-DOM rendering surfaces** — the
  `MechanicsEmitHandlerContext` ships a DOM mount root.
  Future targets (terminal, native) will need a different
  context shape. Defer until a non-web target exists.
- **Complex multi-stage emit choreography** (e.g. plugin A
  fires another castable that plugin B subscribes to). The
  v1 emit handler is one-direction: executor fires →
  plugin handles. Plugins CAN trigger another castable by
  calling the engine's caster API directly, but the
  emit-chain pattern isn't formalized.
- **Animations / particle effects beyond the plugin's
  own DOM overlay.** The Fireflies plugin renders its own
  visuals. Hooking into the broader render pipeline (e.g.
  spawning Three.js particles in the world during the
  puzzle) is plugin-internal and out of this epic's scope
  — but a plugin CAN do it via direct engine API calls
  if it imports them.

## Shape sketch

### Engine seam: emit handler contribution

```ts
// packages/runtime-core/src/plugins/index.ts (added to existing union)

export type RuntimePluginContributionKind =
  | "conversation.provider"
  | "conversation.middleware"
  | "dialogue.entryDecorator"
  | "debug.hudCard"
  | "debug.entityBillboard"
  | "runtime.banner"
  | "design.workspace"
  | "design.section"
  | "project.settings"
  | "mechanics.emitHandler";   // NEW

export interface MechanicsEmitHandlerContext {
  mountRoot: HTMLElement;
  // The single most important affordance: plugins fire castables
  // back into the engine to mutate stats / fire further events
  // per AUTHORED data, not via JS callbacks in host games.
  dispatchCastable: (
    invocation: CastableInvocation
  ) => CastableExecutionResult;
  // Project-scoped configuration authored under `pluginConfigurations`
  // for this plugin id (the `config` field on the existing
  // PluginConfigurationRecord). Domain treats this as OPAQUE —
  // domain cannot import plugin schemas without breaking one-way
  // dependencies. The plugin is responsible for validating this
  // against its own schema inside its setup() and throwing on
  // failure (gameplay-session boot will surface the throw). Same
  // field name as the persisted record — no aliasing on the boundary.
  config: Record<string, unknown>;
  // Modal-UI input claim, mirrors the existing
  // inputManager.addMovementLock / removeMovementLock pattern
  // used by inventory, dialogue, document-reader, spell-menu.
  // Plugins call claimInput when opening a modal overlay and
  // releaseInput on dismissal. lockId should be plugin-stable
  // (e.g. "fireflies-puzzle").
  claimInput: (lockId: string) => void;
  releaseInput: (lockId: string) => void;
  // Future: audio controller? render engine? Add only when a real
  // plugin needs it. YAGNI.
}

export interface MechanicsEmitDispatch {
  emitKind: string;
  payload: Record<string, unknown> | undefined;
  caster: StatCarrier;
  target: StatCarrier | null;
}

export type MechanicsEmitHandlerContribution =
  RuntimePluginContributionBase<
    "mechanics.emitHandler",
    {
      emitKinds: string[];
      setup: (context: MechanicsEmitHandlerContext) => {
        handle: (dispatch: MechanicsEmitDispatch) => void;
        dispose?: () => void;
      };
    }
  >;
```

### Engine seam: trigger-castable item interaction

```ts
// packages/domain/src/item-definition/index.ts

export type ItemViewKind =
  | "none"
  | "readable"
  | "examine"
  | "consumable"
  | "trigger-castable";   // NEW

// ItemInteractionView gains a discriminated branch for "trigger-castable":
{
  kind: "trigger-castable";
  castableInvocation: CastableInvocation;   // { id, args }
}
```

### Wordlarky's mechanics block (additive to existing)

```json5
{
  // ...existing stats: battery, resonance...
  castables: [
    // ...existing spell castable from default mechanics...
    {
      id: "attune-to-resonance-point",
      displayName: "Attune to Resonance Point",
      inputs: [],
      cost: null,
      acceptsTarget: false,
      onCast: [
        { op: "emit", kind: "open-fireflies" }
      ]
    }
  ]
}
```

### Wordlarky's resonance-point item

```json5
{
  definitionId: "<uuid>",
  displayName: "Resonance Point",
  // ...presentation, model binding...
  interactionView: {
    kind: "trigger-castable",
    castableInvocation: {
      id: "attune-to-resonance-point",
      args: {}
    }
  }
}
```

### Wordlarky's gain-resonance castable (mechanics block)

```json5
{
  id: "gain-resonance",
  inputs: [
    { id: "amount", type: "number", required: true, default: 25 }
  ],
  cost: null,
  acceptsTarget: false,
  onCast: [
    {
      op: "set",
      target: "caster.resonance",
      value: "min(caster.resonance + self.amount, 100)"
    }
  ]
}
```

### Wordlarky's plugin configuration (project file `pluginConfigurations`)

```json5
{
  pluginId: "fireflies",
  enabled: true,
  config: {
    triggers: [
      {
        emitKind: "open-fireflies",
        difficulty: "medium",
        onSuccess: { id: "gain-resonance", args: { amount: 25 } }
        // onFail omitted — failed puzzles do nothing in wordlarky
      }
    ]
  }
}
```

That is the **entire** wordlarky-specific picture. Four
authored data blocks (the two castables, the item, the plugin
config) and one placed item. Zero JS code in the wordlarky
project. Zero engine references to wordlarky. Zero plugin
references to resonance. Pure data integration end-to-end.

## Stories

### 44.1 — Mechanics emit handler plugin contribution

- Add `"mechanics.emitHandler"` to the
  `RuntimePluginContributionKind` union.
- Define `MechanicsEmitHandlerContext`,
  `MechanicsEmitDispatch`, and the contribution payload
  shape per the Shape Sketch.
- Update gameplay session boot: collect all
  `mechanics.emitHandler` contributions, call
  `setup(context)` once, retain the returned `handle` keyed
  by emit kinds, and dispatch every executor `emit` event
  through matching handlers in addition to the existing
  in-engine subscribers.
- Existing in-engine subscribers (Caster's spell-effect
  dispatcher) keep working unchanged — they're not plugins;
  they remain wired directly via the executor's `emit`
  callback. Plugin handlers are an ADDITIONAL fan-out, not
  a replacement.
- Test: register a fake plugin contribution that subscribes
  to a custom emit kind, fire that emit through the
  executor, assert the handler was called with correct
  dispatch.

**Files touched:**
- `packages/runtime-core/src/plugins/index.ts` (union + type)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (collect + dispatch)
- `packages/testing/src/mechanics-emit-handler-plugin.test.ts` (new)

### 44.2 — Trigger-castable item interaction kind

- Add `"trigger-castable"` to `ItemViewKind` union in domain.
- Extend `ItemInteractionView` (or whatever the
  discriminated union is named) with the new branch
  carrying `castableInvocation: CastableInvocation`.
- Normalizer: legacy items with no `kind` default to
  `"none"` (existing behavior); new field is opt-in.
- Runtime dispatch: when the existing item-interaction
  system fires for an item with this kind, build the cast
  scope (player StatCarrier as caster, no target) and
  dispatch through `CastableExecutor`. Mirrors the
  readable-item → document-reader path.
- Studio Item inspector: add `Trigger Castable` to the
  view-type Select; when selected, surface a Select for
  the castable id (populated from
  `gameProject.mechanics.castables`) plus an args editor.
  v1: JSON5 textarea for args, validated against the
  selected castable's `inputs[]` schema. Story can upgrade
  to a generated form if cheap; form-from-schema is a real
  ergonomic win.
- Tests: domain round-trip; runtime dispatch fires the
  correct castable; semantic validation catches a
  trigger-castable item pointing at a nonexistent castable
  id.

**Files touched:**
- `packages/domain/src/item-definition/index.ts` (kind +
  field + normalizer)
- `packages/runtime-core/src/item/...` and / or interaction
  dispatch site (whichever owns "open the readable" today
  gets the parallel branch)
- `packages/runtime-core/src/coordination/gameplay-session.ts`
  (wiring if needed)
- `packages/workspaces/src/design/ItemWorkspaceView.tsx`
  (Studio inspector)
- `packages/runtime-core/src/mechanics/validation/semantic.ts`
  (extend consumer validation to cover items, not just
  spells)
- `packages/testing/src/item-trigger-castable.test.ts` (new)

### 44.3 — Fireflies plugin

- New package directory:
  `packages/plugins/src/catalog/fireflies/`. Add to workspace
  if needed.
- Plugin manifest registering one
  `mechanics.emitHandler` contribution. **No public JS
  `register()` API.** Configuration is data only, read
  from the project's existing `pluginConfigurations` field
  through the plugin context's `config` field (matching the
  field name on the persisted `PluginConfigurationRecord`).
- Plugin's config JSON Schema (declared by the plugin,
  validated **inside the plugin's own `setup(context)`** at
  gameplay-session boot — NOT in domain normalization).
  Domain treats `PluginConfigurationRecord.config` as
  opaque `Record<string, unknown>` and cannot import
  plugin schemas without breaking one-way deps. The plugin
  owns its schema definition, ships it as part of its
  package, and runs Ajv (or equivalent) against
  `context.config` on setup. Same pattern sugarlang already
  uses internally.
  ```ts
  {
    triggers: Array<{
      emitKind: string;
      difficulty?: "easy" | "medium" | "hard";
      onSuccess?: CastableInvocation;
      onFail?: CastableInvocation;
    }>;
  }
  ```
- **Fail loud on invalid config:** if `context.config`
  doesn't pass the plugin's schema, the plugin's `setup`
  throws with a specific error (path + reason). The
  gameplay-session boot catches and surfaces it the same
  way it surfaces invalid mechanics: refuse to start the
  session, log the error, expect the author to fix the
  project file. No silent disable, no fallback.
- Internal: when the contribution's `setup(context)` runs,
  the plugin first validates `context.config` (above),
  then reads it, parses the `triggers[]`, declares the
  union of their `emitKind`s as the contribution's
  subscribed kinds, and stores a map
  from `emitKind` → `{ difficulty, onSuccess, onFail }`.
- The returned `handle` opens the puzzle overlay on
  matching emit, runs the puzzle to completion, then calls
  `context.dispatchCastable(onSuccess)` or
  `context.dispatchCastable(onFail)` (whichever fires per
  outcome; absent invocations are no-ops). Plugin tears
  down the overlay either way.
- Self-contained DOM + Canvas-2D; no Three.js required (overlay
  puzzles don't need the 3D pipeline).

**Puzzle specification — pattern-emergence, NOT trace-the-mote.**
Port these exact behaviors from sugarengine's
`ResonanceGameUI.ts` / `FireflyResonance.ts`:

- **Visual layout:** 400×300 canvas inside a ~480px panel,
  dark-space radial-gradient background (rgb 30,25,50 →
  20,18,35), violet borders (#7b68ee), golden fireflies
  (#ffeb3b / #ffee88 / #ffffcc), success green (#4caf50),
  failure pink (#e91e63). Title at top — **rename from
  "Resonance Attunement" to a generic string** (e.g.
  "Attunement") since the plugin must not name a specific
  game's vocabulary; consider exposing it via plugin config.
  Below the canvas: four 90×90 mini-canvases (A/B/C/D
  options) showing static trajectory previews. Below options:
  3-dot attempts indicator, feedback message line, footer
  hint "1-4 or click to select | Esc to abandon."
- **Player loop:** plugin renders fireflies twinkling along
  several hidden trajectories AND scattered noise fireflies.
  Every 18 seconds (`COHERENCE_PERIOD`), a 3.5-second
  (`SWEEP_DURATION`) coherence wave propagates along the
  ONE main trajectory, briefly brightening fireflies along
  its path so the trajectory becomes visible. Player must
  identify which of the four option-canvas previews matches
  that main trajectory by clicking the option or pressing
  1/2/3/4.
- **Win / fail / abandon:**
  - Win: correct selection within attempts. Green glow on
    chosen option, "Attunement successful!" message, 1.5s
    delay, then `dispatchCastable(onSuccess)` and tear down.
  - Fail: 3 wrong selections (`MAX_ATTEMPTS = 3`). Red glow,
    "Attunement failed..." message, 1.5s delay, then
    `dispatchCastable(onFail)` (if configured) and tear down.
  - Abandon: Escape key — same path as fail.
  - Per-incorrect-attempt: red glow on chosen option, message
    "Incorrect. N attempts remaining," 500ms reset, stay
    open.
- **Difficulty parameters** (per `easy | medium | hard`):

  | Parameter | Easy | Medium | Hard |
  |---|---|---|---|
  | Animation duration | 4.0s | 3.5s | 3.0s |
  | Animation speed multiplier | 0.8× | 1.0× | 1.3× |
  | Path complexity | 1 (line/curve) | 2 (curve/loop/zigzag) | 3 (loop/figure8/spiral/zigzag) |
  | Distraction patterns | 1 | 2 | 3 |

  Mote count is constant across difficulties (24 fireflies
  per main trajectory; 24 per distraction pattern; 35 noise).
  Difficulty scales path complexity and decoy count, NOT
  mote density.
- **Path types to implement:** `line`, `curve` (arc), `loop`
  (circle), `figure8` (lemniscate), `spiral` (expanding),
  `zigzag` (sawtooth). Six total. Eased with the cubic
  curves used in sugarengine.
- **Animation timing constants:**
  - `COHERENCE_PERIOD = 18s` — one full reveal cycle
  - `SWEEP_DURATION = 3.5s` — coherence wave propagation
  - `AFTERGLOW_DURATION = 2.0s` — soft persisting bloom decay
  - `FIREFLIES_PER_PATH = 24`, `DISTRACTION_FIREFLIES = 35`,
    `MAX_ATTEMPTS = 3`
  - Firefly lifecycle inside the bright window: fade-in
    3.0–5.0s (`progress * progress` ease), bright 2.0–3.5s,
    fade-out 2.5–4.5s (`(1-progress)²` ease).
- **Position randomization:** every `COHERENCE_PERIOD` cycle,
  the four trajectories relocate to shuffled quadrants
  (±0.22 offset, ±0.01 jitter) so the player can't memorize
  spatial positions across rounds.
- **Render-stack order** (bottom to top): afterglow buffer →
  noise fireflies → distraction-pattern fireflies → main
  trajectory fireflies. Distraction fireflies use 4-state
  organic timing (dark 3–8s → fade-in 3–5.5s → bright
  1.5–3.5s → fade-out 2.5–5s); bright-state fireflies
  modulate with `0.85 + sin(time*3 + x*10) * 0.15` for
  organic twinkle.
- **Animation engine:** `requestAnimationFrame` driven by
  `performance.now()`. No game-loop hook needed; the puzzle
  drives itself.
- **Input:** call `context.claimInput("fireflies-puzzle")`
  on open, `context.releaseInput("fireflies-puzzle")` on
  dismiss. Key bindings: `1`/`2`/`3`/`4` for options,
  `Escape` to abandon, mouse click on option mini-canvas as
  alternative to keys.
- **Audio:** none in v1 (sugarengine had none either; v1.1
  will add `emitSoundEvent` to the context if/when a real
  need for puzzle SFX surfaces).
- **Config allows tuning** — at minimum the difficulty
  bucket per trigger. Optionally, the title string and any
  `MAX_ATTEMPTS` override could live in config — defer
  unless trivial.
- README in `packages/plugins/src/catalog/fireflies/` explaining
  what it is, the config shape (with a worked example),
  and the integration story. Critically: the README must
  NOT name "Rackwick" / "wordlarky" / "resonance" — it is
  a generic mini-game plugin and the example uses generic
  stat names like `mana` or `focus`.
- Tests: simulated trigger emit invokes the plugin handler;
  on success the configured `onSuccess` castable is
  dispatched; on fail the `onFail` castable is dispatched
  (or no-op if absent); dispose tears down overlay
  cleanly.

**Files touched:**
- `packages/plugins/src/catalog/fireflies/` (new directory):
  - `package.json`
  - `src/index.ts` (plugin manifest + public API)
  - `src/puzzle/` (puzzle implementation files)
  - `src/styles.css` (or inlined)
  - `README.md`
- `pnpm-workspace.yaml` if needed (for new package
  registration; verify how catalog packages are currently
  discovered)
- `packages/testing/src/fireflies-plugin.test.ts` (new)

### 44.4 — Wordlarky integration + end-to-end demo (data only)

- Wordlarky's project file (`project.sgrmagic`) gains, in
  authored data only:
  - `attune-to-resonance-point` castable in the mechanics
    block (emits `open-fireflies`)
  - `gain-resonance` castable in the mechanics block
    (mutates resonance per its `amount` arg)
  - a UUID-backed Resonance Point item definition with
    `interactionView.kind === "trigger-castable"` pointing
    at `attune-to-resonance-point`
  - Plugin configuration in `pluginConfigurations` enabling
    the Fireflies plugin with `triggers: [{ emitKind:
    "open-fireflies", difficulty: "medium", onSuccess: { id:
    "gain-resonance", args: { amount: 25 } } }]`
  - One placed resonance-point in an existing region
- **No JS bootstrap code is written for this story.** The
  data-driven plugin contract from 44.1 + 44.3 means
  wordlarky ships only data. If during implementation it
  turns out a tiny piece of plugin enablement code IS
  needed somewhere (e.g. registering the Fireflies plugin
  package with the project's plugin loader), that lives in
  the plugin loader / discovery layer, not as wordlarky-
  specific glue.
- End-to-end manual test: run the game, walk to the
  resonance point, interact, solve fireflies, cast a spell
  with measurably-lower chaos chance vs. the pre-puzzle
  baseline (because resonance is now > 0).
- Automated end-to-end test: a fixture project mirroring
  the wordlarky setup; simulate interact event; assert the
  full chain: item-interact → emit `open-fireflies` →
  fireflies plugin handler called → simulate puzzle
  success → `gain-resonance` castable dispatched → executor
  mutates resonance stat → carrier reflects the new value.

**Files touched:**
- `/Users/nikki/projects/wordlarky/project.sgrmagic` (data
  only)
- `packages/testing/src/fireflies-end-to-end.test.ts` (new)

## Success criteria

- All `pnpm typecheck`, `pnpm test`, `pnpm lint`,
  `node tooling/check-package-boundaries.mjs`, and
  `node tooling/check-mechanics-boundary.mjs` pass.
- Goal-line test passes end-to-end in a real wordlarky
  session.
- **No engine code in `runtime-core`, `render-web`, or
  `domain` references the strings `"fireflies"`,
  `"resonance-point"`, `"rackwick"`, or `"wordlarky"`** —
  not in fixtures, not in defaults, not in tests for code
  that's not specifically about these. (Tests for the
  Fireflies plugin obviously reference "fireflies"; that's
  fine. Tests for the wordlarky integration reference
  wordlarky; that's fine. The rule is about unrelated
  engine modules.)
- The Fireflies plugin's source code references neither
  "Rackwick" nor "wordlarky" nor "resonance" nor any
  specific game's vocabulary.
- A second hypothetical project could enable the same
  Fireflies plugin with a different `emitKind` and
  a different `onComplete` and the engine + plugin would
  work unchanged.

## Risks

1. **Plugin re-entry / concurrent triggers.** What happens
   if the player triggers the same emit twice in quick
   succession (e.g. spamming interact)? The Fireflies
   plugin should refuse a second trigger while a puzzle is
   already open. Story 44.3 must specify the gating
   behavior.
2. **Per-project plugin discovery is still the obvious
   next gap, but for a smaller reason.** Now that the
   plugin's config lives in `pluginConfigurations` (data),
   wordlarky needs no bootstrap code. What it MAY still
   need is for the engine to know that the Fireflies
   plugin package should be loaded for this project. Today
   plugins live under `packages/plugins/src/catalog/` and are
   discovered by the runtime — the project enables them by
   id. That works for v1. The remaining "per-project plugin
   discovery" gap is about loading plugin code from
   project-relative paths so projects can ship their OWN
   plugins. Wordlarky doesn't need that for fireflies.
   Long-term right answer
   is a separate epic for project-owned plugin code.
3. **Plugin config validation MUST live in the plugin, not
   in domain.** Domain's `PluginConfigurationRecord.config`
   is `Record<string, unknown>` — opaque. Domain cannot
   import plugin packages (one-way deps), so it cannot
   know the plugin's schema. Validation runs inside the
   plugin's `setup(context)` at gameplay-session boot,
   throws on invalid, and the boot surfaces the throw the
   same way it surfaces invalid mechanics. The temptation
   to add "validate plugin configs at project save time"
   as a domain concern is real and wrong; that would
   require domain to import every plugin's schema. The
   sugarlang plugin already follows this pattern (Ajv
   internal to the plugin).
4. **Plugin contribution context shape will drift.** The
   v1 `MechanicsEmitHandlerContext` ships `mountRoot`,
   `dispatchCastable`, `config`, `claimInput`, and
   `releaseInput`. The known-coming-soon gap is **audio**
   — sugarengine's FireflyPattern had none, but firefly
   catch / success / fail SFX are an obvious quality win
   and Sugarmagic has a cue system from epic 041 that the
   context could expose via `emitSoundEvent(cueId)`.
   Deliberately deferred to v1.1 per "add fields when a
   real plugin needs them, not preemptively." Future
   plugins will also want render engine, asset sources,
   current
   region, etc.). Add fields one at a time as real
   plugins need them; resist a kitchen-sink context.
5. **DOM overlay z-index conflicts.** The Fireflies puzzle
   overlays the game viewport at runtime. The dialogue,
   inventory, document reader, and pause menu all do
   similar things. Z-index ordering needs to be
   consistent; story 44.3 should pick a plugin-overlay
   z-index band that doesn't fight existing UIs.
6. **Item interaction system might not have a clean
   dispatch site for "fire a castable on interact."**
   Today's interaction system handles readable / examine /
   consumable via direct calls into the inventory and
   document-reader UIs. Adding a fifth branch that
   dispatches through the mechanics executor needs to fit
   the existing site cleanly. Story 44.2 will read that
   code first; if the dispatch site is a tangle, factoring
   it is part of the story.
7. **The Fireflies plugin's default difficulty curve may
   not match wordlarky's gameplay.** That's a wordlarky
   tuning concern, not an engine or plugin one — wordlarky
   passes whichever difficulty it wants. Surfaced here so
   nobody confuses "the puzzle feels too hard for
   wordlarky" with "the plugin is broken."

## Builds on

- **Plan 043 (Mechanics System)** — the entire seam this
  epic builds depends on the executor's `emit` callback
  pattern. Plan 044 makes that emit accessible to plugins
  in addition to in-engine subscribers.
- **Existing plugin infrastructure** in
  `packages/plugins/` and `packages/runtime-core/src/plugins/`
  — Plan 044 adds one new contribution kind to the existing
  9, doesn't invent a parallel system.
- **Existing item interaction system** — `trigger-castable`
  is a new branch of an existing dispatch site, not a
  parallel interaction system.

## Notes for AI authors of plugins built on this seam

- The plugin is a self-contained npm package. It registers
  exactly one (or a few related) `mechanics.emitHandler`
  contributions. It MUST NOT reach into engine internals
  beyond the public seam.
- The plugin MUST NOT name any specific game's stats,
  characters, lore, or items. If your plugin only makes
  sense for one game, it should ship with that game's
  project, not under `packages/plugins/src/catalog/`.
- **Configuration is data, not code.** The plugin reads
  its config from `context.config` (sourced from the
  `config` field of the project's `PluginConfigurationRecord`
  in `pluginConfigurations`). Don't expose a JS `register()`
  API or take JS callbacks from the host game; that
  re-introduces game-specific code at the plugin boundary.
- **The plugin owns and validates its own config schema.**
  Domain delivers `context.config` as opaque
  `Record<string, unknown>` — it doesn't and can't validate
  plugin-specific shapes (one-way deps: domain doesn't
  import plugins). Validate inside `setup(context)`, fail
  loud (throw) on bad config; gameplay-session boot
  surfaces the error and refuses to start. Use Ajv against
  a JSON Schema you ship with your plugin (sugarlang's
  pattern is the precedent).
- **Game-specific decisions are dispatched as castables,
  not callbacks.** When your plugin needs to change game
  state (mutate a stat, trigger a quest event, fire
  another castable), it does so by calling
  `context.dispatchCastable(invocation)` with an
  invocation supplied in its config. The host project
  authors the castable in its mechanics block; the plugin
  just dispatches it. The plugin remains ignorant of what
  the castable does.
- For UI plugins, render to the `mountRoot` provided in
  the setup context. Don't reach for `document.body`
  directly — the host may want to scope or sandbox the
  mount surface.
- Dispose cleanly when the gameplay session tears down.
  The setup return shape includes an optional `dispose`
  for this purpose.
