# Budgeter Runtime Module

This module owns sugarlang's lexical scheduling logic.

Source of truth:
- observation interpretation lives in `observations.ts`
- receptive/productive card updates live in `fsrs-adapter.ts`
- scoring logic lives in `scoring.ts`
- prescription assembly lives in `lexical-budgeter.ts`

Single enforcer:
- `LexicalBudgeter.prescribe()` is the only budgeter entry point

The Budgeter reads learner state and compiled scene lexicons but does not write
learner state. Writes stay in `runtime/learner/`.
