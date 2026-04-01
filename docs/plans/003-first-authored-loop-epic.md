# Plan 003: First Authored Loop Epic

**Status:** Proposed  
**Date:** 2026-03-31

## Epic

### Title

Prove the first real authored loop in Sugarmagic.

### Goal

Implement the smallest end-to-end authoring slice that proves Sugarmagic is working as one coherent product:

- create or open a canonical game root
- activate a real `Build` `RegionWorkspace`
- load canonical region truth
- perform one real authored `Build` mutation through commands and transactions
- save
- reload
- render the same authored result through the shared runtime

This epic exists to move Sugarmagic from “well-structured shell and scaffolding” into “real authored truth flowing through the actual architecture.”

### Why this epic exists

The foundation work has already proven:

- repo and package boundaries
- thin hosts
- ProductMode shell
- Workspace terminology and state ownership
- initial shell visual direction

What remains unproven is the core product claim:

- the authored region is the runtime region
- the edit view and play view use the same runtime systems
- saving and reloading preserve canonical authored meaning

If we only do project administration next, we risk more shell infrastructure without proving the heart of Sugarmagic.

If we port a large amount of `Build` behavior next without a real project/open/save/reload loop, we risk building against fake session data and accidental side paths.

This epic is the first architecture-proof implementation slice.

### Product and architecture clarification

This epic should prove the following rules concretely:

- Sugarmagic opens a game root, not an isolated floating editor file
- canonical authored truth lives in domain documents
- authored mutation goes through semantic commands and committed transactions
- `Build` is a composition shell over canonical region authoring, not a parallel data owner
- `RegionWorkspace(regionId)` edits the canonical region document, but does not replace it
- save and reload flow through one canonical IO path
- the shared runtime consumes the same authored truth the editor is showing

For runtime-visible proof in this epic, Sugarmagic should use the minimum real runtime viewport path, not a temporary editor-only visualization layer.

That means:

- stand up a real Three.js-backed runtime viewport foundation in the shared runtime path
- render the first authored placed object as a simple cube or other minimal primitive
- update that cube from canonical authored transform data
- treat the cube as a temporary visual representation inside the real runtime path, not as a separate temporary renderer

This epic should not use:

- a 2D schematic stand-in renderer
- an app-local React drawing layer as a fake viewport
- an editor-only object-visualization path that bypasses runtime scene loading

### Platform direction for this epic

Plan 003 should be browser-first.

For this milestone, Sugarmagic should:

- target Chromium-class desktop browsers as the primary supported environment
- use the File System Access API for canonical game-root selection and canonical authored read/write
- use browser-stored handles and permission revalidation for reopening known projects
- use OPFS only for non-canonical caches or disposable derived data if needed

For this milestone, Sugarmagic should not:

- require Tauri
- introduce a native-wrapper dependency just to achieve project open/save flows
- treat OPFS as the canonical home of authored project truth

For the initial project-lifecycle UX, Sugarmagic should preserve the successful Sugarengine entry flow:

- on first open or when no active project is loaded, show a centered project manager dialog
- offer two clear actions:
  - open an existing game project
  - create a new game project
- if the user chooses create, open a second dialog for:
  - game name
  - slug
  - game root directory

This should be treated as the starting UX baseline for Plan 003.

This epic should not introduce:

- demo-only fake persistence
- direct UI mutation of canonical documents
- app-local shadow copies of the region document as truth
- a separate editor render interpretation for authored content
- a second save/load path “just for bootstrap”
- a Tauri-only or native-wrapper-only implementation requirement for the first authored loop

### Scope

In scope:

- new project and open project foundations around canonical game roots
- a Sugarengine-style initial project manager flow for new/open project entry
- browser-first File System Access API support for canonical project open/create/save/reload
- minimal recent/opened project affordances only if needed to support the real loop
- dirty-state tracking for canonical authored changes
- save and reload for the first real authored slice
- `Build` `RegionWorkspace` activation for one region
- loading one canonical `RegionDocument`
- one narrow authored `Build` capability
- command, transaction, and history participation for that capability
- a minimum real runtime viewport path sufficient to render the first authored object as a cube
- shared runtime preview update from the same authored truth
- verification for save/reload/runtime continuity

Out of scope:

