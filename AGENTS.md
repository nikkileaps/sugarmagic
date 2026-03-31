# Sugarmagic Instructions

Sugarmagic is the clean successor to Sugarbuilder and Sugarengine for region authoring and runtime playback.

This repo exists to replace a split architecture that created repeated parity bugs, duplicated behavior, and wasted time.

## Mission

Build one application where:

- the authored region is the runtime region
- the edit view and play view use the same runtime systems
- visual truth does not depend on export/import validation loops
- region authoring and runtime playback live in one coherent product

Do not recreate the old split inside this repo.

## Non-Negotiable Principles

- One source of truth.
- Single enforcer.
- One-way dependencies.
- One type per behavior.
- Goals must be verifiable.

If a proposed change weakens one of these, stop and rethink it.

## Product Direction

- Sugarmagic is the host product.
- Sugarbuilder is legacy and migration-only.
- Sugarengine is an input to Sugarmagic, not a sibling product to preserve forever.
- The goal is not coexistence. The goal is consolidation.
- The goal is not compatibility at all costs. The goal is a clean long-term home.

## Hard Architecture Rules

- Runtime-visible behavior must be implemented once.
- Editor tooling may sit on top of runtime systems.
- Runtime systems must not depend on editor UI code.
- Do not maintain separate editor-render and runtime-render behavior for the same authored content.
- Do not preserve old code paths “for safety” unless explicitly required and approved.
- Replace old paths decisively when the new path is ready.
- Prefer deletion over coexistence.
- Prefer explicit domain modules over cross-cutting convenience code.

## Migration Bias

This repo is a migration project as much as a product project.

That means:

- every migrated capability must land in a clear permanent home
- every migration should identify what old code or old concept it makes obsolete
- every major port should reduce duplication, not move duplication around
- no “temporary bridge” unless it has a clear removal condition

When migrating from Sugarbuilder or Sugarengine, always state:

- what is being kept
- what is being rewritten
- what is being deleted
- what becomes the new source of truth

## Source of Truth Rules

For each important concept, there must be one authoritative owner.

Examples:

- region document
- placed asset
- landscape document
- environment document
- material graph document
- region workspace state

Do not allow multiple persisted models to overlap in meaning.

Editor-only state is allowed.
Duplicate authored-scene truth is not.

## Single Enforcer Rules

Each core behavior must have one implementation.

Examples:

- one region loader
- one renderer path
- one landscape runtime
- one material graph compiler/runtime
- one sky/cloud system
- one environment application path
- one save/load path for authored regions

If two systems appear to enforce the same behavior, that is a bug, not flexibility.

## Rendering Rules

- Sugarmagic must have one renderer path for authored content.
- Edit mode and play mode must share rendering semantics.
- The viewport may add overlays and tools, but authored content should not render through a second interpretation layer.
- Material graphs must be runtime-real, not editor-only abstractions.
- Landscape paint must be shown by the same implementation in edit and play.
- Atmosphere must be runtime-owned and editor-controlled.

## UI / UX Rules

- Adopt Sugarengine-style shell discipline.
- Do not paste Sugarbuilder wholesale into Sugarmagic.
- Preserve strong workflows from Sugarbuilder, but re-home them intentionally.
- Prefer mode-based editing over giant overloaded screens.
- Keep the viewport central.
- Keep structure, tools, and properties visible and purposeful.
- Optimize for long sessions, low friction, and trust.
- Every UI concept implemented shall be a re-usable component. Always look first to see if a component exists already.

## Code Design Rules

- Favor clear domain boundaries over clever abstractions.
- Use explicit types for important domain concepts.
- Avoid generic “manager” sprawl.
- Avoid utility dumping grounds.
- Prefer composition over inheritance.
- Prefer narrow modules with obvious ownership.
- Make names reflect domain meaning, not implementation details.
- If a helper erases important meaning, it is too generic.

## Tech Debt Rules

- Do not add fallback paths unless explicitly approved.
- Do not keep compatibility code “just in case.”
- Do not leave old and new systems running in parallel longer than necessary.
- Do not defer deletion of replaced paths without a stated reason.
- Every temporary workaround must have:
  - why it exists
  - what replaces it
  - when it should be removed

If a change creates permanent ambiguity, it is probably wrong.

## Documentation Rules

- Major architecture decisions must be written down.
- New permanent subsystem boundaries should get an ADR or short design note.
- Update docs when implementation changes the intended shape.
- Migration work should document what legacy path becomes obsolete.

## Expected Change Discipline

For meaningful changes, always be able to answer:

- What is the source of truth?
- What is the single enforcer?
- What old path is replaced?
- What can now be deleted?
- How do we verify this works?

If those answers are weak, the design is not ready.

## Default Implementation Bias

When there are multiple options, bias toward the option that:

1. reduces duplication
2. removes a boundary
3. strengthens a single source of truth
4. deletes more legacy complexity
5. makes the runtime truth the editor truth

## Anti-Patterns To Avoid

Do not introduce or normalize:

- editor-only fake render paths
- duplicated region representations
- duplicated material semantics
- duplicated landscape semantics
- export/import as the normal truth-check loop
- “temporary” adapters that become permanent
- broad shared modules with unclear ownership
- preserving a legacy workflow if it weakens the long-term architecture

## Working Standard

Sugarmagic should feel like it was designed as one product from the beginning, even when built through migration.

Every meaningful change should move the codebase closer to that feeling.
