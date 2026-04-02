# Plan 005: Preview Launch and Runtime Session Epic

**Status:** Proposed  
**Date:** 2026-04-01

## Epic

### Title

Complete the shell preview affordance and launch a real runtime preview session in a dedicated browser window.

### Goal

Turn Sugarmagic's current authoring-only shell into a real authoring-and-preview product by:

- completing the global shell action stripe in the upper-right shell area
- adding a first-class `Preview` action there
- launching preview in a dedicated browser window from the current committed authored state
- running preview as a real isolated runtime session
- booting the first minimal gameplay foundation needed for the preview to be meaningfully playable
- using runtime camera and runtime UI behavior instead of authoring camera behavior
- stopping preview and returning the user to the exact authored context they left

This epic exists to prove one of Sugarmagic's core product promises:

- the user can author in Sugarmagic and preview the running game through the same shared runtime family
- without an export/import loop
- without a second runtime semantics stack
- without corrupting authored truth

For this first slice, “running the game” should mean more than a camera swap.

The first preview slice should boot a minimal ECS-backed gameplay foundation derived from Sugarengine’s runtime architecture:

- a `World`
- ordered `System` execution
- a spawned player entity
- runtime input mapped into player movement
- runtime camera follow behavior

It does **not** need full gameplay parity yet.

### Why this epic exists

Plan 003 proved the first authored save/reload loop.

Plan 004 is establishing real Build workspace structure and the first real `Layout` capability.

What is still unproven is the higher-order product loop that justifies Sugarmagic as a unified host:

- author in the studio shell
- hit `Preview`
- run the game as the game
- stop
- return to the exact authoring context

This is the loop that felt strong in Sugarengine from a user perspective.

If Sugarmagic delays this proof too long, it risks:

- drifting deeper into editor-only ergonomics without proving runtime-session architecture
- leaving the product identity ambiguous
- recreating the old emotional cost of "I still need to jump into a different surface to know if the game is real"
- weakening trust that the unified architecture is actually worth the migration

### Sugarengine behavior to preserve at the product level

This epic should preserve the good parts of how preview felt in Sugarengine:

- the user clicks `Preview` from a global action surface near the upper-right shell area
- preview launches in a dedicated browser window
- the experience feels like the game is now running
- preview uses runtime camera behavior rather than editor camera behavior
- preview owns runtime input, runtime HUD, and runtime simulation
- stopping preview feels clean and predictable

Relevant references:

- [Sugarengine `Editor.tsx` preview flow](/Users/nikki/projects/sugarengine/src/editor/Editor.tsx)
- [Sugarengine `PreviewManager.ts`](/Users/nikki/projects/sugarengine/src/editor/PreviewManager.ts)
- [Sugarengine ADR 007: local development preview flow](/Users/nikki/projects/sugarengine/docs/adr/007-episodic-content-system.md)
- [Sugarengine ADR 009: toolbar / preview affordance direction](/Users/nikki/projects/sugarengine/docs/adr/009-project-manager-dialog.md)

This epic should **not** copy Sugarengine's architecture literally.

In particular, Sugarmagic should not inherit:

- preview managers that become alternate orchestration stacks
- implicit live mutation of authoring state during preview
- preview boot that depends on a second authored truth model
- preview-window communication patterns that become the canonical owner of runtime semantics

Sugarmagic **should** preserve the dedicated browser-window preview UX as the default preview surface for this epic.

What should change is the architecture behind that UX:

- the preview window should be a thin runtime-session host
- preview boot should derive from committed authored truth in Sugarmagic
- the runtime-session boundary should remain explicit and isolated
- window messaging, if used, should carry boot/update signals rather than become a second domain model
- the first gameplay foundation should be ported intentionally from Sugarengine’s ECS model rather than improvised as one-off preview code

### Product and architecture clarification

For Sugarmagic, `Preview` should be treated as:

- a global shell action
- that starts an isolated `Runtime Session`
- from current committed authored state
- while preserving the active `ProductMode` and workspace context for restoration

`Preview` should **not** be treated as:

- a fourth `ProductMode`
- a Build workspace kind
- a shell-local fake simulation surface
- a second runtime implementation
- a hidden export/publish path

The intended mental model should be:

