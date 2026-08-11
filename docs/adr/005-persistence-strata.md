# ADR 005: Persistence Strata

**Status:** Accepted
**Date:** 2026-03-31
**Amended:** 2026-08-09 (rule 3 sharpened; rule 6 added)

## Context

`One source of truth` is often misread as `one giant file`. That leads to editor bloat leaking into runtime load paths.

Sugarmagic needs persistence boundaries that preserve canonical authored truth while keeping runtime loading lean.

## Decision

Sugarmagic will use four categories of persisted data (the "strata" of this
document's title -- they are categories, nothing more):

1. canonical authored payloads
2. persistent authoring sidecars
3. derived runtime projections
4. publish artifacts

Canonical authored meaning remains singular.

The runtime must be able to load runtime-relevant authored payloads without hydrating editor-only sidecars.

## Rules

1. Canonical authored payloads define authored meaning.
2. Authoring sidecars may persist durable editor assistance, but do not define authored meaning.
3. A derived runtime projection is disposable **only if the runtime can rebuild
   it**. Being derived is not the test; who can rebuild it is.
   - Rebuildable by the runtime: a cache. Do not ship it, let it rebuild.
   - Producible only by the authoring environment -- because it needs Studio,
     a network service, or paid work -- it is a **derived artifact**, and it
     ships with the game as an asset. A player's machine cannot make one, so
     "disposable" would mean "the player never gets it".
   Derived artifact is a domain term, defined in
   `packages/plugins/src/catalog/sugarlang/docs/api/domain-terms.md`. The
   baked navmesh is the reference implementation: produced by an authoring
   pass, written to the project's `assets/`, registered in
   `collectFileBackedAssetPaths`, shipped by deploy.
4. Publish artifacts are derived and disposable.
5. Runtime preview and playtest do not require editor-only persistence.
6. A derived store may contain authored content, and **authored content is
   never disposable**. Provenance on the record decides this, not the name of
   the store that holds it. A hand-corrected value written into a generated
   cache is authored, and regenerating that cache must not discard it.

## Consequences

### Positive

- canonical truth remains clear
- runtime load paths stay lean
- editor convenience persistence remains possible without polluting runtime semantics

### Tradeoffs

- persistence boundaries must be designed intentionally
- versioning and migration must account for multiple payload classes
- every generated output now needs one question answered before it is stored:
  can the runtime rebuild this? Getting it wrong in one direction ships bytes
  the player could have made; in the other, it withholds work the player can
  never make. The second failure is silent -- the game degrades instead of
  erroring -- which is why the rule is stated rather than left to judgment.

## Builds On

- [Proposal 006: Persistence and Serialization Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/006-persistence-and-serialization.md)
- [Proposal 003: Sugarmagic Region Document Model](/Users/nikki/projects/sugarmagic/docs/proposals/003-region-document-model.md)
