# Plan 001: Bootstrap Project Foundation Epic

**Status:** Proposed  
**Date:** 2026-03-31

## Epic

### Title

Bootstrap the unified Sugarmagic project foundation.

### Goal

Create the initial Sugarmagic project structure and development tooling so implementation can begin inside the intended permanent architecture rather than inside temporary or ambiguous scaffolding.

This epic exists to make the repo shape, package boundaries, dependency direction, runtime-sharing seams, and verification tooling real before feature work begins.

### Why this epic exists

The documentation is already clear that Sugarmagic must not drift into:

- split editor/runtime truth
- shell-owned domain logic
- accidental second engines
- weak package boundaries
- temporary bootstrap structure that becomes permanent

This epic translates those architectural rules into the initial repo and tooling foundation.

### Technology clarification

This bootstrap should explicitly assume:

- TypeScript as the primary language
- ESM module boundaries
- Vite-compatible app and target tooling
- `zustand` as the default store technology for shell, ProductMode, authoring-session, and other UI-facing application state

`zustand` is a store implementation choice for application coordination. It is not the canonical owner of authored truth.

### State and store management clarification

The bootstrap should make the following separation explicit:

- canonical authored truth lives in domain documents and their command/transaction boundary
- runtime session state lives in runtime/session boundaries
- shell, ProductMode, selection, tool session, panel, and other UI-facing coordination state may use `zustand`

The initial store layer must not become:

- a shadow domain model
- a direct canonical mutation path
- a replacement for command/transaction boundaries
- a second source of truth for region, material, landscape, environment, or gameplay-authored concepts

In practical terms:

- stores coordinate access to domain and runtime systems
- stores may hold transient and session state
- stores may hold view-friendly derived state
- stores must not define canonical authored meaning

### State ownership matrix

| State kind | Canonical owner | Typical examples | Recommended implementation home | Persistence expectation | Mutation rule |
| --- | --- | --- | --- | --- | --- |
| UI component-local state | Component instance | popover open state, hover state, uncontrolled input draft, local tab selection inside one panel | local component state | usually not persisted | mutate locally inside the component |
| Shell/application state | Product shell and authoring-session coordination | active `ProductMode`, navigation, dock/panel visibility, global selection, active tool, tool-session coordination, notifications | `zustand` store in shell/orchestration layer | optional; may persist as user preference or authoring sidecar if justified | may mutate through store actions, but must not redefine domain meaning |
| Canonical authored state | Domain documents | `GameProject`, `RegionDocument`, authored environment, authored landscape, authored gameplay definitions, plugin-authored records where allowed | `packages/domain` contracts consumed by orchestration and runtime | persisted as canonical authored payloads | must mutate only through semantic commands and transactions |
| Runtime session state | Runtime session systems | live world state, active playtest entities, player state, quest/session flags during playtest, transient runtime simulation state | `packages/runtime-core` session/coordinator state | disposable by default; host policy may choose session persistence separately | mutate through runtime/session systems, not UI stores |
| Derived view state | Derived projections over domain or runtime | filtered outliner view, inspector-ready projections, search results, viewport summaries | computed selectors, memoized derivations, or thin store-backed projections | not canonical; persist only if clearly sidecar/cached | recompute from authoritative state |
| Persistent authoring sidecar state | Authoring-assistance persistence boundary | bookmarks, saved panel preferences, author annotations, optional editor layout state | `packages/io` sidecar contracts plus shell/orchestration consumers | persisted as sidecars, never as canonical authored truth | may be written separately after canonical saves |
| Derived runtime or publish artifacts | Derived projection/publish systems | packed landscape payloads, geometry cache, publish manifest, target bundle | `packages/io`, `packages/runtime-core`, and target/publish systems | disposable and regenerable | regenerate from canonical documents and approved projections |

### State placement guidelines

Use local component state when:

- the state matters only to one mounted component or a very small leaf subtree
- losing the state on unmount is acceptable
- the state does not affect canonical authored meaning
- the state does not need to coordinate tools, panels, ProductModes, or runtime systems

Use `zustand` when:

- multiple components need to coordinate the same shell or authoring-session state
- the state represents app/session coordination rather than authored truth
- the state needs stable actions/selectors across the shell
- the state may optionally be persisted as preference or sidecar data later

Use domain documents plus commands/transactions when:

- the state changes what the user has authored
- the state must participate in undo/redo
- the state must persist as canonical authored truth
- the runtime and publish systems must agree on its meaning

