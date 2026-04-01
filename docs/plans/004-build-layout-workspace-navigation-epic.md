# Plan 004: Build Layout Workspace Navigation Epic

**Status:** Proposed  
**Date:** 2026-04-01

## Epic

### Title

Establish Build workspace navigation and port the first real `Layout` capability, including Scene Explorer and a basic gizmo.

### Goal

Turn `Build` from a single-region proof surface into a real multi-workspace authoring lane by:

- keeping `Build` as the top-level `ProductMode`
- introducing a Build-specific secondary navigation model
- treating `Layout`, `Environment`, `Assets`, and similar concepts as Build workspace kinds, not top-level ProductModes
- keeping region selection separate from workspace-kind selection
- making the active `Build` workspace the intersection of:
  - `ProductMode = Build`
  - `Build Workspace Kind`
  - `regionId`
- porting the first meaningful Sugarbuilder-derived `Layout` workflow into that structure

This epic exists to prove that Sugarmagic can absorb Sugarbuilder’s world-authoring workflows without collapsing back into overloaded screens, mixed state ownership, or ad hoc navigation rules.

### Why this epic exists

Plan 003 proves the first authored loop in one narrow `Build > RegionWorkspace(regionId)` path.

That is necessary, but it is not yet enough to support real Sugarbuilder migration. The next problem to solve is structural:

- `Build` needs internal navigation for different world-authoring surfaces
- region selection must remain explicit and stable
- the left panel must be free to become truly workspace-specific
- `Layout` needs a real home that does not blur ProductMode, subject selection, and structure browsing

If we choose the wrong navigation model here, Sugarmagic risks:

- making the left panel do double duty as both explorer and router
- blurring region identity with Build-tool identity
- reintroducing mode bleed through unclear workspace ownership
- building Sugarbuilder capabilities into the wrong permanent shell shape

This epic establishes the permanent Build navigation model before deeper Build migration accelerates.

### Product and architecture clarification

This epic should make the following structure explicit:

- `Build` remains the top-level `ProductMode`
- `Layout`, `Environment`, `Assets`, and future peers are Build workspace kinds or workspace families
- region selection is subject selection, not ProductMode selection
- the left panel belongs to the active Build workspace and should be allowed to change meaning based on that workspace
- the active Build workspace is derived from both:
  - the selected region
  - the selected Build workspace kind

The working mental model should be:

- `ProductMode` answers: what broad category of work is active?
- Build workspace navigation answers: what kind of world-authoring surface is active inside `Build`?
- region selection answers: which authored subject is currently being edited?
- the resulting workspace answers: what exact editing surface is open?

Examples:

- `Build > Layout > forest_north` becomes `LayoutWorkspace(regionId=forest_north)`
- `Build > Environment > forest_north` becomes `EnvironmentWorkspace(regionId=forest_north)`
- `Build > Assets > forest_north` becomes `AssetPlacementWorkspace(regionId=forest_north)`

This epic should not:

- turn `Layout` into a top-level ProductMode
- make the region tree responsible for both routing and structure browsing
- nest Build workspace kinds under each region in the left panel as the primary navigation model
- let the Build sub-nav become a second source of canonical authored truth
- introduce parallel region-state ownership for individual Build workspaces

### Navigation decision for this epic

The default navigation model for this epic should be:

1. top-level ProductMode bar remains:
   - `Design`
   - `Build`
   - `Render`
2. when `Build` is active, show a Build-specific secondary nav
3. the Build-specific secondary nav should include:
   - a region selector
   - Build workspace-kind selectors such as `Layout`, `Environment`, `Assets`
4. the left panel should render workspace-specific content for the active Build workspace
5. the main workspace and inspector should reflect the active Build workspace and active region together

This means the active Build workspace is explicitly the intersection of:

- `Build`
- one Build workspace kind
- one region

This is the default direction for implementation unless a later architecture decision explicitly replaces it.

### `Layout` clarification for this epic

For this epic, `Layout` should be treated as the first Build workspace kind to port from Sugarbuilder.

In Sugarmagic terms, `Layout` should mean:

