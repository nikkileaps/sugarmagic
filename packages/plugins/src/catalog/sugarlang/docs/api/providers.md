# Provider API

Status: Updated in Epic 3

This document records the ADR 010 provider boundaries:

- `LexicalAtlasProvider`
- `LearnerPriorProvider`
- `DirectorPolicy`

## One-Way Dependency Rules

- `LexicalAtlasProvider` never imports from learner-prior or director implementations.
- `LearnerPriorProvider` never imports from director implementations.
- `DirectorPolicy` may depend on atlas and learner contracts, but never writes back into them.

Epic 3 also wires an architectural test that checks:

- `runtime/contracts/providers.ts` does not import from `runtime/director/`, `runtime/budgeter/`, or `runtime/learner/`
- files under `runtime/providers/impls/` do not import from `runtime/director/` or `runtime/middlewares/`

## Public Types

- `AtlasLemmaEntry`
- `PendingProvisional`
- `ProbeFloorState`
- `ActiveQuestEssentialLemma`
- `DirectorNpcContext`
- `DirectorRecentTurn`
- `DirectorLanguageContext`
- `DirectorContext`

These types define the full shape of data crossing the provider seams before any
later implementation logic lands.

## Epic 4 Implementation Notes

Epic 4 fills in the lexical-atlas side with
`runtime/providers/impls/cefr-lex-atlas-provider.ts`.

- Source of truth: `data/languages/<lang>/cefrlex.json`
- Load timing: lazy, cached in memory after first lookup
- Failure mode: throw immediately if the requested language is missing or malformed
- Versioning: `getAtlasVersion(lang)` surfaces the file's `atlasVersion` so
  compile and cache code can include it in invalidation keys

The current checked-in atlas snapshots cover Spanish and Italian and can be
loaded independently without shared mutable state or language collision.