Use runtime session state when:

- the state exists because the simulation is running
- the state should be discarded or reset when playtest ends
- the state reflects live execution rather than authored intent

Use sidecars or caches when:

- the state improves authoring convenience or performance
- the state can be deleted without changing authored meaning
- the state can be rebuilt or safely dropped when stale

### Fast decision rules

Ask these questions in order:

1. If this state disappeared, would the authored game meaning change?
   - if yes, it belongs in canonical domain state
2. If this state disappeared, would only the current play session change?
   - if yes, it belongs in runtime session state
3. Does this state only help the shell, tools, panels, or selection model coordinate?
   - if yes, it belongs in `zustand`
4. Does this state only matter inside one component?
   - if yes, keep it local to the component
5. Is this state useful to persist but safe to delete?
   - if yes, it belongs in sidecars or caches, not canonical payloads

### Anti-patterns to avoid

- putting `RegionDocument` or other canonical authored objects directly inside `zustand` as the source of truth
- using component-local state for cross-shell coordination like selection or active ProductMode
- letting runtime session state leak into authored undo/redo
- persisting view-only convenience state as canonical authored payload
- storing the same semantic state in both local component state and `zustand` without a clear ownership reason

### Architectural references

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [README.md](/Users/nikki/projects/sugarmagic/README.md)
- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [ADR 007: Execution and Concurrency Model](/Users/nikki/projects/sugarmagic/docs/adr/007-execution-and-concurrency-model.md)
- [ADR 008: Material Semantics and Compile Profiles](/Users/nikki/projects/sugarmagic/docs/adr/008-material-semantics-and-compile-profiles.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 007: Execution and Concurrency Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 009: Material Compilation and Shader Pipeline Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)

### Scope

In scope:

- repo directory structure
- workspace and package tooling
- technology stack clarification for bootstrap
- state and store management boundaries
- TypeScript and build foundations
- host and target entry-point scaffolding
- architectural contracts and seam definitions
- verification tooling for boundary enforcement
- bootstrap documentation for any choices that concretize an open architectural point

Out of scope:

- real authoring features
- real rendering features
- real domain persistence implementations
- landscape, atmosphere, materials, gameplay, or publish feature behavior
- compatibility migration code

### Epic acceptance criteria

- The repo structure reflects the intended permanent architecture from Proposal 005.
- Workspace and package tooling support TypeScript, ESM, and Vite-compatible entry points.
- Package boundaries and dependency direction are explicit and enforceable.
- `apps/studio` and `targets/web` both consume shared runtime-facing packages rather than inventing separate paths.
- ProductMode, domain, runtime, IO, plugin, and testing seams exist in code as stable homes for future work.
- The bootstrap includes verification that architecture boundaries are not only documented but testable.
- No bootstrap decision weakens one source of truth, single enforcer, or one-way dependencies.

### Epic definition of done

- All stories below are complete.
- The workspace installs, typechecks, and runs the intended bootstrap commands successfully.
- The foundation is ready for the first implementation slice without requiring structural rework.
- Any intentionally unresolved architecture decisions remain explicitly unresolved and are not accidentally implied by tooling and are summarized and pointed out after implementation.

## Story 1

### Title

Create the canonical repo and workspace skeleton.

### Objective

Establish the top-level repo layout so Sugarmagic starts inside the package-oriented structure described in Proposal 005 and API 002.

### References

- [Proposal 005: Repo Layout](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)

### Tasks

1. Create top-level implementation directories:
   - `apps/studio`
   - `targets/web`
   - `packages/shell`
   - `packages/productmodes`
   - `packages/domain`
   - `packages/runtime-core`
   - `packages/runtime-web`
   - `packages/plugins`
   - `packages/io`
   - `packages/ui`
   - `packages/testing`
   - `scripts`
   - `tooling`
2. Add minimal per-package source directories so each package has an obvious ownership home.
3. Add package-level README or package notes where necessary to keep ownership clear during early development.
4. Ensure the initial structure does not introduce alternate homes for the same behavior.

### Acceptance criteria

- The top-level directory layout matches the intended Sugarmagic system architecture.
- Every major architectural system has one clear home.
- No package is created that competes with the documented system map.
- The structure is understandable without needing to infer hidden ownership.

### Definition of done

- Directory structure exists in the repo.
- Package ownership is legible from the filesystem.
- The structure can be referenced as the starting foundation for all follow-on work.

## Story 2

### Title

