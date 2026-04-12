# Provider API

Status: Updated in Epic 7

This document records the ADR 010 provider boundaries:

- `LexicalAtlasProvider`
- `LearnerPriorProvider`
- `TeacherPolicy`

## One-Way Dependency Rules

- `LexicalAtlasProvider` never imports from learner-prior or teacher implementations.
- `LearnerPriorProvider` never imports from teacher implementations.
- `TeacherPolicy` may depend on atlas and learner contracts, but never writes back into them.

Epic 3 also wires an architectural test that checks:

- `runtime/contracts/providers.ts` does not import from `runtime/teacher/`, `runtime/budgeter/`, or `runtime/learner/`
- files under `runtime/providers/impls/` do not import from `runtime/teacher/` or `runtime/middlewares/`

## Public Types

- `AtlasLemmaEntry`
- `PendingProvisional`
- `ProbeFloorState`
- `ActiveQuestEssentialLemma`
- `TeacherNpcContext`
- `TeacherRecentTurn`
- `TeacherLanguageContext`
- `TeacherContext`

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

## Epic 7 Read-Side Implementations

Epic 7 adds the learner-side provider implementations:

- `runtime/providers/impls/fsrs-learner-prior-provider.ts`
  Responsibility: deterministic seeding of `LemmaCard` values and CEFR posterior
  priors from the lexical atlas
- `runtime/providers/impls/blackboard-learner-store.ts`
  Responsibility: read-only access to the current learner profile plus delegated
  learner-prior helpers

`BlackboardLearnerStore` is intentionally read-only. It may load and clone the
current profile, but it does not write back into the blackboard. The single
writer remains `LearnerStateReducer` in `runtime/learner/`.