- broad settings surfaces
- generalized project-management polish beyond what the real loop needs
- multiple `Build` tools at once
- full asset browser, landscape, materials, atmosphere, or gameplay editing
- large Sugarbuilder capability migration in one pass
- publish flows beyond whatever tiny proof is necessary for runtime continuity
- native-wrapper packaging decisions beyond keeping a future path open
- final viewport controls, gizmos, or polished rendering systems beyond the minimum real runtime proof

### Recommended first authored `Build` capability

The first `Build` capability should be intentionally tiny and high-signal.

Recommended candidates, in order:

1. move one existing placed region object
2. place one simple authored region object
3. toggle or edit one narrow region-authored property with visible runtime effect

The ideal choice is the one that best proves:

- canonical document mutation
- undoable transaction boundary
- save/reload persistence
- runtime-visible result

without pulling in a huge dependency tree.

### Default recommendation

Unless implementation discovers a concrete blocker, the default first `Build` capability for this epic should be:

- move one existing placed region object in `Build > RegionWorkspace(regionId)`

This is the recommended first proof because it exercises:

- real workspace selection
- transform-edit interaction
- semantic authored command execution
- transaction commit
- dirty-state
- save and reload
- shared runtime continuity

while avoiding the extra dependency surface that usually comes with object creation flows such as asset picking, default creation policies, and placement-source selection.

### Interaction-surface clarification

For this first slice, “move one existing placed region object” should not be interpreted as requiring a full click-drag viewport manipulation stack on day one.

The first proof should prefer the narrowest real interaction surface that still preserves the correct architecture:

- real `RegionWorkspace`
- real selected authored object identity
- real authored transform mutation
- real command and transaction path
- real runtime-visible cube update

Recommended first interaction shape:

1. select the existing object through a simple explicit surface
   - acceptable examples:
     - structure list
     - inspector selection
     - single known bootstrap object selection
2. move the object through a minimal explicit transform surface
   - acceptable examples:
     - x/y/z numeric fields
     - nudge buttons
     - one-axis step controls

This epic should explicitly defer:

- viewport drag interaction
- transform gizmos
- raycast picking
- polished editor camera controls

Those are good follow-on capabilities, but they are not required to prove the first authored loop.

### Architectural references

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [README.md](/Users/nikki/projects/sugarmagic/README.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)

### Epic acceptance criteria

- Sugarmagic can create or open a canonical game root through one real project path.
- The first authored loop works in the browser-first supported environment without requiring Tauri.
- Sugarmagic can activate a real `Build` `RegionWorkspace` for one region.
- One real authored `Build` action mutates canonical region truth through commands and transactions.
- The authored change participates in dirty-state and save behavior.
- Reloading the project/region preserves the authored result.
- The shared runtime reflects the same authored result after reload.
- The implementation does not introduce parallel region truth, fake persistence, or a second runtime path.
- The runtime-visible proof uses a real Three.js runtime viewport path, even if the first rendered representation is only a cube.

### Epic definition of done

- All stories below are complete.
- A user can complete the first authored loop from project open/create through save/reload.
- The loop proves canonical truth, single enforcer, and one-way dependency rules in working code.
- The foundation is ready for follow-on `Build` capability work without needing to replace the core project/save/workspace architecture.

## Story 1

### Title

Establish the real project and game-root lifecycle.

### Objective

Create the minimal real project lifecycle needed to open and create canonical game roots without inventing a second project model.

### References

- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)

### Tasks

1. Define the minimal real project lifecycle flow for:
   - new project
   - open project
   - active project root
2. Preserve the Sugarengine-style entry UX as the initial flow:
   - a centered project manager dialog for first entry
   - one action for opening an existing game
   - one action for creating a new game
3. Implement the second-step new-game dialog with fields for:
   - game name
   - slug
   - game root directory
4. Route project lifecycle through canonical game-root discovery and IO contracts.
5. Implement this flow browser-first with the File System Access API.
6. Persist and revalidate project handles in a way that supports reopening known projects in the browser.
7. Avoid introducing a separate “editor project” abstraction that competes with the game root.
8. Make the active game root available to shell/workspace orchestration.
9. Keep any recent-project or landing-screen affordances minimal and in service of the real flow.

### Acceptance criteria

