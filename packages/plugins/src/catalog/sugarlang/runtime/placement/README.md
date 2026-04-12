# Sugarlang Placement Runtime

This module owns the plugin-side placement capability.

- `placement-questionnaire-loader.ts` loads the canonical plugin-shipped questionnaire per language.
- `placement-score-engine.ts` deterministically scores a submitted questionnaire into a CEFR estimate plus seeded lemmas.
- `placement-flow-orchestrator.ts` owns the small placement phase state machine and the reducer event builder used at completion time.

This runtime is intentionally separate from the Director and normal turn pipeline. Placement is a deterministic questionnaire wrapped in dialog, not an LLM calibration loop.
