# Plan 027: Preview Debug HUD Overlay Epic

**Status:** Proposed  
**Date:** 2026-04-12

## Epic

### Title

World-class unified debug HUD overlay for Preview mode.

### Goal

Provide a compact, unobtrusive, always-available debug HUD that renders as a DOM overlay on top of the 3D Preview viewport. The HUD shows only in Preview (`hostKind: "studio"`) — never in the published game. It gives authors and developers instant visibility into runtime performance and world state without opening browser DevTools or reading console logs.

### Why this epic exists

Debugging the Preview currently requires reading console logs, opening browser DevTools panels, or navigating to plugin workspace pages in Design mode. There is no in-viewport heads-up display showing real-time performance data or scene state. Authors iterating on game content need to see FPS, triangle counts, and active entity counts at a glance without leaving the game viewport.

### Design principles

- **Preview-only** — zero footprint in published builds. Gated on `hostKind === "studio"`.
- **Unobtrusive** — collapsed by default to a small icon button in the bottom-left corner. Does not interfere with gameplay, dialogue panels, quest trackers, or other game UI.
- **Card-based** — information is organized into switchable cards. One card visible at a time. Each card is a focused diagnostic view.
- **No heavy text** — the HUD is not a log viewer. Dense logs, middleware traces, and observation dumps belong in the browser console (controlled by plugin debug logging toggles). The HUD shows key metrics, gauges, and status indicators.
- **Plugin-extensible** — plugins can contribute debug cards via a `debug.hudCard` runtime contribution, the same pattern as `dialogue.entryDecorator` or `conversation.middleware`. This keeps plugin diagnostics composable — sugarlang, sugaragent, or any future plugin can add a card without polluting each other or the core engine HUD. The core epic does NOT define any plugin-specific cards; those are owned by the plugins themselves.

### Non-goals

- The HUD is not a replacement for the Turn Inspector, Compile Status, or other Design-mode workspace sections.
- The HUD does not log or persist data — it shows live, ephemeral, frame-by-frame or turn-by-turn snapshots.
- The HUD does not include text input, configuration controls, or editable fields. It is read-only.
- The HUD does not show plugin installation status, configuration, or health — that belongs in the console logs and Design-mode workspace.

### Dependencies

- **Plan 026 (Billboard System)** — Story 27.5 uses text billboards (`BillboardComponent` with `descriptor.kind: "text"`, `displayMode: "overlay"`, `orientation: "spherical"`) for in-world entity debug labels. The billboard system handles world-to-screen projection, pooling, frustum culling, and lifecycle. This epic does NOT build its own label positioning — it creates `BillboardComponent` instances and lets the billboard system render them.

### Technology notes

- The HUD card area is a DOM overlay, not a 3D/canvas element. It renders in a fixed-position container above the game canvas.
- In-world entity labels use Plan 026's text billboard system (`BillboardComponent` with `kind: "text"`), not a separate DOM projection system.
- The HUD reads from `renderer.info` (Three.js WebGPU renderer) for GPU stats, and from the ECS world / gameplay session for entity and system stats.
- Cards are plain DOM elements — no React dependency in runtime-core. The contribution API accepts a `renderCard(container: HTMLElement) => void` callback.
- CSS uses the existing `sm-` design token variables for consistency with the game UI.

---

## Stories

### Story 27.1 — HUD container and toggle button

**Tasks:**

