<!--
/Users/nikki/projects/sugarmagic/packages/plugins/src/catalog/sugarlang/runtime/middlewares/README.md

Purpose: Documents the Sugarlang conversation middleware module and its ownership split.

Status: active
-->

# Middleware Runtime

This module owns the four Sugarlang conversation middlewares:

- `sugar-lang-context-middleware.ts`
- `sugar-lang-director-middleware.ts`
- `sugar-lang-verify-middleware.ts`
- `sugar-lang-observe-middleware.ts`

Together they form Sugarlang's runtime pipeline:

1. context writes turn-scoped annotations
2. director merges those annotations into the final `SugarlangConstraint`
3. verify keeps the generated turn inside the learner envelope
4. observe converts turn/input behavior into learner-state events

`shared.ts` is the single local source of truth for middleware-owned annotation
keys and session-state keys so the four files do not drift.
