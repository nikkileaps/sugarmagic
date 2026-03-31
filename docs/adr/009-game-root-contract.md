# ADR 009: Game Root Contract

**Status:** Accepted
**Date:** 2026-03-31

## Context

Sugarmagic must remain a real editor for external game roots, not a tool that stores title content inside its own repo.

The older engine history already established that authored content should live in a game root with root-relative paths and derived publish outputs.

## Decision

Sugarmagic will preserve the authored game root as the canonical external project boundary.

Rules:

- Sugarmagic opens a game root directly
- authored content lives in that game root
- authored paths remain root-relative
- publish outputs remain derived
- compatibility exports live in explicit derived locations, not as canonical authored truth

## Consequences

### Positive

- title content ownership stays clean
- authored content remains portable and external to the tool repo
- publish and compatibility outputs stay properly derivative

### Tradeoffs

- path resolution and IO boundaries must remain disciplined
- project lifecycle code must always respect game-root conventions

## Builds On

- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [ADR 025: Multi-Project Game Architecture](/Users/nikki/projects/sugarengine/docs/adr/025-multi-project-architecture.md)
- [ADR 026: Game Root Lifecycle and External Game Discovery](/Users/nikki/projects/sugarengine/docs/adr/026-game-root-lifecycle-and-external-game-discovery.md)