- the Build workspace focused on authored scene structure and placed region content
- the home for a scene-explorer-style left panel
- the home for placed-object selection and structure browsing
- the first permanent landing zone for Sugarbuilder’s strongest region-layout workflow patterns

For this epic, `SceneExplorer` should mean:

- a reusable UI component rendered inside the left panel
- a tree of scene elements and folders
- a shared selection/focus surface for the active Layout workspace
- the beginning of scene-management UI for working with authored region content

`Layout` should not become:

- a second owner of region truth
- a special-case screen that bypasses the normal Build workspace model
- a justification for a separate editor render path

### Basic gizmo, object origin, and world cursor clarification

For this epic, Sugarmagic should introduce a deliberately narrow Blender-inspired transform layer inside `LayoutWorkspace(regionId)`.

This first pass should include:

- a visible move gizmo for the primary selected placed object
- a visible object origin marker for the selected placed object
- a visible world cursor in the viewport
- drag-preview behavior for gizmo interaction
- commit-on-release behavior through the canonical command/transaction path
- cancel/revert behavior for the active gizmo drag session

This first pass should not attempt full Blender parity.

In particular, this epic should explicitly defer:

- rotate and scale gizmos
- multi-selection gizmo behavior
- pivot-mode switching
- world/local orientation switching
- snapping systems beyond what is strictly necessary for the first slice
- interactive world-cursor repositioning
- using the world cursor as a placement or transform target
- full Blender hotkey parity

Ownership rules for this first pass should be explicit:

- authored placed-object transforms remain canonical region truth
- gizmo visuals are editor/tool overlays, not authored scene truth
- object-origin visuals are editor/tool overlays derived from authored transform data
- the world cursor is workspace/editor state in this first slice, not canonical authored truth
- preview movement during a gizmo drag is transient tool-session state
- committed movement must still flow through semantic commands and transactions

Viewport composition rules for this first pass should also be explicit:

- Sugarmagic should keep one real Three.js runtime-backed viewport path
- authored content and editor overlays should coexist in that same real viewport
- the viewport scene should have an explicit authored-content root and an explicit editor-overlay root
- gizmo meshes, object-origin markers, and the world cursor should live under the editor-overlay root
- editor-overlay nodes must never be treated as canonical scene content
- editor-overlay nodes must never participate in canonical scene loading, save/reload serialization, or authored scene descriptors
- this epic should not require a second renderer path or a separate render pass unless a concrete rendering problem later makes that necessary

### Scope

In scope:

- Build secondary navigation design and implementation
- region selection inside Build
- explicit Build workspace identity and activation rules
- `LayoutWorkspace(regionId)` as the first real Build sub-workspace
- workspace-specific left-panel behavior for `Layout`
- Sugarbuilder-inspired `Scene Explorer` behavior for `Layout`
- workspace-specific inspector and viewport composition rules for `Layout`
- a basic viewport gizmo for the first selected placed object in `Layout`
- shell/store/session updates needed to represent Build workspace kind separately from ProductMode
- migration-oriented planning for `Environment` and `Assets` as follow-on Build workspaces
- one first meaningful Sugarbuilder-derived `Layout` capability in its permanent home

Out of scope:

- full migration of every Sugarbuilder Build capability
- advanced gizmo behavior beyond the first basic transform path
- rotate and scale gizmos unless deliberately included later
- snap systems beyond the minimum needed for the first basic gizmo
- full asset browser migration even if Sugarbuilder kept assets visible beneath Scene Explorer
- drag-and-drop reparenting, renaming, duplication, and context-menu parity in the first Layout pass
- final `Environment` and `Assets` functionality beyond scaffolding and activation
- turning the region explorer into a universal router
- changing top-level ProductModes
- published-target UI work

### Initial capability recommendation

The first real `Layout` capability port in this epic should stay narrow.

Recommended direction:

1. establish `LayoutWorkspace(regionId)` with a real `SceneExplorer` in the left panel
2. preserve the canonical region/placed-asset ownership model already proven in Plan 003
3. make the `SceneExplorer` a real tree with folders from the beginning
4. make the selected placed object addressable from both the `SceneExplorer` and the viewport
5. implement one basic viewport gizmo path for that selected object
6. keep the first gizmo intentionally narrow:
   - move only
   - one selected placed object
   - visible object origin marker
   - visible world cursor
   - canonical command/transaction commit
   - runtime-visible result through the real viewport