- Sugarmagic opens a game root directly.
- The initial entry flow clearly supports both opening an existing game and creating a new one.
- The new-game flow captures game name, slug, and game root directory explicitly.
- The project lifecycle works in the browser-first supported environment using the File System Access API.
- New/open project flows target the canonical project boundary.
- The shell can identify one active project/game root.
- No alternate project ownership model is introduced.

### Definition of done

- Project lifecycle exists as a real architectural path rather than a demo stub.
- The initial project entry UX is concrete enough to use, not just implied by backend wiring.
- The project lifecycle does not depend on Tauri or a native wrapper for this milestone.
- Follow-on work can rely on one canonical active project root.

## Story 2

### Title

Load the initial canonical project and region documents.

### Objective

Make the app able to resolve one real `GameProject` and one real `RegionDocument` from the active game root.

### References

- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)

### Tasks

1. Load the canonical `GameProject` from the active game root.
2. Resolve one canonical `RegionDocument` suitable for the first authored slice.
3. Keep loaded canonical truth outside shell stores.
4. Expose loaded project/region state to orchestration through explicit contracts.
5. Ensure the initial load path is compatible with later multi-region/project navigation.

### Acceptance criteria

- One real `GameProject` can be loaded.
- One real `RegionDocument` can be loaded.
- Loaded canonical truth is not stored as the shell source of truth.
- The load path is visibly using domain and IO boundaries.

### Definition of done

- Sugarmagic can enter the first authored slice with a real loaded project and region.
- The canonical load path is clear enough to reuse for later project growth.

## Story 3

### Title

Activate a real `Build` `RegionWorkspace`.

### Objective

Turn the current shell scaffold into a real workspace activation path for one region inside `Build`.

### References

- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)

### Tasks

1. Define the activation path for `Build > RegionWorkspace(regionId)`.
2. Bind workspace identity to the loaded region subject, not to bootstrap placeholder ids.
3. Scope workspace camera, selection, and editor context to the active region workspace.
4. Ensure shell presentation clearly distinguishes ProductMode from active workspace.
5. Keep workspace state as coordination/session state, not canonical region truth.

### Acceptance criteria

- `Build` can host a real `RegionWorkspace(regionId)`.
- Workspace identity reflects a real region subject.
- Workspace-scoped state is distinct from canonical region state.
- ProductMode and Workspace are meaningfully distinguished in behavior and UI.

### Definition of done

- Sugarmagic can open a real region editing surface inside `Build`.
- Future `Build` workspace capabilities can land without redefining workspace ownership.

## Story 4

### Title

Implement one narrow authored `Build` capability.

### Objective

Choose and implement the smallest real authored `Build` interaction that proves region mutation works through the intended architecture.

### References

- [Proposal 004: Build-First Implementation Bias](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)

### Tasks

1. Select one intentionally tiny `Build` capability for the first proof slice.
   - default recommendation: move one existing placed region object
2. Implement the user interaction path for that capability inside the active `RegionWorkspace`.
3. Ensure the capability has a runtime-visible effect or clearly authored persisted effect.
4. For this first slice, prefer a minimal explicit interaction surface for selection and movement rather than requiring viewport drag manipulation.
5. Route the slice through selection, transform edit intent, and canonical authored mutation.
6. Keep the slice narrow enough to avoid dragging in unrelated `Build` systems such as gizmos, raycast picking, or polished viewport controls unless a concrete need appears.
7. State explicitly what broader Sugarbuilder capability this first slice is proving toward.

### Acceptance criteria

- One real authored `Build` action exists.
- The action is small but meaningful.
- The action is narrow enough to avoid forcing broad object-creation infrastructure unless truly necessary.
- The action does not secretly expand into full viewport-manipulation tooling just to satisfy the first proof.
- The action proves the intended architectural path rather than a UI-only illusion.
- The implementation does not sprawl into multiple half-finished `Build` systems.

### Definition of done

- The first `Build` capability works end to end in the active region workspace.
- The chosen slice proves a credible first step toward broader region object authoring in `Build`.
- The code establishes a credible path for incremental `Build` migration.

## Story 5

### Title

Route authored mutation through commands, transactions, and history.

### Objective

Prove that the first real authored change uses the canonical mutation boundary instead of direct state editing.

### References

- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)

### Tasks

