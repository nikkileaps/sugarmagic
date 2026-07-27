# API 014: SugarAgent Lifecycle Contributions

## Purpose

This document covers the annotation-bus contribution contract that lets any
plugin extend SugarAgent behavior at generate, judge, regen, audit, and
interpret time -- without importing sugaragent or building a direct dependency.

## The Contribution Bus

**File:** `packages/plugins/src/catalog/sugaragent/runtime/contributions.ts`

Any plugin can write a `SugaragentContribution` object to the annotation bus at
prepare time under the key `sugaragent.contrib/<your-plugin-id>`. SugarAgent
collects, validates, and merges all contributions once per pipeline stage.
Unknown fields and unknown plugin IDs are silently ignored. Zero contributions
produces byte-identical behavior to a baseline build with no contributing plugins.

This is the only sanctioned extension mechanism. Never reach inside SugarAgent's
stage implementations directly; fix the infrastructure instead.

## Writing a Contribution

```typescript
// In your plugin's prepare middleware, before the provider generates:
execution.annotations["sugaragent.contrib/my-plugin"] = {
  schemaVersion: 1,                      // required; must be exactly 1
  generateOverlay: "...",                // injected into the generator user-message
  generateReminder: "...",               // injected near the end of the generator prompt
  judgeDirectives: ["..."],              // non-violation guidance for the judge
  regenDirectives: ["..."],              // constraint directives for regen after a judge fail
  textConventions: { preserveActionTags: true },  // asterisk spans survive hygiene
  interpretLexicon: {                    // target-language surface forms by intent category
    farewell: ["adios", "hasta luego"],
    greeting: ["hola", "buenos dias"],
    gratitude: ["gracias"],
    acknowledgement: ["si", "claro"],
  }
};
```

`schemaVersion: 1` is the current version; the validator drops any object that
omits it or sets it to a different value. All other fields are optional.

The annotation key format is strict: `sugaragent.contrib/<pluginId>` where
pluginId is any non-empty string matching what you want logged in the warning
path. The sugarlang plugin uses `sugaragent.contrib/sugarlang`.

## Merge Semantics

`collectContributions(execution.annotations)` is called once per stage by each
stage that reads contributions. All contributors are sorted by pluginId
(lexicographic) before merging, so the merged result is deterministic regardless
of annotation insertion order.

| Field | Merge rule |
|---|---|
| `generateOverlay` | Blank-line joined, in pluginId order |
| `generateReminder` (DEFERRED 083.5) | Blank-line joined, in pluginId order -- NOT YET WIRED to the generator prompt |
| `judgeDirectives`, `regenDirectives` | Concatenated arrays, in pluginId order |
| `textConventions.preserveActionTags` | Boolean OR across all contributors |
| `interpretLexicon` | Union per category; duplicate forms not removed |

`MergedContributions` is the consumed shape:

```typescript
interface MergedContributions {
  mergedOverlay: string;           // empty string if no overlay contributions
  mergedReminder: string;          // empty string if no reminder contributions
  judgeDirectives: string[];
  regenDirectives: string[];
  preserveActionTags: boolean;
  interpretLexicon: Record<string, string[]>;
}
```

## Where Each Surface Is Consumed

| Surface | Stage | File | Effect |
|---|---|---|---|
| `generateOverlay` | GenerateStage | `generate/GenerateStage.ts` | Passed as `languageLearningOverlay` in `promptContext`; spliced verbatim into the generator user-message |
| `generateReminder` (DEFERRED 083.5) | GenerateStage | `generate/GenerateStage.ts` | NOT YET WIRED. The field is collected but `mergedReminder` is not read by GenerateStage; the terminal drift-reminder splice lands in story 083.5. |
| `judgeDirectives` | JudgeStage | `JudgeStage.ts` | Directives forwarded to `judgeNpcReply`; behavior directed by these is treated as in-character and never flagged as a violation |
| `regenDirectives` | RegenerateStage | `RegenerateStage.ts` | Concatenated with `mergedOverlay` into a `constraintBlock` prepended to the regen user-message; preserved constraints after a judge fail |
| `preserveActionTags` | RegenerateStage, AuditStage | `RegenerateStage.ts`, `AuditStage.ts` | When true: asterisk spans (`*waves*`) survive `normalizeNpcSpeech` and are not flagged by `findStageDirectionViolations` |
| `interpretLexicon` | InterpretStage, AuditStage | `InterpretStage.ts`, `AuditStage.ts` | Target-language forms used for farewell/greeting/gratitude/acknowledgement detection in `detectSocialMove`; suppresses English-cue audit violation when present |

## Prompt Placement

**Cache hygiene.** The system prompt is session-stable and cached per session
key. Per-turn content must NEVER be injected into the system prompt. The
contribution surfaces follow this rule:

- `generateOverlay` goes into the GENERATOR USER-MESSAGE (per-turn, uncached).
  The generator builds a new user message every turn; the
  system prompt does not change.
- `regenDirectives` go into the REGEN USER-MESSAGE (per-turn uncached by
  construction since regen is triggered on specific turns only).

Violating this rule would bust the stable session cache and force a full
context re-send on every turn. Do not add contribution surfaces to the system
prompt.

## `interpretLexicon` Intent Categories

The supported categories are defined by `detectSocialMove` in
`runtime/stages/interpretation.ts`:

| Category | Meaning |
|---|---|
| `farewell` | Player is ending the conversation |
| `greeting` | Player is opening |
| `gratitude` | Player says thanks |
| `acknowledgement` | Player affirms / agrees |

Unknown categories are validated by `collectContributions` (arrays only; non-array
category values are dropped). The category mechanism is the extensibility seam
for future intent types (see DEFERRED comment in `interpretation.ts`).

Surface forms are matched case-insensitively after NFD diacritic normalization
(`nfdStrip`) with word-boundary anchors, so `"adios"` matches player input
containing `"adiós"`.

## `preserveActionTags` and the textConventions Contribution

`textConventions: { preserveActionTags: true }` is the contribution the
sugarlang teacher middleware writes when the target-language config includes
action-tag conventions (see Plan 083.3). When this flag is merged true:

- `normalizeNpcSpeech` skips the asterisk strip (bracket strip still applies).
- `findStageDirectionViolations` filters out `contains-asterisk-stage-direction`.
- Regen re-lint applies the same filter.

Without this flag (no contributing plugin, or no plugin sets it true), the
behavior is byte-identical to pre-084: asterisks are stripped as stage directions.

## Flow Control vs Contribution

The annotation bus is for DATA contributions only. Contributions describe what
the NPC should do, not how the pipeline should run. Flow-control decisions
(skip repair, bypass verify, change stage execution order) belong in the stage
implementations based on `turn.diagnostics` or other runtime contracts -- not
in contribution fields. If you find yourself wanting a `skipRegen: boolean`
contribution field, you are working at the wrong seam.

## Zero-Contribution Invariant

`collectContributions` returns the `EMPTY` sentinel object when no valid
contributions are present. Every consumer must behave identically to the
pre-084 baseline when given `EMPTY`. This invariant is tested:
`regenerate-stage.test.ts` pins that regen prompt and maxTokens are
byte-identical to baseline when no contributions are annotated.
