# ADR 008: Material Semantics and Compile Profiles

**Status:** Accepted
**Date:** 2026-03-31

## Context

Sugarmagic needs one material semantics system for authored trust, but web delivery and authoring preview have different compile-time needs.

If editor and runtime use separate semantic compilers, they will drift.

If every context uses the same undifferentiated compile mode, debug and inspection variants will pollute production behavior and GPU memory.

## Decision

Sugarmagic will use:

- one semantic material compiler
- one normalization and validation layer
- one normalized material IR
- multiple compile profiles

The initial compile profiles are:

- `Authoring Preview Profile`
- `Runtime Preview Profile`
- `Published Target Profile`

Runtime preview is the default visual-truth profile.

Publish may use AOT-oriented warmup and specialization. Authoring remains JIT-friendly.

## Rules

1. Semantic material meaning remains singular.
2. Compile profiles are allowed to differ by debug capability, optimization, and cache policy.
3. Debug and inspection variants are profile-scoped and non-canonical.
4. Published targets must not receive authoring-only debug variants by default.
5. Cache namespaces must include compile profile identity.

## Consequences

### Positive

- material meaning stays consistent across authoring, preview, and publish
- shader/profile leakage is contained
- the web pipeline can optimize without semantic drift

### Tradeoffs

- material compilation architecture becomes more explicit
- cache policy and profile policy need deliberate implementation

## Builds On

- [Proposal 009: Material Compilation and Shader Pipeline Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/009-material-compilation-and-shader-pipeline.md)
- [Proposal 007: Execution and Concurrency Architecture](/Users/nikki/projects/sugarmagic/docs/proposals/007-execution-and-concurrency-architecture.md)