Establish workspace, package, and developer tooling.

### Objective

Set up the monorepo foundation for TypeScript, ESM modules, and Vite-compatible app entry points without embedding feature logic into the tooling layer.

### References

- [API 001: Tech Stack and Platform API](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: System and Package API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Choose and configure the workspace package manager and root workspace manifest.
2. Configure shared TypeScript settings for workspace packages using ESM-friendly defaults.
3. Record the bootstrap tech stack decision that `zustand` is the default store technology for application-facing state.
4. Configure root scripts for install, typecheck, lint, test, and app startup.
5. Configure Vite-compatible tooling for app and target entry points.
6. Add linting and formatting tooling appropriate for early repository consistency.
7. Add root ignore files and basic environment config needed for a clean developer experience.

### Acceptance criteria

- The workspace installs and resolves internal packages correctly.
- TypeScript project structure supports package boundaries rather than flattening them.
- The bootstrap explicitly records `zustand` as the default store technology for app-facing state.
- The tooling setup does not imply that stores are the owner of canonical authored truth.
- Root scripts provide a reliable developer entry point for bootstrap work.
- App and target tooling are compatible with the documented web-facing architecture.

### Definition of done

- Root tooling files exist and are wired together.
- A new engineer can install dependencies and run the baseline project commands.
- Tooling does not force dependency violations or architecture shortcuts.

## Story 3

### Title

Enforce package boundaries and one-way dependencies.

### Objective

Make the bootstrap itself reflect the documented dependency direction so architecture drift is caught early rather than after feature code accumulates.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [API 002: Allowed Dependency Direction](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: Layering Rule](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Encode package references so lower layers do not depend on upper layers.
2. Set up lint, build, or test enforcement for disallowed cross-package imports.
3. Establish public entry-point conventions for packages.
4. Keep shared primitives narrow and avoid introducing a generic dumping-ground package.

### Acceptance criteria

- The bootstrap includes technical enforcement for one-way dependencies.
- `domain` does not depend on shell or browser-specific UI concerns.
- `runtime-core` does not depend on editor UI code.
- `targets/web` remains a thin consumer of shared runtime packages.

### Definition of done

- Boundary enforcement is automated, not only documented.
- Violating a core dependency rule produces a visible failure during verification.

## Story 4

### Title

Scaffold the studio host and published web target as thin shells.

### Objective

Create minimal `apps/studio` and `targets/web` entry points that immediately prove the “shared runtime, thin hosts” rule.

### References

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [API 001: Runtime Delivery Model](/Users/nikki/projects/sugarmagic/docs/api/overview.md)
- [API 002: `/apps/studio` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 002: `/targets/web` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: Shared Runtime for Web Targets](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

### Tasks

1. Create minimal `apps/studio` boot entry points.
2. Create minimal `targets/web` boot entry points.
3. Wire both entry points through shared runtime-facing package seams.
4. Avoid adding host-specific runtime semantics.
5. Provide basic smoke-start commands for both shells.

### Acceptance criteria

- `apps/studio` exists as a composition host rather than a domain owner.
- `targets/web` exists as a thin target shell rather than a second engine.
- Both hosts import shared runtime-facing packages from the workspace.
- No bootstrap code creates separate runtime semantics for studio versus published web.

### Definition of done

- Both host shells can start at a bootstrap level.
- Shared-runtime consumption is visible in the code structure.
- The host scaffolding reinforces the one-runtime rule.

## Story 5

### Title

Scaffold shell and ProductMode contracts.

### Objective

Introduce the shell-facing architecture for `Design`, `Build`, and `Render` without letting ProductModes become alternate domain owners.

### References

- [ADR 002: ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/adr/002-productmode-shell.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 005: ProductMode Composition](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [API 002: `/packages/shell` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 002: `/packages/productmodes` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Create the `shell` package with app frame, navigation, viewport host, inspector host, command surface, and status surface seams.
2. Create the `productmodes` package with `design`, `build`, and `render` subpackages.
3. Define ProductMode descriptors and activation contracts.
4. Define shell contribution seams for panels, overlays, inspectors, and command registrations.
5. Define the intended ownership of shell-facing store state such as active ProductMode, navigation state, panel state, selection coordination, and tool-session coordination.
6. Keep ProductModes composition-only and avoid embedding domain truth inside them.

### Acceptance criteria

- The top-level shell can describe itself entirely in terms of ProductMode.
- `Design`, `Build`, and `Render` exist as composition contracts.
- Shell-facing state ownership is explicit and can be implemented with `zustand` without becoming canonical truth.
- ProductModes do not own canonical data structures.
- The shell can evolve without redefining domain ownership.

### Definition of done

- Shell and ProductMode scaffolding exists in code.
- The bootstrap supports future mode-specific work without creating parallel truths.

## Story 6

### Title

Scaffold canonical domain and mutation-boundary contracts.

### Objective

Define the initial domain-side homes for canonical authored truth, semantic commands, transactions, and history so feature work does not begin with direct mutation or fuzzy ownership.

### References

- [ADR 003: Canonical Game Project and Region Ownership](/Users/nikki/projects/sugarmagic/docs/adr/003-canonical-game-project-and-region-ownership.md)
- [ADR 004: Command and Transaction Boundary](/Users/nikki/projects/sugarmagic/docs/adr/004-command-and-transaction-boundary.md)
- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [API 003: Domain, Runtime, and Lifecycle API](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)

### Tasks

1. Create the `domain` package substructure for:
   - `game-project`
   - `content-library`
   - `region-authoring`
   - `gameplay-authoring`
   - `plugins`
   - `publish-artifacts`
   - `shared`
   - `commands`
   - `transactions`
   - `history`
2. Define initial canonical type seams for `GameProject` and `RegionDocument`.
3. Define semantic command contracts for authored mutation.
4. Define transaction contracts and history boundaries.
5. Explicitly separate domain contracts from store implementations so canonical types are not designed around `zustand` shape.
6. Keep the initial shape semantic and architectural, not prematurely field-complete.

### Acceptance criteria

- Canonical authored concepts have explicit homes in the `domain` package.
- The command/transaction boundary exists as a first-class part of the foundation.
- Domain truth is not modeled as a UI store.
- The bootstrap does not encourage direct UI mutation of canonical documents.
- `RegionDocument` is positioned as the canonical authored place unit.

### Definition of done

- The `domain` package provides clear homes for truth, commands, transactions, and history.
- Follow-on feature work can build on these contracts instead of inventing side paths.

## Story 7

### Title

Scaffold shared runtime, session, and execution seams.

### Objective

Lay down the shared runtime contracts for runtime boot, session lifecycle, compile profiles, and worker-backed jobs without implementing real rendering features yet.

### References

- [ADR 001: Single Runtime Authoring Rule](/Users/nikki/projects/sugarmagic/docs/adr/001-single-runtime-authoring-rule.md)
- [ADR 006: Playtest Runtime Session Boundary](/Users/nikki/projects/sugarmagic/docs/adr/006-playtest-runtime-session-boundary.md)
- [ADR 007: Execution and Concurrency Model](/Users/nikki/projects/sugarmagic/docs/adr/007-execution-and-concurrency-model.md)
- [ADR 008: Material Semantics and Compile Profiles](/Users/nikki/projects/sugarmagic/docs/adr/008-material-semantics-and-compile-profiles.md)
- [Proposal 007: Execution and Concurrency Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 009: Material Compilation and Shader Pipeline Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)
- [API 002: `/packages/runtime-core` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 002: `/packages/runtime-web` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Create the `runtime-core` package structure for scene, materials, landscape, environment, streaming, interaction, state, jobs, coordination, and plugins.
2. Create the `runtime-web` package structure for boot, workers, transfer, scheduling, assets, input, save, audio, and network.
3. Define shared runtime boot and teardown contracts.
4. Define runtime session and playtest lifecycle seams.
5. Define compile-profile seams for authoring preview, runtime preview, and published target.
6. Define worker/job contracts around snapshot-in, delta-out semantics.

### Acceptance criteria

- Shared runtime boundaries exist as first-class packages.
- Runtime-web is adapter-oriented and does not redefine runtime semantics.
- Playtest/session isolation is reflected in the scaffolded contracts.
- Worker/job seams align with generation-aware, coordinator-owned execution.
- Compile profiles are represented as policy seams rather than separate compilers.

### Definition of done

- Runtime packages have stable architectural homes.
- Hosts can depend on runtime packages without creating alternate runtime paths.

## Story 8

### Title

Scaffold IO, persistence, and game-root seams.

### Objective

Create the initial IO and persistence homes so canonical payloads, sidecars, derived projections, and publish outputs remain distinct from the start.

### References

- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [ADR 009: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/adr/009-game-root-contract.md)
- [Proposal 005: Game Root Contract](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [API 002: `/packages/io` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 003: Persistence API Concepts](/Users/nikki/projects/sugarmagic/docs/api/domain-runtime-and-lifecycle-api.md)

### Tasks

1. Create the `io` package structure for:
   - `game-root`
   - `documents`
   - `imports`
   - `exports`
   - `publish`
   - `schemas`
   - `migrations`
2. Define package seams for canonical document load/save.
3. Define package seams for imports, compatibility exports, and publish outputs as distinct concerns.
4. Add placeholder contracts for game-root discovery and root-relative path resolution.
5. Document any provisional file naming or layout choices that the bootstrap must make.

### Acceptance criteria

- The code structure reflects the four persistence strata.
- IO is not treated as the owner of domain meaning.
- Export and publish are clearly separated from canonical document persistence.
- Game-root concerns have one obvious architectural home.

### Definition of done

- IO and persistence seams exist in code.
- Future persistence implementation can land without restructuring the repo.
- Bootstrap choices do not accidentally redefine canonical authored truth.

## Story 9

### Title

Scaffold plugin and reusable UI extension seams.

### Objective

Provide the minimal capability-based structure for plugins and reusable UI components without letting either become cross-cutting escape hatches.

### References

- [Proposal 002: Plugins Domain](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 005: Plugin Capability System](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 008: Plugin Rule](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [API 002: `/packages/plugins` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [API 002: `/packages/ui` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)

### Tasks

1. Create the `plugins` package structure for `sdk`, `runtime`, `shell`, and `builtin`.
2. Define plugin manifest, capability, and lifecycle seams.
3. Define command-contribution seams that still route through the same transaction boundary.
4. Create the `ui` package structure for reusable components, inspectors, graphs, trees, panels, and tokens.
5. Keep reusable UI components separate from domain ownership and direct mutation.

### Acceptance criteria

- Plugins are structured as optional capabilities, not hidden alternate owners.
- Plugin mutation paths are visibly constrained by the documented command boundary.
- Reusable UI has a dedicated package and does not become a domain layer.
- The bootstrap avoids a generic shared-utils sprawl.

### Definition of done

- Plugin and UI extension seams exist in code.
- Future plugin and UI work can expand from these homes without structural ambiguity.

## Story 10

### Title

Add verification and architectural smoke tests.

### Objective

Make the bootstrap verifiable so the project foundation proves the documented rules rather than merely gesturing at them.

### References

- [AGENTS.md](/Users/nikki/projects/sugarmagic/AGENTS.md)
- [Proposal 005: Verification Rules](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Verifiable Outcomes](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 007: Verifiable Outcomes](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 008: Verifiable Outcomes](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
- [Proposal 009: Verifiable Outcomes](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)
- [API 002: `/packages/testing` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)

### Tasks

1. Create the `testing` package structure for fixtures, game-roots, runtime harness, and publish harness.
2. Add workspace smoke checks for install, typecheck, lint, and tests.
3. Add architectural smoke tests or assertions for:
   - boundary-safe imports
   - shared runtime consumption
   - thin host expectations
   - basic package resolution
4. Add minimal developer documentation describing how the bootstrap is verified.

### Acceptance criteria

- Verification exists for the bootstrap foundation.
- Architectural drift can fail fast during development.
- The workspace has at least one repeatable validation path for foundation health.
- The testing package has a clear long-term role from the beginning.

### Definition of done

- Developers can run a documented verification loop.
- Foundational architecture assumptions are testable.
- The bootstrap has a credible enforcement path for “goals must be verifiable.”

## Risks and watchpoints

- Do not let bootstrap tooling imply a second runtime path.
- Do not let shell code become the first place domain truth is modeled.
- Do not let `zustand` stores become the accidental source of truth for authored documents.
- Do not create convenience packages that flatten domain meaning.
- Do not overcommit to final persistence schemas unless the decision is explicit.
- Do not let ProductMode descriptors become alternate data owners.

## Sequencing recommendation

Recommended execution order:

1. Story 1
2. Story 2
3. Story 3
4. Story 4
5. Story 5
6. Story 6
7. Story 7
8. Story 8
9. Story 9
10. Story 10

This order keeps structure and enforcement ahead of feature seams, and keeps verification close to the foundation instead of postponing it until after architecture debt appears.

## Completion note

This epic is complete only when Sugarmagic can begin implementation from inside the documented permanent architecture, with no need for a later “real structure” rewrite to undo bootstrap shortcuts.
