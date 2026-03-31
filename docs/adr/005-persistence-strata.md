# ADR 005: Persistence Strata

**Status:** Accepted
**Date:** 2026-03-31

## Context

`One source of truth` is often misread as `one giant file`. That leads to editor bloat leaking into runtime load paths.

Sugarmagic needs persistence boundaries that preserve canonical authored truth while keeping runtime loading lean.

## Decision

Sugarmagic will use four persistence strata:

1. canonical authored payloads
2. persistent authoring sidecars
3. derived runtime projections
4. publish artifacts

Canonical authored meaning remains singular.

The runtime must be able to load runtime-relevant authored payloads without hydrating editor-only sidecars.

## Rules

1. Canonical authored payloads define authored meaning.
2. Authoring sidecars may persist durable editor assistance, but do not define authored meaning.
3. Derived runtime projections are disposable.
4. Publish artifacts are derived and disposable.
5. Runtime preview and playtest do not require editor-only persistence.

## Consequences

### Positive

- canonical truth remains clear
- runtime load paths stay lean
- editor convenience persistence remains possible without polluting runtime semantics

### Tradeoffs

- persistence boundaries must be designed intentionally
- versioning and migration must account for multiple payload classes

## Builds On

- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
