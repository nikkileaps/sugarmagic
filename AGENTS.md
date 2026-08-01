# Sugarmagic Instructions

Sugarmagic strives to be an all in one game creation studio for FoxLeapMoon. Specifically narrative focused games. It is not meant to make multiplayer games or combat games.

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

- Sugarmagic Studio is the main product.
- Plugins are installed independently and should specify their dependency on other plugins or be able to operate independently.


## Hard Architecture Rules

- Runtime-visible behavior must be implemented once.
- Runtime systems must not depend on editor UI code.
- Do not maintain separate editor-render and runtime-render behavior for the same authored content.
- Do not preserve old code paths “for safety” unless explicitly required and approved.
- Replace old paths decisively when the new path is ready.
- Prefer deletion over coexistence.
- Prefer explicit domain modules over cross-cutting convenience code.


## Source of Truth Rules

For each important concept, there must be one authoritative owner. This concept with an authoratitive owner should be in the Domain.

Do not allow multiple persisted models to overlap in meaning.

Editor-only state is allowed.
Duplicate authored-scene truth is not.


## Rendering Rules

- Sugarmagic must have one renderer path for authored content.
- Edit mode and play mode must share rendering semantics.
- The viewport may add overlays and tools, but authored content should not render through a second interpretation layer.
- Material graphs must be runtime-real, not editor-only abstractions.
- Landscape paint must be shown by the same implementation in edit and play.
- Atmosphere must be runtime-owned and editor-controlled.

## UI / UX Rules

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
- Each core behavior gets exactly one implementation. Two systems enforcing the
  same behavior is a bug, not flexibility.
- Source-of-truth is about DATA: one owner per concept. Single-enforcer is
    about BEHAVIOR: one implementation per decision. A codebase can satisfy the
    first and still violate the second.
- Before adding a rule, threshold, table, or resolver, grep for one that
    already exists — repo-wide, including `apps/` and `targets/`, not just
    `packages/`.
- Precedence belongs in one function, not spread across its callers. If two
    call sites consult the same sources in different orders, that is already
    the bug.
- A duplicate is not always literal. A copied constant, an inlined ternary of
    a shared table, or a second prompt asking the same question all count.
- When you find a second enforcer, do not just delete it. It has almost
    certainly drifted and now handles a case the other one does not, so
    deleting it loses behavior silently. They need to be merged -- stop and
    confirm the merged behavior with a human before choosing what survives.

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
- Every file should have a comment block at the top explaining what that file does and how it relates to the rest of the program
- Every module should have a short README explaining what that module or package does and how it relates to the rest of the program
- Comments and READMES should be updated with every change to reflect current code

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
