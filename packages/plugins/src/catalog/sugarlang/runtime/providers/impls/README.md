# Provider Implementations

This directory contains concrete ADR 010 provider implementations for sugarlang.

Current responsibilities:
- `cefr-lex-atlas-provider.ts`: read-only lexical atlas access
- `fsrs-learner-prior-provider.ts`: deterministic learner/card seeding from atlas priors
- `blackboard-learner-store.ts`: read-only learner-state access from the runtime blackboard

Dependency rule:
- provider implementations may depend on contracts, loaders, and learner helpers
- provider implementations must not depend on director prompt logic or middleware assembly

The read side lives here; the learner-state write side lives in `runtime/learner/`.
