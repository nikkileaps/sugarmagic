# Plan 039: Game UI + Menus Epic

**Status:** Implemented
**Date:** 2026-04-29

## Epic

### Title

Authorable, per-game **screen-space UI** for Sugarmagic — both
full-screen menu screens (start / pause / save / load / settings)
and an in-game HUD overlay (status bars, prompts, hotbar, etc.).
Game designers compose UI from a fixed palette of components
(Container, Text, Button, Image, ProgressBar, …), bind component
properties to live runtime state through a declarative path
syntax, and style with target-agnostic theme tokens. The web
target renders the authored tree as a React DOM overlay; the
boundary between game logic, render, and UI matches the project's
existing runtime-core / render-web / targets-web split.

### Goal

- **Two new authored content kinds**, parallel to `RegionDocument`:
  `MenuDefinition` (full-screen overlays) and `HUDDefinition`
  (the per-game in-game HUD). Both live on `GameProject` and
  travel with the project file.
- **Tree-of-nodes data model** for the authored UI. Each node
  has `kind`, `layout`, `props`, `bindings`, `children`. No raw
  HTML, no per-target markup — purely a portable data structure
  any future target (mobile, native) could re-render.
- **Theme-token styling.** A single project-level `UITheme`
  carries named tokens (`color.primary`, `font.heading`, etc.)
  and named `UIStyleDefinition`s; nodes reference styles by id.
  The web target compiles tokens to CSS custom properties; a
  future target would compile the same tokens to its own style
  primitive. Authoring never sees CSS.
- **Declarative bindings** — `text: $player.battery` reads from
  a flat `RuntimeUIContext` populated each frame from ECS state.
  `onClick: { action: "load-region", args: { regionId: "opening" } }`
  dispatches into a string-keyed action registry that the runtime
  owns. No hand-written JS in authored documents.
- **DOM overlay rendering**, NOT in-canvas UI. Three-mesh-ui,
  Drei `<Html>`, and `CSS3DRenderer` are explicitly rejected
  (see "Why this epic exists" below).
- **Studio authoring surface** — phased: v1 ships a structured-
  form inspector (node-tree panel + property editor); v2 adds
  a visual canvas drag/drop. Per the AGENTS.md "Default
  Implementation Bias," ship the value first; visual editor
  follows once the data model has proven out.

### Why this epic exists

Sugarmagic has no story for in-game UI today. Player-facing menus
and HUDs are authored ad-hoc inside `targets/web`'s React tree,
which means:

1. **Per-game customization isn't possible.** Any game built on
   this runtime gets the same hardcoded HUD; an art-directed
   start screen requires forking `targets/web`.
2. **Boundary violation.** UI lives in `targets/web` but
   references game state directly through implementation-level
   imports, so it can't be authored by a game designer in
   Studio.
3. **No path to other targets.** A future mobile or native
   target would need its own UI rewrite per game.

The sibling architecture pattern is already established:
`RegionDocument` is authored data, runtime-core resolves it into
ECS state, render-web draws it, targets-web orchestrates. UI
needs the same shape — authored documents, a runtime bridge that
reads ECS state and produces UI-context state, and a target-
specific renderer.

Research summary (informing the architecture):

- **Three.js community pattern is universally DOM/CSS overlay**
  for screen-space UI. Three-mesh-ui is for VR / world-space UI;
  Drei `<Html>` is for diegetic 3D-anchored labels;
  CSS3DRenderer is for 3D-perspective DOM. None fit screen-space
  HUD/menus.
- **Unity UI Toolkit** is the closest authoring ancestor worth
  borrowing from: a UXML visual tree + USS theming + a reactive
  data-binding layer is exactly what we want — minus the XML.
- **Bevy `bevy_ui`** models UI as ECS entities (one entity per
  node + Style + Layout components). Theoretically pure but in
  practice forces hand-written Rust because Bevy ships no visual
  authoring; the lesson is that ECS-as-UI-storage *requires* a
  declarative authored format on top, which is the gap we're
  filling for our stack.
- **Godot** uses signals (UI emits events, game listens). Maps
  cleanly to our DOM-overlay + Zustand pattern: actions emit,
  ECS systems consume.

The architecture below combines Unity's data shape (tree + theme +
bindings) with Godot's event flow (signals → actions), implemented
as a React DOM overlay on top of our existing canvas.

