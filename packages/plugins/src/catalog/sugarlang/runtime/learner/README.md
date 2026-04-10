# Learner Runtime Module

This module owns sugarlang's learner-state write path and persistence helpers.

Source of truth:
- `LearnerProfile` in the blackboard for the live runtime view
- `CardStore` for persisted lemma-card durability

Single enforcer:
- `LearnerStateReducer` is the only supported writer of the learner profile fact

Primary responsibilities:
- CEFR posterior math
- session-signal derivation
- learner-profile save/load helpers
- blackboard fact definitions
- card-store implementations

This module is runtime-only. Editor UI must not depend on its internals.