1. Define the semantic command for the chosen first `Build` capability.
2. Route the interaction through command execution and committed transaction handling.
3. Ensure the mutation lands in canonical region truth rather than a workspace-local copy.
4. Ensure the command can be driven by a minimal explicit transform-edit surface without needing polished viewport drag tooling.
5. Record dirty-state based on canonical authored mutation.
6. Add the minimal undo/redo/history participation needed for this first slice.

### Acceptance criteria

- The first authored change goes through commands and transactions.
- Canonical truth is updated through the documented mutation boundary.
- Dirty-state reflects authored mutation rather than raw UI activity.
- The mutation path is real even if the initial interaction surface is deliberately simple.
- Undo/redo participation is aligned with committed authoring changes.

### Definition of done

- The first authored mutation path proves the command/transaction architecture in real code.
- Follow-on authored tools can reuse the same mutation boundary.

## Story 6

### Title

Implement save, reload, and dirty-state for the first authored slice.

### Objective

Make the first authored loop durable so the result survives save and reload through one canonical path.

### References

- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Implement save for the active authored change through canonical IO contracts.
2. Track dirty-state against canonical document changes and successful saves.
3. Implement reload or reopen behavior for the active project/region.
4. Ensure canonical save/reload uses File System Access API handles rather than an alternate bootstrap-only transport.
5. Verify the first authored change survives save and reload.
6. Avoid separate bootstrap-only serialization formats or save paths.

### Acceptance criteria

- The first authored slice can be saved through one canonical path.
- Dirty-state becomes clean after a successful save.
- Reloading preserves the authored result.
- Canonical save/reload works in the browser-first supported environment.
- No second persistence path is introduced.

### Definition of done

- The first authored slice is durable across save and reload.
- The save/load path is credible as the long-term authored persistence path.

## Story 7

### Title

Prove shared-runtime continuity for the first authored change.

### Objective

Demonstrate that the authored result is being consumed by the shared runtime rather than by a separate editor-only interpretation.

### References

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Ensure the first authored change is visible through the shared runtime-backed viewport path.
2. Stand up the minimum real Three.js runtime viewport foundation needed for this proof.
3. Render the first authored placed object as a cube or equally minimal runtime primitive.
4. Verify the runtime is consuming canonical authored truth, not a separate editor projection.
5. If playtest is used for proof, keep it isolated by the existing runtime-session rules.
6. Ensure reload plus runtime re-entry still reflect the same authored result.
7. Avoid editor-only fake render behavior or 2D schematic fallback for the chosen slice.

### Acceptance criteria

- The authored result is visible through the shared runtime path.
- The proof uses a real Three.js runtime viewport path, even if the rendered content is only a minimal cube.
- The proof does not rely on editor-only rendering semantics.
- Reloaded authored truth still produces the same runtime-visible result.
- Runtime/session boundaries remain intact.

### Definition of done

- The first authored slice proves “authored truth is runtime truth” in working code.
- The first visible runtime proof is pointed at the final viewport architecture rather than a temporary fake renderer.
- The shared-runtime rule is stronger after this story, not weaker.

## Story 8

### Title

Verify the first authored loop end to end.

### Objective

Make the milestone reviewable and repeatable so the team can confirm the architecture claim in a concrete workflow.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [Plan 001: Bootstrap Project Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/001-bootstrap-project-foundation-epic.md)
- [Plan 002: Shell Visual Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/002-shell-visual-foundation-epic.md)

### Tasks

1. Add automated checks for the first authored loop where practical.
2. Add a small integration test or harness that proves load, mutate, save, and reload for the chosen slice.
3. Add a short manual QA walk-through for:
   - create/open project
   - enter `Build`
   - open region workspace
   - perform first authored action
   - save
   - reload
   - confirm runtime-visible continuity
4. Document any architectural clarifications discovered during implementation.
5. State explicitly what this epic proves and what it does not yet prove.

### Acceptance criteria

- The first authored loop has explicit QA expectations.
- At least part of the loop is covered by automated verification.
- The remaining manual walk-through is short, concrete, and high-signal.
- Reviewers can tell exactly what architectural claims are now proven.

### Definition of done

- The first authored loop is testable, reviewable, and repeatable.
- The team has a clear baseline for the next `Build` capability slice.
