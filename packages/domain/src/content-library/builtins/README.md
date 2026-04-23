This module owns the starter content seeded into every fresh project content library.

It exists so Epic 036's built-in Surface Library content has a clear permanent home instead of being hidden inside the monolithic content-library index module. `packages/domain/src/content-library/index.ts` remains the canonical source of truth for the content-library snapshot shape, while `builtins/` owns the reusable default definitions that snapshot construction and normalization merge in.
