# Epic 12: Editor UX Contributions

**Status:** Proposed
**Date:** 2026-04-09
**Derives from:** [Proposal 001 § Plugin Contribution Surface](../../proposals/001-adaptive-language-learning-architecture.md#plugin-contribution-surface), [Plan 001 § Required Editor / UX Affordances](../001-welcome-to-wordlark-hollow-station-manager-placement-experience.md#required-editor--ux-affordances)
**Depends on:** Epic 2 (NPCDefinition.metadata), Epic 6 (compile cache + rebuild), Epic 11 (placement contract)
**Blocks:** Epic 14 (E2E tests may use editor affordances)

## Context

This epic adds the Studio-side UX affordances that make sugarlang first-class in the editor: a "Sugarlang role" dropdown on the NPC inspector, a scene density histogram, a manual "Rebuild Sugarlang Lexicon" button, a read-only placement question bank viewer, and a quest node `eventName` autocomplete hint.

None of these affordances are load-bearing for the runtime. A developer could author everything by hand-editing JSON. But Plan 001 (Welcome to Wordlark Hollow) and future content work will be massively easier with these surfaces, and the plugin feels professional-quality when they exist.

All contributions use the existing plugin contribution kinds (`design.workspace`, `design.section`, `project.settings`) from `packages/runtime-core/src/plugins/index.ts`. No new contribution kinds are invented.

## Prerequisites

- Epic 2 (`NPCDefinition.metadata` field)
- Epic 6 (compile cache exposes invalidate + listEntries for the rebuild button and status panel)
- Epic 11 (placement capability — the dropdown ties to this)

## Success Criteria

- "Sugarlang role" dropdown appears on the NPC inspector for agent-mode NPCs
- Scene density histogram appears in the region/scene authoring workspace
- "Rebuild Sugarlang Lexicon" button works and shows progress
- Placement question bank viewer is read-only but informative
- Quest node `eventName` field surfaces `sugarlang.placement.completed` as a hint when the target is a placement NPC
- All contributions are discoverable via the plugin system
- Each contribution has acceptance tests in the Studio test harness

## Stories

### Story 12.1: NPC inspector "Sugarlang role" dropdown

**Purpose:** Let authors tag an NPC as a placement NPC via a checkbox/dropdown in the NPC inspector.

**Tasks:**

1. Implement `ui/shell/npc-inspector-role-dropdown.tsx` as a React component that:
   - Reads the current `NPCDefinition` from the NPC inspector's form state
   - Displays a dropdown with options `None` / `Placement`
   - Updates `metadata.sugarlangRole` on change via the existing command dispatch
   - Shows a tooltip explaining what "Placement" does ("This NPC runs the cold-start language level assessment when the player first talks to them")
   - Only renders when the NPC's `interactionMode === "agent"` (scripted NPCs can't do placement)
2. Register the component as a `design.section` contribution in the NPC inspector workspace
3. Use the studio design system components (find them during implementation — likely in `packages/ui/shell/` or similar)

**Tests Required:**

- Unit test with a React testing library: changing the dropdown updates the mock form state
- Unit test: the dropdown only renders for agent-mode NPCs
- Integration test: opening an NPC inspector in Studio, selecting "Placement", saving, then reopening shows the dropdown in the selected state
- Smoke test: authoring flow from tag → placement-active conversation runs end-to-end

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "NPC Inspector Role Dropdown" section with screenshots (once available) and usage notes

**Acceptance Criteria:**

- Dropdown works
- Only shows for agent NPCs
- Save/load round-trip preserves the tag

### Story 12.2: Scene density histogram

**Purpose:** Show authors a per-scene CEFR-band histogram so they can spot scenes that are too dense, too flat, or mistargeted.

**Tasks:**

1. Implement `ui/shell/scene-density-histogram.tsx` as a React component that:
   - Reads the compiled scene lexicon for the currently selected scene (via the `SugarlangCompileCache` listEntries API from Epic 6)
   - Renders a bar chart: x-axis = CEFR bands (A1, A2, B1, B2, C1, C2), y-axis = lemma count
   - Highlights scenes where >30% of lemmas are above any configured target learner band
   - Shows a summary: "This scene has N lemmas; X% at A1, Y% at A2, ..."
   - Includes a diagnostics list from `CompiledSceneLexicon.diagnostics` (present under `authoring-preview` profile)
2. Register as a `design.section` contribution in the region/scene authoring workspace
3. Subscribe to cache invalidation events so the histogram refreshes when the scene is recompiled

**Tests Required:**

- Unit test: the component renders the expected bars for a fixture lexicon
- Unit test: the diagnostic warnings display correctly
- Integration test: changing scene text → background compile → histogram refreshes

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Scene Density Histogram" section

**Acceptance Criteria:**

- Histogram displays correctly for real scenes
- Auto-refresh works

### Story 12.3: "Rebuild Sugarlang Lexicon" button and compile status panel

**Purpose:** Author-initiated cache invalidation and recompile trigger, plus a visible cache status display for debugging.

**Tasks:**

1. Implement `ui/shell/manual-rebuild-button.tsx` and `ui/shell/CompileStatusSection.tsx` (or combine into one component)
2. The status section shows:
   - Total scenes in the project
   - Scenes with cached lexicons
   - Scenes with stale (content hash mismatch) lexicons
   - Scenes with missing lexicons
   - Last rebuild timestamp