### Studio embeds the target for preview (architectural pattern)

The Studio UI-editor preview must render authored UI **identically
to the running game** — same component tree, same layout, same
theme application, same binding resolution. The reflexive way to
guarantee that is to extract the renderer into a shared package
that both Studio and `targets/web` import. **We are explicitly
rejecting that approach.** The renderer lives in `targets/web`,
and Studio depends on `targets/web` for the purpose of embedding
it as a preview surface.

This formalizes the **"Studio-embeds-target-for-preview"** pattern
as a permitted dependency relationship in the project graph:

```
domain  ←  runtime-core  ←  targets/web
                        ←  targets/tauri  (future)
                        ←  targets/terminal  (future)

apps/studio   →   targets/web        (when previewing the web target)
apps/studio   →   targets/terminal   (when previewing the terminal target)
```

The general "Studio shouldn't import target-specific code" rule
still applies to all of Studio's authoring code. This pattern is
the single carve-out: **a preview surface that embeds a target
IS allowed to depend on that target**. The same pattern is what
Unity Play Mode is — the Unity editor literally runs the Unity
runtime as its preview, not a separate "preview-mode"
re-implementation.

The contract: each target exposes a `bootPreviewSession(options)`
function. Options include the project snapshot, optional sample
runtime-context override (so Studio can inject placeholder
`player.battery` etc. for binding visualization), and a DOM /
mount target. Studio calls into that entry point — no reaching
into target internals. The same shape works for any future
target (`targets/terminal.bootPreviewSession`,
`targets/tauri-ipad.bootPreviewSession`).

Long-term this enables a "preview-target picker" in Studio: the
designer chooses which target they're authoring against. v1
hardcodes to web; the architecture is unblocked.

### Why we're NOT extracting a shared `packages/game-ui-web`

A new shared package whose only purpose is to host
`GameUILayer` so neither Studio nor `targets/web` "imports the
other" would launder the dependency through a third node without
fixing the actual question — and would create a package whose
boundaries are defined by a dodge rather than a real domain. By
contrast:

- `packages/render-web` is the shared 3D-pipeline package
  (WebGPU, Three.js, shader runtime, scatter, post-process). DOM
  UI components don't belong there — that conflates "rendering
  engine" with "UI toolkit."
- `packages/ui` is Studio chrome (Inspector, PanelSection,
  Mantine wrappers — editor audience). In-game runtime UI
  components (`<UIButton>` rendered to a player) are a different
  audience with a different lifecycle. Mixing them in one
  package makes ownership ambiguous.

The renderer is **target output**. It belongs in the target. The
preview-embeds-target pattern lets Studio reuse it without
laundering.

### Goal-line test

After 039 lands:

- A game designer opens Sugarmagic, navigates to a new
  `Game UI` workspace, and authors a start menu with a "New
  Game" button + a "Settings" button without writing code.
- The game designer authors a HUD with a battery progress bar
  bound to `player.battery` and a label bound to `region.name`.
- Both render at runtime in `targets/web` exactly as authored,
  with the bound values updating each frame from ECS state.
- The "New Game" button dispatches a `start-new-game` action
  which the runtime handles by transitioning into the active
  region.
- Pressing the bound pause key brings up the pause-menu
  `MenuDefinition`; selecting "Resume" hides it.
- Restyling the project's `UITheme` color tokens recolors every
  authored UI surface without touching node trees.
- `grep -r "import.*targets/web" packages/runtime-core` returns
  nothing (no boundary regressions).
- `grep -r "import.*targets/web" packages/render-web` returns
  nothing (UI is target-side, not in shared rendering).
- `grep -r "import.*targets/web" packages/domain` returns nothing.
- Studio importing from `targets/web` is permitted for preview
  surfaces only, and goes through root exports — no reaching
  into target internals. Today that includes the existing game
  preview host (`createWebRuntimeHost` in `apps/studio/src/preview.ts`)
  and the UI-authoring preview entry point (`bootPreviewSession`
  in `apps/studio/src/preview/UIPreviewSession.tsx`).

## Scope

### In scope

- **`UINode`, `UIBindingExpression`, `UIStyleDefinition`,
  `UITheme` types** in `packages/domain/src/ui-definition/`.
- **`MenuDefinition` and `HUDDefinition`** content kinds with
  identity + factories + normalizers.