- `ProductMode` answers what kind of authoring work the user is doing
- `Preview` answers whether the user is currently running the game from authored state

So the user can be conceptually in:

- `Build > Layout > arrival_station`

and then press `Preview`, which means:

- snapshot `Build > Layout > arrival_station`
- start isolated runtime session from current committed authored state
- open the dedicated preview browser window
- boot the minimal ECS-backed gameplay foundation
- run preview using runtime camera and runtime input
- stop
- restore `Build > Layout > arrival_station`

### Core transition rule for this epic

This epic should implement the existing playtest/runtime-session decisions concretely.

When the user presses `Preview`:

1. if a transient tool session is active, require it to resolve first
2. snapshot current authoring context
3. derive preview boot input from committed authored truth
4. start isolated runtime session
5. open the dedicated preview browser window
6. boot the minimal gameplay foundation
7. switch shell presentation into preview-running state

When the user stops preview:

1. dispose the runtime session
2. clear preview-only UI and input ownership
3. restore the snapped authoring context
4. resume the authored workspace exactly where the user left it

In short English pseudo code:

```text
if transient authoring interaction exists:
  commit or cancel it first

snapshot current authoring context
boot runtime session from committed authored state
open dedicated preview browser window
boot minimal ECS gameplay foundation
switch shell to preview-running presentation

on preview stop:
  dispose runtime session
  restore authoring context snapshot
  resume original ProductMode and workspace
```

### Preview camera clarification

This epic should explicitly use runtime camera behavior for preview.

That means:

- preview camera should not be the authoring viewport camera
- preview camera should follow the player/runtime camera model
- preview should feel like the game is running, not like the user is still driving the layout camera

For this first slice, preview should therefore include:

- a spawned player runtime entity
- runtime-owned player input
- movement through the authored scene

This is the minimum bar for “running the game” in this epic.

This epic should **not** make layout camera controls a prerequisite for preview.

Layout camera improvements may happen later, but preview should stand on its own runtime camera behavior.

### Preview shell and window clarification

This epic should define how the running preview is launched and how Sugarmagic represents that running state.

Default direction:

- `Preview` is launched from the global shell action stripe in the upper-right shell area
- pressing `Preview` opens a dedicated browser window for the running game preview
- that window is a thin preview host over the shared runtime
- authoring-only overlays and authoring-only interaction chrome remain in the studio, not in the preview window
- the studio shell still clearly communicates that preview is active and provides an obvious `Stop Preview` action

The shell should make the following state obvious:

- preview is running
- the running preview lives in a dedicated preview window
- the user can stop and return

This epic should not require:

- a second renderer path
- a second application host

This epic should explicitly use the dedicated browser-window preview model as the intended first implementation.

### Vertical stripe clarification

This epic should complete the first meaningful version of the upper-right global action stripe.

For this slice, the stripe should be treated as the home for:

- global studio actions that are not ProductMode selectors
- preview launch / stop affordances
- future global actions that sit above any one `ProductMode`

The stripe should not become:

- a second navigation system
- a dumping ground for random tools
- a per-workspace local toolbar pretending to be global shell UI

For this epic, the stripe only needs enough design and behavior to make `Preview` feel intentional and permanent.

### Preview data-source clarification

Preview should boot from committed canonical authored truth already loaded in Sugarmagic.

This means:

- no publish step is required
- no export step is required
- no editor-only sidecar hydration is required
- no second "preview document" should be invented

Preview boot should derive from:

- canonical `Game Project`
- canonical authored content documents
- canonical `Region Document`
- plugin configuration and allowed plugin-authored records

Any preview-only runtime boot packet or load descriptor should be treated as:

- derived
- disposable
- runtime-owned

not as a second source of authored truth.

### Minimal gameplay-foundation clarification

This epic is the point where Sugarmagic should begin porting the first runtime gameplay foundation from Sugarengine.

The intended architectural direction is:

- keep the shared runtime in one runtime family
- derive the gameplay foundation from Sugarengine’s ECS model because that part of Sugarengine worked well
- port only the minimum needed for the first playable preview loop

For this epic, the minimum gameplay foundation should include:

- `World` as the ECS container for runtime entities, components, and system updates
- `System` ordering as the runtime execution model
- a first player-controlled entity
- player locomotion / movement
- runtime camera follow behavior

