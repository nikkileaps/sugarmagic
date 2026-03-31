# `packages/io`

Game-root, persistence, import, export, and publish boundaries.

Owns:

- game-root discovery
- canonical document load/save
- import boundaries
- compatibility export boundaries
- publish boundaries

Does not own:

- domain meaning
- runtime semantics

References:

- [ADR 005: Persistence Strata](/Users/nikki/projects/sugarmagic/docs/adr/005-persistence-strata.md)
- [API 002: `/packages/io` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
