# ADR 003: Canonical Game Project and Region Ownership

**Status:** Accepted
**Date:** 2026-03-31

## Context

The old split architecture blurred ownership between:

- game/project identity
- region visual content
- region gameplay-local content
- runtime session state
- publish artifacts

That ambiguity caused repeated confusion about what was canonical versus derived.

## Decision

Sugarmagic will use these ownership boundaries:

- `Game Project` is the canonical root authored container
- `Region Document` is the canonical authored place unit
- `Runtime Session` owns live play and preview state
- `Publish Artifacts` own derived delivery outputs only

A `Region Document` owns both:

- visual world composition
- region-local gameplay placements

Those concerns will not be split into separate canonical authored models.

## Rules

1. A region's authored visual and region-local gameplay truth live together.
2. Runtime session state is not canonical authored truth.
3. Publish artifacts are derived and disposable.
4. ProductMode does not change domain ownership.

## Consequences

### Positive

- region meaning becomes coherent
- runtime state stops masquerading as authored truth
- publish outputs stop masquerading as source data

### Tradeoffs

- region documents must be designed carefully to stay clear without becoming monolithic
- some old boundaries from Sugarbuilder and Sugarengine must be removed instead of preserved

## Builds On

- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