This epic should **not** require full migration of:

- quests
- NPC behavior
- dialogue
- inventory
- combat
- spells
- broader simulation subsystems

The purpose here is to establish the gameplay kernel, not to finish gameplay migration.

### Scope

In scope:

- completing the shell's upper-right global action stripe enough to host preview
- adding a global `Preview` action
- adding a visible `Stop Preview` action/state
- explicit preview-running shell state
- authoring-context snapshot and restore
- isolated runtime-session boot and teardown
- opening and managing the dedicated preview browser window
- preview boot from committed authored truth
- first ECS-backed gameplay foundation for preview
- player entity spawn and movement
- runtime camera behavior for preview
- runtime input ownership while preview runs
- preview/runtime HUD or minimal runtime chrome as needed to make preview feel like the game
- aligning preview boot with the same `runtime-core` + `targets/web` path intended for published web targets
- keeping preview lifecycle ownership in `apps/studio`
- retiring `runtime-web` as the place where target-host or preview behavior accumulates
- tests for preview session lifecycle and restoration behavior
- one first end-to-end Build-to-Preview flow using the active authored region context

Out of scope:

- remote or hosted preview targets
- publish and deployment workflows
- final preview debug HUD design
- save-from-preview or apply-runtime-changes-back-to-authoring behavior
- cross-region runtime streaming if not needed for the first preview slice
- layout camera improvements
- multiplayer/networked preview

### Initial capability recommendation

The first preview slice should stay narrow.

Recommended direction:

1. finish the upper-right global action stripe
2. add a `Preview` button there
3. launch a dedicated browser preview window from the current committed authored state
4. boot only the minimum real runtime systems needed for the first playable loop
5. hand camera ownership to the runtime/player-follow camera
6. provide one obvious `Stop Preview` action in the studio shell
7. return to the exact authored context on stop

The important thing is not preview feature breadth.

The important thing is proving the preview lifecycle cleanly and permanently.

### Architectural references

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [README.md](/Users/nikki/projects/sugarmagic/README.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 009: Material Compilation and Shader Pipeline Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)
- [Sugarengine `Editor.tsx` preview flow](/Users/nikki/projects/sugarengine/src/editor/Editor.tsx)
- [Sugarengine `PreviewManager.ts`](/Users/nikki/projects/sugarengine/src/editor/PreviewManager.ts)
- [Sugarengine ADR 007: episodic content system / local preview flow](/Users/nikki/projects/sugarengine/docs/adr/007-episodic-content-system.md)
- [Sugarengine ADR 009: project manager dialog / toolbar preview affordance](/Users/nikki/projects/sugarengine/docs/adr/009-project-manager-dialog.md)

### Epic acceptance criteria

- Sugarmagic exposes a clear `Preview` action in the upper-right global action stripe.
- Pressing `Preview` opens a dedicated browser window for the running game preview.
- Starting preview does not require export or publish.
- Starting preview resolves any active transient authoring interaction before boot.
- Preview boots from committed authored truth through the shared runtime.
- Preview boots a minimal ECS-backed gameplay foundation rather than only swapping camera presentation.
- The preview user can control a spawned player entity and move through the scene.
- Preview uses runtime camera behavior rather than the authoring viewport camera.
- The dedicated preview window shows runtime behavior rather than authoring overlays and authoring interactions.
- Sugarmagic exposes a clear `Stop Preview` path while preview is running.
- Stopping preview disposes the runtime session and restores the prior authored context exactly.
- Preview does not mutate canonical authored truth unless an explicit authored command says so.
- The implementation preserves one runtime path, one source of truth, and one playtest/runtime-session boundary.

### Epic definition of done

- All stories below are complete.
- A user can work in an authored workspace, press `Preview`, run the game in a dedicated browser window, stop preview, and resume exactly where they left off.
- The preview lifecycle is architecturally clean enough to support future Build, Design, and Render preview flows without inventing another preview architecture.
- The first runtime gameplay kernel is real enough that preview is meaningfully different from just looking at the authoring viewport.

## Story 1

### Title

Define and complete the shell's global action stripe for preview.

### Objective

Give `Preview` a permanent, discoverable shell home without turning it into a `ProductMode`.

### References

- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Plan 002: Shell Visual Foundation Epic](/Users/nikki/projects/sugarmagic/docs/plans/002-shell-visual-foundation-epic.md)
- [Sugarengine ADR 009: toolbar preview affordance](/Users/nikki/projects/sugarengine/docs/adr/009-project-manager-dialog.md)

### Tasks

1. Define the shell role of the upper-right global action stripe.
2. Place `Preview` there as a global action, not as navigation.
3. Define the visual states for:
   - preview available
   - preview running
   - stop preview available
4. Ensure the stripe remains globally scoped rather than workspace-owned.
5. Keep the stripe structurally compatible with future global actions.

### Acceptance criteria

- `Preview` has a clear permanent shell home.
- The shell distinguishes global actions from `ProductMode` navigation.
- The preview action is visually intentional and not hidden in a temporary menu.

### Definition of done

- The shell action stripe and `Preview` affordance are implemented clearly enough that later preview features do not need to relocate them.

## Story 2

### Title

Represent preview-running state in the shell and host model.

### Objective

Add explicit shell coordination for preview lifecycle without making shell state the owner of runtime truth.

### References

- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)

### Tasks

1. Define the shell-level preview-running state.
2. Define the snapshot payload for restoring authored context.
3. Keep runtime session truth outside shell stores.
4. Ensure preview state does not compete with `ProductMode` state.
5. Add tests for preview state transitions.

### Acceptance criteria

- The shell can represent preview start, running, and stop cleanly.
- The shell does not become the owner of runtime simulation truth.
- Preview lifecycle state is testable and explicit.

### Definition of done

- Shell coordination can express preview lifecycle cleanly without weakening the domain/runtime boundary.

## Story 3

### Title

Snapshot authoring context and restore it after preview.

### Objective

Make preview enter and exit feel trustworthy and reversible.

### References

- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)

### Tasks

1. Define what authoring context must be snapped for the first slice.
2. Require transient tool sessions to resolve before preview starts.
3. Snapshot:
   - active `ProductMode`
   - active workspace identity
   - active region/subject context
   - authoring camera/workspace context if relevant
   - selection and panel context if needed for smooth restoration
4. Restore that context on stop.
5. Add tests for preview enter/exit restoration.

### Acceptance criteria

- Preview start requires clean authoring-session boundaries.
- Preview stop returns the user to the same authored context they left.
- Stopping preview is not implemented as a hot reset of live scene mutations.

### Definition of done

- Preview restore behavior is reliable enough to support repeated author-preview-author loops.

## Story 4

### Title

Boot the first real preview runtime session from committed authored truth into a dedicated browser window.

### Objective

Run preview as the game using the shared runtime, not as an authoring imitation.

### References

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Sugarengine `PreviewManager.ts`](/Users/nikki/projects/sugarengine/src/editor/PreviewManager.ts)
- [Sugarengine ADR 007: local preview flow](/Users/nikki/projects/sugarengine/docs/adr/007-episodic-content-system.md)

### Tasks

1. Define the derived boot request for preview runtime session startup.
2. Build that request from committed canonical authored truth.
3. Open the dedicated preview window and start the shared runtime there in preview/session mode.
4. Port the first ECS-backed gameplay kernel needed for preview from Sugarengine’s runtime architecture.
5. Keep preview boot separate from publish/export pipelines.
6. Ensure preview boot uses the same runtime semantics intended for published targets.

### Acceptance criteria

- Preview starts from canonical authored truth already loaded in Sugarmagic.
- Preview runs in a dedicated browser window rather than inside the authoring viewport.
- No export or publish step is required.
- Preview boot input is derived and disposable, not canonical.
- Preview runtime owns a real `World` and first ordered `System` execution path.
- Preview launches through the same target-host path intended for published web games rather than a studio-only runtime fork.

### Definition of done

- Sugarmagic can launch the game from current authored state through the real shared runtime.

## Story 5

### Title

Hand player, camera, input, and HUD ownership to the runtime preview window while preview runs.

### Objective

Make preview feel like the game is running rather than like the user is still inside an editor viewport.

### References

- [Sugarengine `preview.ts`](/Users/nikki/projects/sugarengine/src/preview.ts)
- [Sugarengine camera ADRs and runtime camera behavior](/Users/nikki/projects/sugarengine/docs/adr/006-perspective-camera-system.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)

