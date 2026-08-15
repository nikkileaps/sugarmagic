# SugarAgent -- Judge

How a generated NPC reply is scored before the player sees it, what the judge is
given to score against, and what a failure costs. Companion to
`npc-knowledge-model.md` (identity / knowledge / voice) and `npc-memory.md`
(per-player memory); both describe material the judge now receives.

## Where it sits

The turn runs Interpret -> Retrieve -> Plan -> Generate -> **Judge** -> Audit ->
Regenerate (`runtime/provider.ts`). Judge reads what Generate produced and
decides whether it ships. A failed verdict is what gives Regenerate something to
repair.

## What the judge is given

**What the writer knew, and not the writer's brief.**

Every line of the prompt declares which of the two it is where it is written
(`PromptPart`, `runtime/stages/generate/prompt/builder.ts`):

- **fact** -- something true of the world, the NPC or the conversation: the
  persona card, all core knowledge, the memory digest, world state, retrieved
  evidence, the recent conversation, and what the player just said.
- **instruction** -- how to reply this turn: the intent and goal lines, the
  shape directives (`Ask one concise clarifying question`, `Keep the reply
  generic`), the language overlay, the drift reminder.

The writer receives both, in the order they are listed. `judgeContext` is the
system half -- which is facts throughout -- plus the facts from the user half.
GenerateStage carries it on `GenerateResult.judgeContext`, JudgeStage passes it
through as `JudgeRequest.context`, and the gateway puts it at the top of the
judge prompt unchanged.

Withholding the brief is deliberate. A judge that can see the instructions can
excuse a bad reply on the grounds that it was told to be brief, or generic, or
to abstain, and the brief is not evidence the reply could be checked against.
Classification happens once, at the point the line is written, so a line added
later is correct for both callers without a second list to maintain.

One slot changes kind by branch: `Player said: ...` is a fact, while the
opening-turn text that replaces it when there is no player text is an
instruction.

This is one construction, not two. The judge does not assemble its own view of
the turn, and `JudgeRequest` carries no persona digest, world premise, lore
summary or response intent -- each of those was a partial restatement of
something already in the prompt, and a second statement of a fact is a second
thing to keep true.

`context` is required. The gateway answers 400 when it is missing rather than
scoring against nothing, so a browser bundle and a gateway must be deployed
together. Regenerating `core.compiled.ts` is not a deploy; the running gateway
has to be replaced too.

### Why the facts, all of them

Grounding cannot be checked without the grounding. Measured against a live
gateway, replies in full character voice that contradicted only facts outside a
persona summary -- an NPC naming the wrong wife, an NPC greeting a returning
player as a stranger -- passed 10 times out of 10 when the judge held a summary,
and failed 10 out of 10 when it held the page.

The bound on this: a reply that faithfully uses a bad piece of retrieved
evidence is judged against that same bad evidence and passes. The judge checks
the reply against its context; it does not check the context. Keeping the
evidence pack clean is therefore load-bearing for the verdict as well as for the
reply.

## The rubric

Three items, all of which must pass (`buildJudgeUserPrompt`,
`deployment/gateway/core.ts`):

1. **IN-CHARACTER** -- matches the persona voice, temperament and knowledge level.
2. **WORLD-GROUNDED** -- introduces no facts incompatible with what the NPC knew.
3. **SAFETY** -- no references to the real world, game mechanics, the AI, or secrets.

The judge answers through a `score_reply` tool call, so the verdict is structured
rather than parsed out of prose.

## Contributed directives

A co-installed plugin can add scoring instructions through the contribution bus
(`runtime/contributions.ts`); JudgeStage forwards them as `externalDirectives`.
When present the prompt gains a directive block stating the behaviour they
direct is in-world by definition, rubric 1 gains a matching guard sentence, and
the block closes with a prohibition on overriding SAFETY. With no directives the
prompt is the plain three-item rubric -- sugaragent runs without any language
plugin and must not be asked about a player level nobody stated.

sugarlang uses this to tell the judge that mixed-language output is intended.

## The language dimension

Present only when directives are. The judge reports `languageFit` and a
`languageNote`: could this player read the reply, and did it teach them what it
was meant to.

The gateway keeps it out of the rubric verdict. `enforceLanguageReportingOnly`
(`deployment/gateway/core.ts`) strips a language label out of `violations` and
restores `passed`, structurally, because the model has been observed listing one
as a violation despite the prompt telling it not to.

Whether a language failure stops the turn is then decided in the plugin, not the
gateway: JudgeStage fails the turn when `languageFit` is false **and** a note
explains why. A bare false with no note does not gate, because Regenerate would
have nothing to act on and a blind retry costs seconds to reroll the same dice.

## What a failure costs

A failed verdict routes to Regenerate, which rewrites once using `repairHint`.

Two governors watch repeated failures, and both distinguish kinds of failure:

- `consecutiveJudgeFailures` (`runtime/provider.ts`) -- at 3, Regenerate ships a
  generic fallback line instead of rewriting.
- `isStalledTurn` -- at 3, the conversation force-closes.

A **language-only** failure (`languageOnlyFailure`, reason
`judge-language-fail`) is excluded from both. The remedy they apply is a canned
template, which is not better teaching than the line it would replace, and
hanging up ends a session the player did nothing to break.

## When the judge does not run

`JudgeResult.skipped` is true, and the reply ships unscored, when:

- Generate produced no LLM text (`usedLlm === false`) -- the deterministic paths
- no judge provider is configured (no gateway URL)
- Generate built no prompt, so there is nothing to score against

Separately, a regex lint for meta-leak patterns (`runtime/stages/helpers.ts`)
fails the reply without an LLM call, since text that is structurally broken does
not need a model to notice.

## When the judge breaks

Fail-open. A provider error returns `passed: true` with `errorOccurred: true`
and reason `judge-error`, which `isStalledTurn` excludes -- a judge outage
degrades the check, it does not close players' conversations.

## Model and observability

The route is `POST /api/sugaragent/generate/judge`. The model comes from
`SUGARMAGIC_SUGARAGENT_JUDGE_MODEL` (default `claude-haiku-4-5`), which is a
different and cheaper model than the dialogue one, so it does not share the
generate prompt cache.

The gateway logs `sugaragent.judge` per call: the verdict, the violations, the
repair hint, the language fields, duration, and `contextChars` -- how much
grounding the judge actually held, which is the one number that makes "scoring
against far less than the writer saw" visible from outside.

In the browser, the turn timeline records `judge=pass` or
`judge=FAIL:<violations>`, plus `judgeLanguageFit` on every turn it is returned.
Absence of that field means an older gateway, and only that.
