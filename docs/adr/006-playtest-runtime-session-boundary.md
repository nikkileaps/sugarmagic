# ADR 006: Playtest Runtime Session Boundary

**Status:** Accepted
**Date:** 2026-03-31

## Context

Sugarmagic must support switching from authoring into playtest without corrupting authored truth.

A hot-reset model would mutate the live authored scene and then attempt to unwind runtime state afterward. That is fragile and difficult to reason about.

## Decision

Sugarmagic will use snapshot-based playtest boundaries.

When playtest starts:

- resolve active transient authoring sessions first
- snapshot the current authoring context
- create an isolated `Runtime Session` from committed authored state
- boot the minimal gameplay foundation needed for the preview/playtest loop

When playtest stops:

- discard the `Runtime Session`
- restore the authoring context
- return the user to the last committed authored state plus preserved editor context

## Rules

1. Playtest state is isolated inside `Runtime Session`.
2. Playtest does not hot-mutate authored truth by default.
3. The first preview/playtest slice must be meaningfully runtime-real, not just an alternate camera over authored content.
4. Stopping playtest restores authoring context instead of unwinding live scene mutations.
5. Any future `apply from playtest` behavior must be an explicit authored command.

## Consequences

### Positive

- authored truth remains protected during playtest
- runtime session semantics stay clear
- ProductMode transitions become more reliable

### Tradeoffs

- playtest start/stop requires explicit lifecycle handling
- authoring session context must be preserved separately from runtime session state

## Builds On

- [Proposal 004: Sugarmagic ProductMode Shell](/Users/nikki/projects/sugarmagic/docs/proposals/004-productmode-shell.md)
- [Proposal 008: Command and Transaction Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/008-command-and-transaction-architecture.md)