### Tasks

1. Define the first preview camera contract around runtime/player-follow behavior.
2. Spawn and initialize the first player-controlled runtime entity.
3. Ensure the dedicated preview window owns runtime input while preview runs.
4. Ensure the preview window shows runtime surfaces rather than authoring overlays such as gizmos and world cursors.
5. Allow runtime HUD/runtime interaction surfaces to appear.
6. Keep stop-preview affordances visible and clear from the studio shell.

### Acceptance criteria

- Preview camera behavior is runtime-owned.
- Authoring viewport behavior does not bleed into the preview window.
- Preview feels like the game is running.
- The user can move a player entity through the scene.

### Definition of done

- The first preview slice has clear runtime ownership of camera, input, and runtime-facing chrome.

## Story 6

### Title

Stop preview cleanly and resume authoring without corruption.

### Objective

Close the full loop and prove that preview is a safe, repeatable authoring tool.

### References

- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)

### Tasks

1. Dispose preview runtime session cleanly.
2. Release runtime-owned input/camera/UI control.
3. Restore snapped authoring context.
4. Ensure no runtime state leaks into canonical authored truth by accident.
5. Add tests and one manual verification pass for repeated start/stop loops.

### Acceptance criteria

- Preview can be started and stopped repeatedly without corrupting authored state.
- The authoring shell resumes exactly where it left off.
- Runtime-session state is disposed instead of being smuggled back into authoring state.

### Definition of done

- Sugarmagic supports a trustworthy start-preview / stop-preview loop.

## Story 7

### Title

Correct the preview/target host architecture so preview runs through `targets/web` and not through a separate `runtime-web` concept.

### Objective

Eliminate the package-boundary confusion that allows preview-specific or target-specific behavior to accumulate in the wrong place.

This story exists to lock the architecture to the intended long-term shape:

- `runtime-core` owns game/runtime logic
- `targets/web` owns the published web host around that runtime
- `apps/studio` owns preview launch, stop, and authoring-context restoration

### References

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)

### Tasks

1. Retire `runtime-web` as a conceptual owner of runtime hosting or preview behavior.
2. Move all true game/runtime logic into `runtime-core`.
3. Move published web hosting responsibilities into `targets/web`.
4. Make studio preview launch the `targets/web` path in a dedicated browser window instead of composing a parallel host inside `apps/studio`.
5. Keep preview lifecycle ownership in `apps/studio`, including:
   - `Preview` shell action
   - `window.open(...)`
   - preview handshake/orchestration
   - authoring snapshot and restore
6. Ensure the `targets/web` path used by preview is the same path the published web target uses, with preview-specific boot input remaining derived and disposable.
7. Remove any leftover package seams, names, or code ownership that imply a separate `runtime-web` layer is the long-term architecture.

### Acceptance criteria

- `runtime-core` is the only package that owns runtime/game logic.
- `targets/web` owns the web target host around `runtime-core`.
- `apps/studio` owns preview lifecycle orchestration, but not game/runtime logic.
- Preview uses the same `runtime-core` + `targets/web` path intended for published web targets.
- There is no separate preview-only runtime host architecture competing with the published web target host.
- `runtime-web` is no longer a conceptual dependency that invites web-target logic, preview logic, and runtime logic to mix together.

### Definition of done

- The package and host boundaries for preview and published web target are clean enough that future targets can be added without recreating the same confusion.

## Manual verification checklist

1. Open a project and enter `Build > Layout > region`.
2. Select an authored object and move it, then commit the change.
3. Press `Preview` from the upper-right shell action stripe.
4. Verify any active transform/brush session was resolved before preview boot.
5. Verify the shell clearly indicates preview is running.
6. Verify a dedicated preview browser window opened.
7. Verify the preview camera is runtime-owned and not the layout camera.
8. Verify authoring overlays are not visible in the preview window.
9. Verify a player entity exists and can move through the scene.
10. Verify the game can be controlled as a running runtime session.
11. Press `Stop Preview`.
12. Verify the user returns to the same authored workspace and subject context.
13. Verify the committed authored transform is still present.
14. Repeat start/stop multiple times and verify no drift or context loss.