The important thing is not feature breadth. The important thing is that `Layout` becomes real as a Build workspace with correct ownership and navigation.

### Sugarbuilder reference behavior for this epic

This epic should explicitly draw from Sugarbuilder’s `Layout` patterns where they are strong and compatible with Sugarmagic’s architecture.

Relevant references:

- [Sugarbuilder Proposal 001: Blender Layout Pivot](/Users/nikki/projects/sugarbuilder/docs/proposals/001-blender-layout-pivot.md)
- [Sugarbuilder ADR 019: Scene Explorer Panel](/Users/nikki/projects/sugarbuilder/docs/adr/019-scene-explorer-panel.md)
- [Sugarbuilder ADR 056: Layout Interaction Architecture](/Users/nikki/projects/sugarbuilder/docs/adr/056-layout-interaction-architecture.md)
- [Sugarbuilder `SceneExplorer.tsx`](/Users/nikki/projects/sugarbuilder/src/editor/components/SceneExplorer.tsx)

For this epic, Sugarmagic should inherit these ideas from Sugarbuilder:

- `Layout` has a `SceneExplorer` dedicated to scene content
- the scene explorer is a structure-and-selection surface, not the primary top-level router
- the viewport remains central
- selection in the layout structure surface and selection in the viewport refer to the same authored subject
- transform manipulation should live behind an explicit interaction architecture rather than ad hoc viewport mutation

This epic should not attempt full Sugarbuilder parity in one pass. In particular, the first Layout slice should not try to match:

- full folder-management parity
- drag-and-drop reordering and reparenting parity
- context menus and rename/duplicate/delete parity
- full asset browser parity
- snapping parity
- advanced gizmo modes

### Architectural references

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [README.md](/Users/nikki/projects/sugarmagic/README.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Sugarbuilder Proposal 001: Blender Layout Pivot](/Users/nikki/projects/sugarbuilder/docs/proposals/001-blender-layout-pivot.md)
- [Sugarbuilder ADR 019: Scene Explorer Panel](/Users/nikki/projects/sugarbuilder/docs/adr/019-scene-explorer-panel.md)
- [Sugarbuilder ADR 056: Layout Interaction Architecture](/Users/nikki/projects/sugarbuilder/docs/adr/056-layout-interaction-architecture.md)
- [Sugarbuilder `SceneExplorer.tsx`](/Users/nikki/projects/sugarbuilder/src/editor/components/SceneExplorer.tsx)

### Epic acceptance criteria

- `Build` remains a top-level `ProductMode`, and Build sub-work remains below it rather than competing with it.
- Sugarmagic exposes a Build-specific secondary navigation model that includes both region selection and Build workspace-kind selection.
- Region selection and Build workspace-kind selection are clearly separated in behavior and UI.
- `LayoutWorkspace(regionId)` is a real Build workspace with explicit identity and activation rules.
- The left panel is free to become Layout-specific without being overloaded as the main router for Build.
- `Layout` includes a real `SceneExplorer` informed by Sugarbuilder’s proven layout workflow.
- The first `SceneExplorer` is a real tree with folders from the start, not a flat structure list with new labeling.
- The main workspace composition reflects the intersection of:
  - active ProductMode
  - active Build workspace kind
  - active region
- The first meaningful `Layout` capability lives in the permanent Build workspace model rather than in a temporary screen.
- The first basic viewport gizmo works inside the real runtime-backed Layout viewport and commits canonical mutation through the normal command path.
- The first basic Layout viewport pass includes a visible selected-object origin marker and a visible world cursor.
- The implementation preserves one source of truth, one command/transaction boundary, and one runtime path.

### Epic definition of done

- All stories below are complete.
- A user can enter `Build`, choose a region, choose `Layout`, and land in a real `LayoutWorkspace(regionId)`.
- The shell, state model, and UI clearly distinguish ProductMode, Build workspace kind, and region subject.
- The left panel, inspector, and workspace composition are ready for broader Build migration without reworking the navigation model.
- The first Sugarbuilder-derived `Layout` capability and its first basic gizmo both land in clear permanent homes.