3. The button calls `cache.invalidate()` and triggers the authoring scheduler to recompile every scene (per Epic 6 Story 6.9)
4. Progress is shown as scenes are recompiled, non-blocking
5. A toast notification confirms completion
6. Register as a `design.section` contribution in a new "Sugarlang Compile Status" panel (or in the plugin settings area)

**Tests Required:**

- Unit test: button click invokes the cache invalidate method
- Unit test: progress updates display correctly during a simulated rebuild
- Integration test: full rebuild flow with a small project

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Rebuild button" + "Compile status panel" sections

**Acceptance Criteria:**

- Button works end-to-end
- Status panel is informative

### Story 12.4: Placement questionnaire viewer (read-only)

**Purpose:** A read-only view that shows the shipped placement questions for the current project's target language, with CEFR band labels and character notes, so authors understand what the placement NPC will probe with.

**Tasks:**

1. Implement `ui/shell/placement-question-bank-viewer.tsx` that:
   - Loads the plugin-shipped `placement-questionnaire.json` for the configured target language (NOT a per-project file — the questionnaire is plugin data per Proposal 001 § Cold Start Sequence and Epic 11)
   - Displays each question with: question id, CEFR band, probe kind, target-language text(s), support-language fallback, character note
   - Groups by CEFR band (A1, A2, B1, B2)
   - Links each question to the authoring workspace that would override it if per-NPC overrides exist (v2 feature; for v1 just show a "future feature" note)
2. Register as a `design.section` contribution in the sugarlang settings workspace
3. Read-only for v1 — no editing, no per-project overrides yet

**Tests Required:**

- Unit test: renders a fixture bank correctly
- Unit test: handles missing language data gracefully

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Placement Question Bank Viewer" section

**Acceptance Criteria:**

- Viewer loads and displays the placement bank for ES and IT

### Story 12.5: Quest node `eventName` autocomplete hint

**Purpose:** When authoring a quest objective node whose target is an NPC tagged with `sugarlangRole: "placement"`, surface `sugarlang.placement.completed` as a suggested `eventName` so the author doesn't have to remember the magic string.

**Tasks:**

1. Implement `ui/shell/quest-node-event-hint.tsx` that:
   - Hooks into the quest node editor via a `design.section` contribution OR, if the quest editor supports field-level contributions, hooks into the `eventName` field specifically
   - When the `targetId` is an NPC with `metadata.sugarlangRole === "placement"`, displays a suggestion above the `eventName` field: "Suggested: `sugarlang.placement.completed` (fires when placement posterior converges)"
   - Clicking the suggestion fills in the field
2. Register the contribution

**Tests Required:**

- Unit test: suggestion appears when target NPC has the placement role
- Unit test: suggestion is absent for non-placement NPCs

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Quest node event hint" section

**Acceptance Criteria:**

- Hint appears for the right NPC types
- Clicking fills the field

### Story 12.6: Register all shell contributions in `ui/shell/contributions.ts`

**Purpose:** The single entry point where all shell contributions are declared and exported for plugin registration.

**Tasks:**

1. Implement `ui/shell/contributions.ts` that exports a `sugarlangShellContributions` array containing every component from this epic as a `DesignSectionContribution` (or whatever the exact contribution kind is for UI panels in the Studio)
2. Wire the contributions into the plugin's `index.ts` registration (update Epic 10 Story 10.6's plugin registration to include shell contributions)

**Tests Required:**

- Integration test: plugin registers with the shell contributions present and the Studio discovers them
- Smoke test: opening the Studio with sugarlang installed surfaces all five contributions in their expected locations

**API Documentation Update:**

- `docs/api/editor-contributions.md`: "Contribution registration" section

**Acceptance Criteria:**

- All contributions are discoverable
- Smoke test passes in the Studio

## Risks and Open Questions

- **Studio design system.** The Studio has its own UI component library; the components implemented here should use it for consistency (buttons, inputs, tooltips, charts). Find it during implementation. Do NOT introduce a new UI library.
- **React vs. other view layer.** Assumes Studio uses React (based on the `.tsx` extension convention). Verify during implementation; if Studio uses Preact, Vue, or something else, the components in this epic need to match.
- **Chart library for the histogram.** If there's an existing chart lib in the Studio (e.g. `recharts`, `visx`), reuse it. If not, a simple CSS flexbox bar chart is fine — don't add a dependency for one histogram.
- **Field-level contributions in the quest node editor.** The existing plugin contribution system may not support field-level hooks on specific form fields. If not, Story 12.5 degrades to a design-section-level panel that shows the suggestion alongside the quest node form. Flag during implementation.
- **Per-NPC placement question overrides.** Listed as a v2 feature in Plan 001. This epic makes the viewer read-only; do NOT build override UI in v1.

## Exit Criteria

Epic 12 is complete when:

1. All six stories are complete
2. All shell contributions render in the Studio
3. Each contribution has unit + integration tests
4. `docs/api/editor-contributions.md` is complete
5. `tsc --noEmit` passes
6. This file's `Status:` is updated to `Complete`
