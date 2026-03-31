# ADR 002: ProductMode Shell

**Status:** Accepted
**Date:** 2026-03-31

## Context

Sugarmagic needs a stable top-level shell concept that organizes workflows without redefining domain ownership.

The shell must not be built around:

- the old Sugarbuilder versus Sugarengine split
- low-level tools
- a growing pile of tabs with unclear boundaries

## Decision

Sugarmagic will use `ProductMode` as the only top-level shell concept for major authoring contexts.

The initial `ProductMode` set is:

- `Design`
- `Build`
- `Render`

A future `Animate` ProductMode may be added later, but it is out of scope for the current foundation.

## Rules

1. `ProductMode` is a shell concept, not a domain concept.
2. ProductModes compose domain workflows; they do not create new domain truth.
3. The same canonical documents and shared runtime remain active across ProductModes.
4. ProductMode switching changes composition, not ownership.

## Consequences

### Positive

- the product gets a stable top-level mental model
- shell vocabulary becomes consistent
- feature placement can be reasoned about in terms of user intent

### Tradeoffs

- ProductMode boundaries must be curated carefully so they stay clean
- some features will naturally be exposed in more than one ProductMode through composition

## Builds On

- [Proposal 002: Sugarmagic Domain Model](/Users/nikki/projects/sugarmagic/docs/proposals/002-sugarmagic-domain-model.md)
- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
