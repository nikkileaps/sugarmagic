# Director API

Status: Updated in Epic 3; expanded further in Epic 9

This document records the public contract surface the Director owns.

## Output Contract

- `SupportPosture`
- `InteractionStyle`
- `GlossingStrategy`
- `SentenceComplexityCap`
- `ProbeTriggerReason`
- `ComprehensionCheckSpec`
- `DirectiveLifetime`
- `PedagogicalDirective`
- `SugarlangConstraint`

`PedagogicalDirective` is the Director's raw structured output. `SugarlangConstraint`
is the merged payload the middleware pipeline passes to SugarAgent's Generator
splice.

## Important Channels

- `comprehensionCheck`: load-bearing probe contract for Observer-latency handling.
- `questEssentialLemmas`: separate mandatory channel for active-objective vocabulary.
- `prePlacementOpeningLine`: explicit pipeline-bypass field for the opening dialog phase of placement.

## Provider Boundary

The Director is invoked through `DirectorPolicy.invoke(context)` from the ADR 010
provider contract. Prompt-building, schema parsing, caching, and fallback
behavior all sit behind that seam in later epics.

## Language Data Boundary

The Director does not load plugin language files directly in Epic 4. It consumes
Budgeter prescriptions and middleware-assembled context that were already shaped
by the lexical atlas and learner state. Placement banks are intentionally not a
Director concern: the plugin-owned placement questionnaire lives under
`runtime/placement/` and bypasses the Director during the opening-dialog phase.
