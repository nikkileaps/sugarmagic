# ADR 001: Single Runtime Authoring Rule

**Status:** Accepted
**Date:** 2026-03-31

## Context

Sugarbuilder and Sugarengine drifted because authored content was previewed and played through different effective runtime paths.

That produced repeated bugs around:

- material parity
- landscape parity
- atmosphere parity
- export/import mismatch
- visual trust

Sugarmagic exists to remove that split.

## Decision

Sugarmagic will use one runtime/rendering path for:

- authoring preview
- playtest
- published targets

That shared runtime path includes both:

- rendering semantics
- runtime gameplay semantics

When Sugarmagic introduces preview/playtest gameplay behavior, it should do so by extending the shared runtime rather than inventing editor-local preview simulation logic.

The first gameplay foundation should be derived from Sugarengine’s proven ECS model:

- `World`
- `System`
- ordered system execution
- player-controlled runtime entity flow

Editor tooling may add overlays, inspectors, and transient authoring aids, but authored content itself must render and simulate through the same runtime semantics.

There will not be:

- a separate editor renderer for authored content
- a separate gameplay renderer for authored content
- a separate published-target interpretation of authored region semantics

## Rules

1. Runtime-visible behavior is implemented once.
2. Authoring preview uses the shared runtime, not a fake editor-only path.
3. Preview/playtest gameplay semantics use the shared runtime, not a shell-local simulation stub.
4. Published targets derive from the same runtime semantics.
5. Any target-specific optimization must preserve authored meaning.

## Consequences

### Positive

- visual trust becomes a real product property
- parity bugs move from architectural norm to implementation bug
- new authored features must become runtime-real immediately
- preview becomes a real runtime loop rather than a camera-only presentation mode

### Tradeoffs

- some editor conveniences must be layered above the runtime instead of baked into it
- runtime architecture quality matters more because more of the product depends on it

## Builds On

- [Proposal 001: Sugarbuilder + Sugarengine Unification](/Users/nikki/projects/sugarmagic/docs/proposals/001-sugarbuilder-sugarengine-unification.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