## Story 1

### Title

Lock the Build navigation and workspace model.

### Objective

Turn the Build navigation decision into an explicit implementation contract so follow-on Build work does not invent competing models.

### References

- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Define Build workspace-kind terminology and naming.
2. Define the activation rule for `Build + Workspace Kind + Region = Active Workspace`.
3. Define where Build workspace-kind state lives and how it differs from region selection.
4. Define how Build navigation should appear in the shell.
5. Define explicit anti-models the implementation must avoid.
6. Update any architecture notes needed so the decision is discoverable.

### Acceptance criteria

- The team has one explicit Build navigation model.
- Build workspace-kind selection is distinguished from region selection.
- The active workspace identity model is unambiguous.
- Anti-patterns are explicit enough to block drift.

### Definition of done

- The Build navigation model is documented clearly enough to implement without reinterpretation.

## Story 2

### Title

Represent Build workspace-kind and region selection in the shell state model.

### Objective

Add the state-model support needed to express Build navigation cleanly without blurring shell coordination and canonical region truth.

### References

- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 004: Workspace composition and state ownership](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Package ownership](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Add explicit Build workspace-kind state for shell coordination.
2. Keep active region identity distinct from Build workspace-kind state.
3. Define active workspace-id construction rules.
4. Ensure camera, selection, and tool-session scoping continue to align to workspace identity.
5. Avoid moving canonical region truth into shell stores.
6. Add tests for workspace identity derivation and state transitions.

### Acceptance criteria

- Shell coordination can represent Build sub-work without inventing a second ProductMode layer.
- Active region and active Build workspace kind are independent but composable.
- Workspace identity is deterministic and testable.
- No new canonical authored truth is introduced into shell state.

### Definition of done

- The state model can support Build navigation and workspace activation cleanly.

## Story 3

### Title

Implement the Build secondary navigation surface.

### Objective

Add the shell UI that lets the user choose a region and a Build workspace kind without overloading the left panel.

### References

- [Plan 002: Shell Visual Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/002-shell-visual-foundation-epic.md)
- [Proposal 004: ProductMode Navigation Model](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [API 002: `/packages/ui` and shell composition](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Design and implement a Build-only secondary nav surface.
2. Add a region selector to that surface.
3. Add workspace-kind selectors such as `Layout`, `Environment`, and `Assets`.
4. Make the secondary nav appear only when `Build` is active.
5. Ensure the top ProductMode bar remains the only top-level mode selector.
6. Keep the implementation in shared UI/shell homes where the concept is reusable.

### Acceptance criteria

- Users can clearly see both the active region and the active Build workspace kind.
- The Build sub-nav is visually subordinate to the top ProductMode nav but still first-class.
- The Build sub-nav does not pretend to be a second top-level mode system.
- Region selection is not forced into the left panel just to make the UI work.

### Definition of done

- Sugarmagic has a real Build secondary nav aligned to the architecture.

## Story 4

### Title

Activate real Build workspaces from the Build navigation model.

### Objective

Make Build workspace activation explicit so the shell, viewport, inspector, and left panel all respond to one coherent active workspace identity.

### References

- [Plan 003: First Authored Loop Epic](/Users/nikki/projects/sugarmagic/docs/plans/003-first-authored-loop-epic.md)
- [Proposal 004: Workspace Definition](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [API 003: Workspace lifetime and scoping](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)

### Tasks

1. Implement activation for `LayoutWorkspace(regionId)`.
2. Scaffold activation paths for `EnvironmentWorkspace(regionId)` and `AssetPlacementWorkspace(regionId)`.
3. Ensure switching Build workspace kind updates workspace-scoped state appropriately.
4. Preserve region identity across Build workspace changes unless the user explicitly changes region.
5. Prevent stale workspace-specific tool state from bleeding between Build workspaces.
6. Add tests for workspace activation and switching behavior.

### Acceptance criteria

- `LayoutWorkspace(regionId)` is a real activatable workspace.
- Build workspace switching is explicit and stable.
- Region changes and workspace-kind changes behave as separate user actions.
- Workspace-scoped state follows workspace identity rather than leaking across sub-workspaces.

### Definition of done

- Build workspace activation is real and predictable.

## Story 5

### Title

Make the left panel a real `SceneExplorer` for `Layout`.

### Objective

Turn the left panel into a real `SceneExplorer` for Layout rather than a generic catch-all structure column.

### References

- [Proposal 004: Build internal navigation examples](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 003: Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Plan 003: Region workspace and authored loop](/Users/nikki/projects/sugarmagic/docs/plans/003-first-authored-loop-epic.md)

### Tasks

1. Define the initial Layout left-panel responsibilities.
2. Reference Sugarbuilder’s Scene Explorer behavior and extract the minimum durable behaviors to keep.
3. Implement `SceneExplorer` as a real tree with folders from the beginning.
4. Keep folder and tree structure derived from canonical region/workspace structure rather than from a parallel UI-only model.
5. Keep the left panel focused on Layout concerns, not global Build routing.
6. Ensure selection from `SceneExplorer` routes into the existing workspace/session model.
7. Keep the data source canonical and derived from the active region, not a parallel explorer model.
8. Add tests for tree rendering, folder behavior, and selection behavior.

### Acceptance criteria

- The left panel has a clear `Layout` job.
- The panel no longer needs to serve as the primary router for Build sub-work.
- `SceneExplorer` is a real tree with folders rather than a flat list.
- Scene structure shown in `SceneExplorer` is derived from canonical region truth.
- The initial `SceneExplorer` behavior is recognizably informed by Sugarbuilder where that behavior is still architecturally sound.
- Layout selection participates in the normal workspace/session flow.

### Definition of done

- Sugarmagic has the first real `SceneExplorer` home for `Layout`.

## Story 6

### Title

Implement the first basic viewport gizmo for `LayoutWorkspace(regionId)`.

### Objective

Add the first real viewport manipulation surface for Layout without jumping prematurely to full editor tooling parity.

### References

- [Plan 003: First Authored Loop Epic](/Users/nikki/projects/sugarmagic/docs/plans/003-first-authored-loop-epic.md)
- [Sugarbuilder ADR 056: Layout Interaction Architecture](/Users/nikki/projects/sugarbuilder/docs/adr/056-layout-interaction-architecture.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 005: Runtime/editor consolidation](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Define the first gizmo as intentionally narrow:
   - move only
   - one selected placed object
   - no rotate/scale yet
2. Add a visible object-origin marker for the active selected placed object.
3. Add a visible world cursor to the Layout viewport.
4. Ensure gizmo visibility is driven by the active Layout selection.
5. Route gizmo interaction through the intended interaction/session boundary rather than ad hoc scene mutation.
6. Preview movement in the real runtime-backed viewport.
7. Commit the resulting transform change through the canonical command/transaction path.
8. Support cancel/revert for the active gizmo drag session.
9. Keep the first gizmo compatible with save/reload and runtime-visible continuity.
10. Implement the viewport overlay structure explicitly:
   - authored-content root
   - editor-overlay root
11. Ensure gizmo, origin marker, and world cursor live only in the editor-overlay root.
12. Ensure overlay nodes are excluded from canonical scene loading and persistence behavior.
13. Add tests and a manual verification pass for selection, origin visibility, world-cursor visibility, gizmo appearance, move, cancel, save, and reload.

### Acceptance criteria

- Sugarmagic has one real basic viewport gizmo inside `LayoutWorkspace(regionId)`.
- The gizmo uses the real runtime-backed viewport rather than an editor-only overlay path for authored content.
- Committed movement still uses canonical region truth and the normal command/transaction boundary.
- The selected object shows a visible origin marker.
- The viewport shows a visible world cursor.
- Gizmo drags preview movement and commit on release.
- Canceling the active gizmo drag reverts preview state without mutating canonical truth.
- The viewport implementation has an explicit authored-content root and editor-overlay root.
- Gizmo, origin marker, and world cursor are kept out of canonical scene loading and persistence paths.
- The implementation stays narrow and does not sprawl into multiple gizmo/tool systems.

### Definition of done

- Sugarmagic can select one placed object in `Layout`, see its origin marker, see the world cursor, and move it with a basic viewport gizmo.

## Story 7

### Title

Re-home the first Layout capability inside `LayoutWorkspace(regionId)`.

### Objective

Take the first narrow Layout capability set and make it fully belong to `LayoutWorkspace(regionId)` rather than to generic Build scaffolding.

### References

- [Plan 003: First Authored Loop Epic](/Users/nikki/projects/sugarmagic/docs/plans/003-first-authored-loop-epic.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 005: Runtime/editor consolidation](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Re-home the current Layout interaction surfaces so they are clearly part of `LayoutWorkspace(regionId)`.
2. Ensure the Scene Explorer, inspector, and basic gizmo read as one coherent Layout workspace.
3. Keep command, transaction, save/reload, and runtime-visible behavior exactly on the existing canonical path.
4. Make viewport and inspector behavior read as Layout behavior rather than generic Build scaffolding.
5. Avoid pulling in unrelated Sugarbuilder systems during this first Layout port.
6. Add verification that the Layout slice still works end to end after the re-home.

### Acceptance criteria

- The first Layout capability set lives in a credible permanent home.
- The capability set continues to use canonical region truth and the shared runtime path.
- Layout behavior is legible as a workspace-specific authoring surface.
- The implementation does not sprawl into multiple half-finished Layout tools.

### Definition of done

- Sugarmagic can perform one real Layout capability set inside `LayoutWorkspace(regionId)`.

## Story 8

### Title

Scaffold follow-on Build workspaces without prematurely implementing them.

### Objective

Prepare `Environment` and `Assets` to land cleanly later without letting this epic balloon into a full Build migration.

### References

- [Proposal 004: Build should include work such as](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Package ownership](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)

### Tasks

1. Define placeholder activation and labels for `EnvironmentWorkspace(regionId)` and `AssetPlacementWorkspace(regionId)`.
2. Ensure the shell and sub-nav can host them without structural rework.
3. Keep their implementations intentionally skeletal.
4. Document what each follow-on workspace is expected to own.
5. Avoid fake functionality that implies completed migration.

### Acceptance criteria

- Follow-on Build workspaces have clear homes.
- Layout is not treated as a one-off special case.
- The shell can grow Build capabilities without another navigation reset.
- Placeholder implementations do not misrepresent feature completeness.

### Definition of done

- The Build model is ready for incremental migration after Layout.

## Story 9

### Title

Verify Build navigation, workspace identity, Layout behavior, and basic gizmo behavior.

### Objective

Make the new Build model verifiable so it does not drift as more Sugarbuilder capabilities are ported.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [Plan 001: Bootstrap verification bias](/Users/nikki/projects/sugarmagic/docs/plans/001-bootstrap-project-foundation-epic.md)
- [Plan 003: First authored loop verification](/Users/nikki/projects/sugarmagic/docs/plans/003-first-authored-loop-epic.md)
- [Sugarbuilder ADR 056: Layout Interaction Architecture](/Users/nikki/projects/sugarbuilder/docs/adr/056-layout-interaction-architecture.md)

### Tasks

1. Add automated tests for Build workspace identity derivation.
2. Add automated tests for Build secondary-nav switching behavior.
3. Add automated tests for region changes versus workspace-kind changes.
4. Add automated tests for Layout left-panel selection behavior.
5. Add automated tests for basic gizmo visibility and committed transform changes.
6. Add automated tests for selected-object origin visibility and world-cursor visibility.
7. Add a short manual QA smoke pass for:
   - selecting `Build`
   - choosing a region
   - switching between `Layout`, `Environment`, and `Assets`
   - confirming the left panel changes meaning appropriately
   - selecting an object from the Scene Explorer
   - confirming the selected-object origin is visible
   - confirming the world cursor is visible
   - moving it with the basic gizmo
   - canceling a gizmo drag
   - saving and reloading
8. Verify no new duplicate truth or alternate render path was introduced.

### Acceptance criteria

- The Build navigation model is backed by tests rather than memory.
- Manual QA can validate the new shell behavior quickly.
- The first Layout workspace slice and first basic gizmo are verifiably aligned with the intended architecture.

### Definition of done

- The team can keep migrating Build capabilities without re-arguing the navigation model every story.
