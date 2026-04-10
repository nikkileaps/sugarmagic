# Director API

Status: Completed in Epic 9

This document records the public runtime surface the Sugarlang Director owns.

## Entry Point

`SugarLangDirector` is the canonical facade other epics should call.

It owns:

- cache lookup via `DirectiveCache`
- Claude invocation via `ClaudeDirectorPolicy`
- deterministic fallback via `FallbackDirectorPolicy`
- post-placement calibration flagging

Downstream runtime code should not assemble prompt strings or call the Claude
policy directly.

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

## Prompt Structure

`buildDirectorPrompt(context)` returns:

```ts
{
  system: string;
  user: string;
  cacheMarkers: string[];
}
```

Budget split:

- cacheable system prompt: role, pedagogical rubric, CEFR descriptors, output schema, hard constraints, comprehension guidance
- dynamic user prompt: learner summary, lemma summary, scene index, NPC context, moment metadata, recent turns, prescription, pending provisional state, optional quest-essential section

The builder keeps the static comprehension-check guidance in the system prompt
and reserves the dynamic probe-floor / pending-provisional sections for the user
prompt so prompt caching can stay effective.

## Schema Parsing And Repair

`parseDirective(json, { context, telemetry })` performs strict JSON parsing and
schema validation.

`repairDirective(partial, prescription, context)` is deterministic:

- fills missing required fields from prescription-safe defaults
- clamps `targetLanguageRatio` to `[0, 1]`
- drops unknown or malformed fields
- enforces the no-invention rule by filtering `targetVocab` to prescription subsets
- strips any quest-essential lemma that leaked into `targetVocab`
- repairs invalid comprehension-check target lemmas back to the pending list

Hard rejections that force fallback instead of repair:

- hard-floor probe required but `comprehensionCheck.trigger === false`
- quest-essential lemmas present with `glossingStrategy: "hover-only"` or `"none"`

## Claude Implementation

`ClaudeDirectorPolicy` takes an injected Claude client boundary and emits
telemetry for:

- model id
- input and output token counts
- latency
- request id
- parse mode (`validated` or `repaired`)

The default model is `claude-sonnet-4-6`, but the constructor allows an
override for cheaper runs such as Haiku.

## Fallback Policy

`FallbackDirectorPolicy` is deterministic and never calls an LLM.

Rule summary:

- posture comes from learner confidence
- glossing becomes `parenthetical` when quest-essential lemmas are present
- glossing otherwise prefers `inline` when introduces exist
- sentence complexity tracks learner CEFR
- soft and hard probe floors drive comprehension-check triggering
- fallback output is always flagged with `isFallbackDirective: true`

## Cache And Invalidation

`DirectiveCache` stores the active directive on the conversation-scoped blackboard
using `ACTIVE_DIRECTIVE_FACT`.

Current validity rules:

- the cached entry is usable for `directiveLifetime.maxTurns` reads
- quest stage changes invalidate all active conversation directives
- location changes invalidate all active conversation directives
- affective changes invalidate all active conversation directives
- manual invalidation is supported for explicit middleware control

## Post-Placement Calibration Hint

The old Director-owned placement flow is gone. The only remaining calibration
concept is a small post-placement warm-up hint:

- `isInPostPlacementCalibration(learner)` returns true for recently evaluated,
  low-confidence learners with fewer than 10 session turns
- `buildPostPlacementCalibrationHint()` appends a short cautionary addendum to
  the normal user prompt

This is a soft hint only. It does not create a second Director prompt pathway.

## Important Channels

- `comprehensionCheck`: load-bearing probe contract for observer-latency handling
- `questEssentialLemmas`: separate mandatory channel for active-objective vocabulary
- `prePlacementOpeningLine`: explicit pipeline-bypass field for the opening dialog phase of placement

## Provider Boundary

The Director is invoked through `DirectorPolicy.invoke(context)` from the ADR 010
provider contract. The Director consumes middleware-assembled context and does
not reach back into domain or editor-only systems.

## Language Data Boundary

The Director does not load plugin language files directly. It consumes Budgeter
prescriptions and middleware-assembled context that were already shaped by the
lexical atlas and learner state. Placement banks remain outside the Director:
the plugin-owned questionnaire flow lives under `runtime/placement/`.
