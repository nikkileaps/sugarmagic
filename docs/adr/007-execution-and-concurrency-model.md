# ADR 007: Execution and Concurrency Model

**Status:** Accepted
**Date:** 2026-03-31

## Context

On the web, a unified authoring/runtime application can easily overload the main thread.

At the same time, concurrency must not create multiple competing implementations of the same behavior.

## Decision

Sugarmagic will use a thin render host plus worker-backed heavy jobs.

`Single enforcer` means one authoritative implementation and contract, not one thread.

Heavy deterministic work should be designed worker-friendly from the start when it threatens frame time.

## Rules

1. The render host owns frame-sensitive runtime state and GPU-facing object finalization.
2. Heavy deterministic computation should move to worker-backed jobs where practical.
3. Workers operate on snapshots and return deltas or derived outputs.
4. Workers do not mutate live runtime state directly.
5. Stale results are dropped through generation-based validation.
6. WASM is allowed behind the same job contracts when profiling justifies it.

## Consequences

### Positive

- live authoring stays responsive under heavier workloads
- one semantic implementation can scale across web constraints
- publish and import work no longer need to compete with frame rendering

### Tradeoffs

- concurrency contracts must be designed intentionally
- more explicit scheduling and cancellation infrastructure is required

## Builds On

- [Proposal 007: Execution and Concurrency Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
- [Proposal 005: Sugarmagic System Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)