1. Create `packages/runtime-core/src/debug-hud/DebugHud.ts` — the main HUD container.
2. Render a small icon button (e.g. a gauge icon or bug icon) in the bottom-left corner of the Preview viewport, fixed-position, `z-index` above the game canvas but below dialogue panels.
3. Clicking the button toggles the HUD open/closed. Default state: closed.
4. When open, the HUD displays a compact card area (roughly 260×160px) anchored to the bottom-left, with a row of small tab dots or arrow buttons to switch between cards.
5. Gate the entire HUD on `boot.hostKind === "studio"`. If `hostKind` is `"published-web"`, the HUD module is never instantiated and contributes zero bytes/DOM.
6. Inject minimal CSS via a `<style>` element (same pattern as `DialoguePanel`'s `injectStyles`).

**Acceptance:**

- HUD button appears in Preview, not in published game.
- Clicking toggles a card area. Area is empty until cards are registered.
- HUD does not interfere with dialogue panel, quest tracker, or inventory UI.

---

### Story 27.2 — Renderer stats card (core)

**Tasks:**

1. Register a built-in "Renderer" debug card that reads from the WebGPU renderer.
2. Display: FPS (rolling average over last 60 frames), frame time (ms), draw calls, triangle count, texture count, geometry count.
3. FPS uses a simple ring buffer — no external stats library.
4. Update once per frame via the existing render loop callback.
5. Format as a compact grid: large FPS number top-left, smaller metrics below in two columns.

**Acceptance:**

- FPS counter is accurate and stable.
- Triangle count matches scene complexity (increases when entities are added).
- Card updates live without noticeable overhead.

---

### Story 27.3 — World state card (core)

**Tasks:**

1. Register a built-in "World" debug card showing ECS/gameplay session state.
2. Display: active entity count, active system count, active NPC count, active quest count, current scene ID, current area, player position (x, y, z).
3. Update once per second (not every frame — this data doesn't change at 60fps).

**Acceptance:**

- Entity/system counts match the scene.
- Player position updates as the player moves.
- Scene/area labels match what's visible in the viewport.

---

### Story 27.4 — Plugin debug card contribution API

**Tasks:**

1. Add a new runtime plugin contribution kind: `"debug.hudCard"`.
2. Contribution shape:
   ```typescript
   {
     cardId: string;
     displayName: string;
     renderCard: (container: HTMLElement) => void;
     updateCard?: () => void;
     disposeCard?: () => void;
   }
   ```
3. `gameplay-session.ts` collects `debug.hudCard` contributions and passes them to the `DebugHud`.
4. The HUD registers each plugin card as an additional tab after the core cards.
5. `updateCard` is called once per second for the active card only (not for hidden cards).
6. `disposeCard` is called when the HUD is destroyed.

**Acceptance:**

- A plugin can contribute a debug card and it appears in the HUD tabs.
- Only the active card's `updateCard` is called.
- Cards render correctly when switching tabs.
- Plugin cards do not pollute each other or the core HUD cards.

---

### Story 27.5 — In-world entity debug billboards (depends on Plan 026 billboard system)

**Tasks:**

1. For each NPC and the player entity, add a `BillboardComponent` with:
   - `descriptor: { kind: "text", content: <debug label>, style: <debug style> }`
   - `orientation: "spherical"`
   - `displayMode: "overlay"` (always visible, not occluded by geometry — you need to see NPC state through walls)
   - `offset: { x: 0, y: <above entity head>, z: 0 }`
   - No `lodThresholds` — debug billboards are always active when enabled
2. The text content is updated once per second (not per frame) with: entity display name, current task (if any), current activity, current area, and proximity band to the player.
3. Debug billboard `BillboardTextStyle` uses a distinct visual style: monospace font, small size, semi-transparent dark background with a subtle border — visually distinct from any future gameplay billboards.
4. The HUD controls billboard visibility: when the HUD is collapsed or the billboard toggle is off, remove (or set `visible: false` on) the debug `BillboardComponent` instances. When toggled on, re-add them. The billboard system handles all rendering, positioning, and cleanup.
5. This subsumes the "spatial debug overlay" requirement from Plan 024.
6. Plugin contribution: plugins can contribute additional debug billboard lines via a `debug.entityBillboard` contribution that receives the entity ID and returns extra text lines to append. The HUD concatenates core lines + plugin lines into the billboard's `content` string.

**Acceptance:**

- Floating debug labels appear above NPCs showing their current task/activity/area.
- Labels track entity positions smoothly (handled by Plan 026's text billboard renderer).
- Labels disappear when HUD is collapsed or billboard toggle is off.
- Spatial truth (area, proximity) is visible without opening DevTools.
- No custom world-to-screen projection code in this epic — all positioning is delegated to the billboard system.

---

### Story 27.6 — Visual polish and interaction refinement

**Tasks:**

1. Add a subtle fade/slide animation when the HUD opens/closes.
2. Add keyboard shortcut to toggle HUD (e.g. backtick `` ` `` or `F3`).
3. Ensure the HUD respects the game's dark theme — use `sm-` CSS variables.
4. Ensure the HUD is not interactive during dialogue (does not capture mouse/keyboard events that should go to the dialogue panel).
5. Remember the last-selected card tab across open/close toggles (not across page reloads).

**Acceptance:**

- HUD opens/closes smoothly.
- Keyboard shortcut works.
- HUD does not steal focus from dialogue input.

---

## QA gates

- [ ] HUD appears in Preview, never in published build.
- [ ] FPS and triangle counts are accurate under load (add 100+ entities and verify).
- [ ] Plugin cards render and update correctly.
- [ ] HUD does not cause measurable FPS drop (verify with/without HUD open).
- [ ] HUD does not interfere with any game UI element (dialogue, quest tracker, inventory, spell menu).
- [ ] Entity debug billboards show correct task/area/proximity data via Plan 026's text billboard system.
- [ ] Debug billboards toggle on/off correctly with the HUD.
- [ ] Plan 024 spatial debug overlay requirements are satisfied.
- [ ] No custom world-to-screen projection code — all in-world labels use Plan 026.
- [ ] All existing tests pass — no regressions.
