<!--
/Users/nikki/projects/sugarmagic/packages/plugins/src/catalog/sugarlang/runtime/teacher/README.md

Purpose: Documents the Sugarlang Teacher runtime module and its ownership boundaries.

Status: active
-->

# Teacher Runtime

This module owns Sugarlang's pedagogical teacher: prompt assembly, gateway-backed
LLM directive generation, schema validation and repair, deterministic fallback, and
conversation-scoped directive caching.

The teacher is the single place where Sugarlang reshapes the Budgeter's raw
prescription into a narrative-facing `PedagogicalDirective`. It does not own
learner state, scene compilation, or editor UI. Those systems feed context into
the teacher; the teacher does not write back into them.

Key files:

- `prompt-template.ts`: canonical editable prompt templates for system and user prompt structure
- `prompt-builder.ts`: deterministic data formatting and template rendering for Teacher prompts
- `schema-parser.ts`: strict parse, validation, repair, and hard requirement enforcement
- `policies/llm-teacher-policy.ts`: gateway-backed LLM invocation boundary and telemetry
- `policies/fallback-teacher-policy.ts`: deterministic no-LLM fallback
- `directive-cache.ts`: blackboard-backed conversation cache
- `sugar-lang-teacher.ts`: canonical facade other runtime code should call