- **`GameProject` extension**: `menuDefinitions:
  MenuDefinition[]`, `hudDefinition: HUDDefinition | null`,
  `uiTheme: UITheme`. Load-time normalization for legacy
  projects (missing fields default to empty / built-in starter
  theme).
- **Authoring-session helpers**: add / update / remove for
  menus, mutate-in-place for hudDefinition, theme mutations.
- **`SemanticCommand`s**: `CreateMenuDefinition`,
  `UpdateMenuNode`, `AddMenuNode`, `RemoveMenuNode`,
  `UpdateHUDNode` (etc.), `UpdateUITheme`. Same shape as
  existing region/asset commands; flow through `applyCommand`.
- **Runtime UI context bridge** in
  `packages/runtime-core/src/ui-context/`. A System that runs
  each tick, queries ECS for the live values referenced by
  the active UI's bindings (currently rooted at `player.*`,
  `region.*`, `game.*`), and writes the resulting flat
  `RuntimeUIContext` object into a vanilla store the web
  target subscribes to.
- **Action registry** in `runtime-core`. String → handler
  function map; handlers receive `(args, world)` and dispatch
  ECS commands or set runtime state. Initial actions:
  `start-new-game`, `pause-game`, `resume-game`,
  `load-region`, `quit-to-menu`, `save-game` (stub),
  `load-game` (stub).
- **Web rendering layer** in `targets/web/src/GameUILayer.tsx`.
  React component mounted as a sibling `<div>` to the canvas
  (`position: absolute; inset: 0; pointer-events: none`).
  Subscribes to runtime UI store + active menu state. For each
  authored `UINode` produces a typed React component
  (`<UIContainer>`, `<UIText>`, `<UIButton>`, …). Bindings
  resolved per-render from store; fine-grained selectors so a
  battery-level change doesn't re-render the whole tree.
  Dispatches button actions through the action registry.
- **Theme compilation**: `UITheme.tokens` mapped to CSS custom
  properties on the `GameUILayer` root; `UIStyleDefinition`s
  compiled to inline `style` objects (or `className` if a
  named-class strategy turns out faster — implementation
  detail).
- **Default starter content**: every new project gets a
  starter `UITheme` (sane defaults), one starter
  `MenuDefinition` (a minimal start menu with "New Game"
  button), and a starter `HUDDefinition` (an empty container
  — author fills in).
