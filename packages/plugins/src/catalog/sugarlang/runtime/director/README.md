<!--
/Users/nikki/projects/sugarmagic/packages/plugins/src/catalog/sugarlang/runtime/director/README.md

Purpose: Documents the Sugarlang Director runtime module and its ownership boundaries.

Status: active
-->

# Director Runtime

This module owns Sugarlang's pedagogical Director: prompt assembly, Claude-backed
directive generation, schema validation and repair, deterministic fallback, and
conversation-scoped directive caching.

The Director is the single place where Sugarlang reshapes the Budgeter's raw
prescription into a narrative-facing `PedagogicalDirective`. It does not own
learner state, scene compilation, or editor UI. Those systems feed context into
the Director; the Director does not write back into them.

Key files:

- `prompt-builder.ts`: deterministic cacheable-vs-dynamic prompt assembly
- `schema-parser.ts`: strict parse, validation, repair, and hard requirement enforcement
- `claude-director-policy.ts`: Claude invocation boundary and telemetry
- `fallback-director-policy.ts`: deterministic no-LLM fallback
- `directive-cache.ts`: blackboard-backed conversation cache
- `sugar-lang-director.ts`: canonical facade other runtime code should call