- **Studio Game UI workspace**, v1 structured-form authoring,
  **lives under Design** (not Build). Reasoning: Build's
  existing kinds are region-scoped (Layout, Landscape,
  Surfaces, Behavior all describe one region's contents);
  Design's existing kinds are project-scoped (Player, NPCs,
  Items, Spells, Documents, Dialogues, Quests — defined once,
  referenced across the game). Menus + HUD are project-scoped,
  so `DesignWorkspaceKind` is the consistent home. Documents
  and Dialogues are also already authored-tree compositions in
  Design, so the kind shape matches.
  - New `DesignWorkspaceKind = "game-ui"`.
  - Left panel: tree view of nodes (Menus list + HUD root +
    each menu's node tree).
  - Right panel: property inspector for the selected node
    (kind dropdown + layout fields + props fields + style
    picker + bindings editor).
  - Center panel: live preview of the selected
    Menu/HUD rendered through the SAME `GameUILayer`
    component the runtime uses (via a Studio-side
    `RuntimeUIContext` shim that supplies sample data so
    bound values render).
  - Theme editor: a section/dialog for token + style
    management.

### Out of scope

- **Visual canvas drag-and-drop authoring.** Defer to v2.
  Structured-form inspector is enough to validate the data
  model and unblock first authored UIs. The visual canvas
  is a meaningful surface (drag handles, gizmo-style resize,
  z-order interactions) and is its own epic.
- **In-canvas / world-space UI.** Diegetic 3D labels (floating
  damage numbers, NPC name tags anchored above heads) are a
  separate concern that calls for Drei `<Html>` or a custom
  billboard system. Plan 039 owns screen-space UI only.
- **Animation / transitions** between menus or for HUD
  elements. v1 ships hard show / hide. Animated transitions
  (fade, slide-in) are valuable but can land in v2 once the
  data model is settled.
- **Multi-screen menu flows** as a single document. v1 has
  multiple `MenuDefinition`s with a runtime `visibleMenuKey`
  selector. A nested-screens-inside-one-menu model is an
  authoring complication we can live without.
- **Responsive layout / safe zones.** v1 assumes a known
  viewport size and uses simple flex layout. Aspect-ratio-
  aware authoring is its own design problem — defer.
- **Custom component kinds.** v1 ships a fixed palette
  (Container / Text / Button / Image / ProgressBar / Spacer).
  Author-defined component templates ("CharacterPanel",
  "InventorySlot") are a v2 composition feature.
- **Dynamic / iterated lists.** A "for each item in inventory,
  render a slot" binding is a meaningful authoring power but
  needs a separate design pass. v1 supports static trees only.
- **Save/load of UI state** beyond what the runtime already
  persists. The action registry's `save-game` / `load-game`
  are stubs — actual persistence is its own epic (and likely
  exists in a sibling form already).

## Shape sketch

```ts
// packages/domain/src/ui-definition/index.ts

export type UINodeKind =
  | "container"
  | "text"
  | "button"
  | "image"
  | "progress-bar"
  | "spacer";

export type UIAnchor =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export interface UILayoutProps {
  direction: "row" | "column";
  gap: number;            // px or token
  padding: number;        // px or token
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "between" | "around";
  width: "auto" | "fill" | number;     // px or fraction
  height: "auto" | "fill" | number;
}

export type UIBindingExpression =
  | { kind: "literal"; value: unknown }
  | {
      kind: "runtime-ref";
      path: string;            // e.g. "player.battery"
      format?: "percent" | "integer" | "decimal-1" | null;
    };

export interface UIActionExpression {
  action: string;            // registry key; "start-new-game", "load-region"
  args?: Record<string, unknown>;
}

export interface UINode {
  nodeId: string;
  kind: UINodeKind;
  styleId: string | null;
  layout: UILayoutProps;
  anchor: UIAnchor | null;     // HUD nodes anchor to a viewport corner
  /** Kind-specific props: text content, image src, min/max, etc. */
  props: Record<string, UIBindingExpression>;
  /** Event bindings: { onClick: UIActionExpression, ... } */
  events: Record<string, UIActionExpression>;
  children: UINode[];
}

export interface UIStyleDefinition {
  styleId: string;
  displayName: string;
  properties: {
    color?: string;            // resolves token "color.primary" or literal "#a8d8ea"
    background?: string;
    fontSize?: string;
    fontFamily?: string;
    fontWeight?: string;
    borderRadius?: string;
    borderColor?: string;
    borderWidth?: string;
    opacity?: number;
  };
}

export interface UITheme {
  tokens: Record<string, string>;
  styles: UIStyleDefinition[];
}

export interface MenuDefinition {
  /** Authored document identity used by editor/session/history systems. */
  definitionId: string;
  definitionKind: "menu";
  displayName: string;
  /**
   * Stable runtime/action address. Runtime visible-menu state uses this key,
   * never the authored `definitionId`.
   */
  menuKey: string;
  root: UINode;
}

export interface HUDDefinition {
  definitionId: string;
  definitionKind: "hud";
  root: UINode;
}
```

```ts
// packages/runtime-core/src/ui-context/index.ts

export interface RuntimeUIContext {
  player: {
    battery: number;
    maxBattery: number;
    health: number;
    position: [number, number, number];
  };
  region: {
    name: string;
    id: string;
  };
  game: {
    /** Runtime-facing menu address; matches MenuDefinition.menuKey. */
    visibleMenuKey: string | null;
    isPaused: boolean;
  };
}

// One System per runtime tick: read ECS, emit context.
export class UIContextSystem extends System { /* ... */ }

// String-keyed action registry. Caller adds handlers at boot.
export interface UIActionRegistry {
  register(actionKey: string, handler: UIActionHandler): void;
  dispatch(action: UIActionExpression, world: World): void;
}
```

```ts
// targets/web/src/GameUILayer.tsx

export interface GameUILayerProps {
  hudDefinition: HUDDefinition | null;
  menuDefinitions: MenuDefinition[];
  theme: UITheme;
  /** Vanilla store the runtime writes context into each tick. */
  uiContextStore: UIContextStore;
  /** Vanilla store the runtime writes visibleMenuKey / isPaused into. */
  uiStateStore: UIStateStore;
  /** Action dispatcher — wired to UIActionRegistry. */
  onAction: (action: UIActionExpression) => void;
}
```

## Stories

### 39.1 — Domain types + content kinds + commands

**Outcome:** `packages/domain/src/ui-definition/` package (or
folder under existing domain) with the full type set above.
`MenuDefinition` + `HUDDefinition` interfaces, identity
patterns, factories (`createDefaultMenuDefinition`,
`createDefaultHUDDefinition`, `createDefaultUITheme`).
`GameProject` gains the three new fields; load-time normalization
seeds them when missing. `SemanticCommand` family for menu /
hud / theme mutations. `applyCommand` extended to dispatch them.
Tests: round-trip CRUD + load-time normalization for legacy
projects.

**Files touched:**
- `packages/domain/src/ui-definition/index.ts` — new
- `packages/domain/src/game-project/index.ts` — add fields +
  normalize
- `packages/domain/src/commands/index.ts` + `executor.ts` —
  new commands
- `packages/domain/src/authoring-session/index.ts` —
  CRUD helpers
- `packages/testing/src/ui-definition.test.ts` — new

### 39.2 — Runtime UI context bridge + action registry

**Outcome:** `runtime-core` exposes
`createUIContextSystem(world): System` that, each tick, reads
ECS components for the player + region + game state and writes
a `RuntimeUIContext` object to a vanilla store. Path resolution
is centralized: a `resolveBinding(path, context)` helper used by
both runtime and Studio preview. `UIActionRegistry` initialized
with the v1 action set (`start-new-game`, `pause-game`,
`resume-game`, `load-region`, `quit-to-menu`, stubs for save/
load). Tests cover path resolution + action dispatch.

**Files touched:**
- `packages/runtime-core/src/ui-context/index.ts` — new
- `packages/runtime-core/src/ui-actions/index.ts` — new
  registry + initial handlers
- `packages/testing/src/ui-context-bridge.test.ts` — new
- `packages/testing/src/ui-action-registry.test.ts` — new

### 39.3 — Web rendering layer (`GameUILayer`) + `bootPreviewSession` entry point

**Outcome:** `targets/web/src/GameUILayer.tsx` mounts a React
tree over the canvas. For each authored node renders a typed
component (`<UIContainer>`, `<UIText>`, `<UIButton>`,
`<UIImage>`, `<UIProgressBar>`, `<UISpacer>`). Theme is applied
as CSS custom properties on the layer root. Bindings resolved
per-component with fine-grained store selectors so a battery
change re-renders only the bound nodes. Button clicks call the
runtime's `onAction`, which dispatches through
`UIActionRegistry`. The `targets/web/src/runtimeHost.ts`
mounts `GameUILayer` as a sibling div to the canvas and wires
the stores.

**Plus**: `targets/web` exposes a public
`bootPreviewSession(options)` entry point that Studio (39.4)
calls to embed the target as its UI-editor preview. Options:

```ts
interface PreviewSessionOptions {
  project: GameProject;
  /**
   * Override the runtime context so authored bindings have
   * sample values to resolve against in Studio (where there's
   * no live game ECS). Optional — when omitted, the target
   * boots its normal runtime ECS pipeline.
   */
  sampleRuntimeContext?: Partial<RuntimeUIContext>;
  /**
   * DOM element to mount into. Caller owns lifecycle.
   */
  mountInto: HTMLElement;
  /**
   * Which menu to show, or null for "running game" (HUD only).
   * This is MenuDefinition.menuKey, not definitionId. Studio passes
   * the currently-edited menu's menuKey.
   */
  initialVisibleMenuKey?: string | null;
}

interface PreviewSession {
  /** Re-render against an updated project snapshot. */
  update(project: GameProject): void;
  dispose(): void;
}
```

This is the **only** entry point Studio reaches into; the
internals of `targets/web` stay private. Future targets export
the same shape so the preview-target picker (post-v1) just
swaps which import is loaded.

**Files touched:**
- `targets/web/src/GameUILayer.tsx` — new (root)
- `targets/web/src/ui/UIContainer.tsx`, `UIText.tsx`,
  `UIButton.tsx`, `UIImage.tsx`, `UIProgressBar.tsx`,
  `UISpacer.tsx` — new
- `targets/web/src/ui/resolveBinding.ts` — re-export of
  runtime-core helper for symmetry
- `targets/web/src/ui/applyTheme.ts` — token → CSS-custom-
  properties compiler
- `targets/web/src/runtimeHost.ts` — mount + wire
- `targets/web/src/bootPreviewSession.ts` — new public entry
  point for Studio embedding
- `targets/web/src/index.ts` — export `bootPreviewSession`
  and the `PreviewSessionOptions` / `PreviewSession` types
- `packages/testing/src/game-ui-layer.test.tsx` — new
  (jsdom): renders a sample `MenuDefinition` with bound text +
  asserts the rendered DOM updates when the context store
  changes

### 39.4 — Studio Game UI workspace (v1: structured-form authoring)

**Outcome:** A new workspace under **Design** (not Build),
keyed as `DesignWorkspaceKind = "game-ui"`. Sits alongside
Player / NPCs / Spells / Items / Documents / Dialogues /
Quests — Game UI is project-scoped, matching the rest of
Design. Left panel: tree view (Menus list + HUD + nested
nodes). Right panel: property inspector for the selected node
(kind dropdown drives the visible field set; layout / props /
style / bindings sections). Center panel: live preview that
**embeds `targets/web` via `bootPreviewSession`** rather than
re-rendering authored UI in Studio's own React tree. Studio
supplies a sample `RuntimeUIContext` through the options so
bindings resolve against placeholder values; the embedded
target renders the authored UI through the *same* code path
as the running game. Theme editor is a sibling sub-workspace
with token + style management; mutations re-update the
preview session via `session.update(nextProject)`.

This is the first concrete use of the
**Studio-embeds-target-for-preview** pattern (see "Studio
embeds the target for preview" in the Epic section). Studio's
import surface is intentionally narrow: only
`bootPreviewSession` from `@sugarmagic/target-web`. No reach
into target internals; no shared third package.

**Files touched:**
- `packages/workspaces/src/design/game-ui/` — new workspace
  module (view, panels, sub-views) — sibling to existing
  `design/PlayerWorkspaceView.tsx`,
  `design/NPCWorkspaceView.tsx`, etc.
- `packages/workspaces/src/design/index.tsx` — extend the
  Design hub with the `"game-ui"` route
- `apps/studio/src/preview/UIPreviewSession.tsx` — Studio
  React component that owns a `PreviewSession` lifecycle:
  imports `bootPreviewSession` from `@sugarmagic/target-web`,
  mounts on attach, calls `session.update()` when authored
  state changes, disposes on unmount
- `apps/studio/src/preview/sampleRuntimeContext.ts` —
  generates placeholder `RuntimeUIContext` for binding
  visualization in the editor (e.g.
  `{ player: { battery: 0.65, ... }, region: { name: "Sample Region", ... } }`)
- `apps/studio/src/App.tsx` — wire the new workspace
- `packages/shell/src/index.ts` — extend `DesignWorkspaceKind`
  with `"game-ui"`
- `apps/studio/package.json` — add `@sugarmagic/target-web`
  as an explicit `dependencies` entry. This dependency is the
  load-bearing artifact of the Studio-embeds-target pattern;
  the package boundary check passing this is the proof the
  pattern is permitted.

### 39.5 — Default starter UI + theme + first integration

**Outcome:** Every new project ships with a usable starter:
a default `UITheme` (Sugarmagic palette tokens + a `default`
style), a `start-menu` `MenuDefinition` with "New Game" +
"Settings" buttons, an empty `HUDDefinition`. The web target
dispatches the `start-new-game` action by hiding the start menu
and revealing the HUD; pause key cycles a `pause-menu`. End-
to-end manual smoke test: create new project, run targets-
web, see start menu, click "New Game", land in the active
region with the (empty) HUD overlaid.

**Files touched:**
- `packages/domain/src/ui-definition/index.ts` —
  `createDefaultUITheme`, `createDefaultStartMenu`,
  `createDefaultPauseMenu`, `createDefaultHUD`
- `packages/domain/src/game-project/index.ts` — invoke
  starters during normalization for legacy projects
- `targets/web/src/runtimeHost.ts` — wire pause-key handler +
  initial visible menu
- `packages/testing/src/game-ui-integration.test.ts` — new

## Success criteria

- A game designer can author a start menu with two buttons via
  the structured-form inspector, save the project, run
  `targets/web`, and see the menu render at the authored
  position with the authored colors. Clicking either button
  dispatches the bound action.
- Editing a theme token (`color.primary`) updates every node
  that uses a style referencing that token, both in Studio
  preview and in the live runtime.
- A HUD progress-bar bound to `$player.battery` ticks down
  every frame as the player drains battery, with no visible
  jitter.
- `grep -r "import.*targets/web" packages/runtime-core/`
  returns nothing — boundary intact.
- `grep -r "import.*GameUILayer" packages/render-web/` returns
  nothing — UI is target-side, not in the shared rendering
  package.
- Existing project files (no `menuDefinitions` etc.) load
  cleanly with the starter content seeded by normalization.

## Risks

- **Binding-path schema lock-in.** `"player.battery"` is fine
  for a single-player game but ducks the question of how to
  bind to "the nearest NPC" or "all enemies in range." v1
  ships a fixed namespace (`player.*`, `region.*`, `game.*`)
  to avoid premature abstraction. Mitigation: make
  `resolveBinding` a single function so adding a new path
  root in v2 doesn't ripple.
- **Action-registry coupling.** v1 hardcodes the action set in
  runtime-core. Eventually plugins will want to register their
  own actions. Mitigation: design the registry as a `register
  / dispatch` pair from day one, so plugin handlers slot in
  the same way.
- **Studio preview parity.** The Studio preview must use the
  exact same `GameUILayer` component as the web runtime, or
  authored UI will look different in Studio vs. play. The
  Studio-embeds-target-for-preview pattern guarantees this by
  construction — Studio doesn't render UI itself, it embeds
  `targets/web` via `bootPreviewSession`. The sample-context
  shim is the only intentional divergence (placeholder values
  for binding visualization); layout + styling are identical
  because they run through the SAME code. Test that swapping
  the sample context updates the preview correctly.
- **Studio→target dependency direction.** The
  Studio-embeds-target-for-preview pattern means
  `apps/studio` declares `@sugarmagic/target-web` as a
  dependency. This is already permitted by
  `tooling/check-package-boundaries.mjs:22–34` — no new lint
  carve-out is needed. The boundary check passing is the
  proof this is sanctioned, not bent. New targets joining
  the project (`targets/tauri`, `targets/terminal`) would
  need a one-line addition to that allowlist.
- **Performance of fine-grained store selectors.** A HUD with
  20 bound nodes that all re-evaluate every tick is fine; one
  with 200 nodes might not be. Use Zustand selectors plus
  `shallowEqual` on the projection; profile when v1 lands.
- **Authoring UX without a visual canvas.** v1's structured-
  form inspector is functional but not delightful. Real game
  designers will want drag-and-drop. Set the v2 expectation
  early: ship v1 ugly-but-correct, get the data model proven,
  then build the canvas.

## Builds on

- [Plan 037: Library-First Content Model](037-library-first-content-model-epic.md)
  — established the pattern of distinct authored content kinds
  with their own collections + commands. UI definitions follow
  the same shape.
- [Plan 038: Entity-Owned Character Content](038-animation-library-epic.md)
  — established that content can be entity-owned (no library
  popover) when 1:1 with its owner. `HUDDefinition` is similar:
  one per game project, no browsing — though the new content
  kinds are project-owned rather than entity-owned, the
  authoring-surface lesson (inspector-driven, not popover-
  driven) carries over.
- ECS architecture from `runtime-core` — UI is *not* modeled
  as ECS entities (the Bevy-style approach). Instead a single
  `UIContextSystem` reads ECS state into a flat projection.
  This keeps the UI rendering layer ignorant of ECS, matches
  React's data-flow grain, and avoids needing a visual editor
  to make UI authorable (Bevy's lesson learned).

## Research footnotes

The architecture above synthesizes patterns from:

- **Unity UI Toolkit** for the tree + theme + reactive-binding
  data shape (UXML/USS minus the XML — JSON-ish data is more
  tooling-friendly anyway).
- **Godot's signal pattern** for the UI-action → ECS-event
  flow.
- **Bevy `bevy_ui`** as a cautionary tale: ECS-as-UI-storage
  forces hand-written code without a visual or declarative
  authoring layer; the declarative authored format IS the
  system here.
- **Three.js community DOM-overlay convention** for the
  rendering boundary. `three-mesh-ui`, `<Html>`, and
  `CSS3DRenderer` were each evaluated and rejected for
  screen-space UI.
