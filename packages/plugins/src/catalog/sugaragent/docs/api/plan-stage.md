# SugarAgent -- Plan

How the pipeline decides what KIND of reply to write, before any words are
generated. Companion to `judge.md` (how the finished reply is scored) and
`npc-knowledge-model.md` (where an NPC's knowledge comes from).

## Where it sits

    Interpret -> Retrieve -> PLAN -> Generate -> Judge -> Audit -> Regenerate

Interpret reads the player's message. Retrieve searches the lore wiki. Plan
takes both, plus what the NPC already carries, and picks the shape of the reply.
Generate turns that choice into the `Intent:` and `Goal:` lines of the prompt.

Plan writes no prose and calls no model. It is a pure decision:
`resolvePlanDecision` in `runtime/stages/planning.ts`, called by
`runtime/stages/PlanStage.ts`.

## What Plan receives

    - what the player typed
    - Interpret's read of it: the intent, and whether the question is about the
      NPC, about the world, or about someone else
    - did the search find anything            (hasEvidence)
    - does the NPC remember this player       (hasMemory)
    - is a lore page loaded, with content      (hasPersonaPage)
    - names in the message that nothing        (unknownNamedEntities)
      in reality recognises
    - is a quest active, did quest lore resolve, is a scripted line waiting
    - the conversation so far
    - the NPC's recovery moves, from its `## Recovery` section
    - clarifying questions asked since the last real exchange
    - recovery moves made so far this conversation (indexes the list)

## Step 1 -- work out what there is to go on

    memoryGrounds  = has memory AND (player said nothing OR asked "do you remember me")
    personaGrounds = has a lore page AND the question is about the NPC or the world
    questGrounds   = quest lore resolved AND a quest is active
    namedSomethingUnreal = the message named something reality does not recognise

## Step 2 -- pick the kind of reply. First match wins

    if the player typed nothing         -> GREET
    else if they said goodbye           -> GOODBYE
    else if they named something                     -> ABSTAIN
         reality does not recognise
    else if they asked for quest help   -> REDIRECT when there is evidence, an
                                           active quest, or a scripted line
                                           otherwise CLARIFY
    else if the turn is small talk      -> CHAT
    else if the message is unclear      -> CLARIFY
    else if it is a knowledge question  -> ANSWER when there is evidence,
                                           memory, or its own page
                                           otherwise ABSTAIN
    otherwise                           -> ANSWER

The unreal-name check sits THIRD, above everything conversational. It began
inside the knowledge branch, and any turn landing elsewhere skipped it: an
identical message reached `clarify` instead and the NPC answered "that name's
ringing a bell, but like, faintly" about a shop that does not exist. Whether the
player named something real is a fact about the message, not about which
conversational shape the turn happens to take.

Only GREET (no message to check) and GOODBYE (they are leaving) come first.

## Step 3 -- one clarifying question, then the character does something

    if the reply is CLARIFY
       AND the NPC has already asked once since the last real exchange
           -> RECOVER, plus one move from the NPC's `## Recovery` list

Placed after the whole ladder, so all three routes to CLARIFY are capped by one
rule -- including the route derived from the NPC's own previous reply. A
recovery move containing the word "which" sets a clarify expectation for the
next turn; without the cap sitting above that, the conversation alternates
between asking and recovering forever.

Asking once is deliberate. It gives a language learner a second try at saying
it. Asking twice cannot succeed: on an unclear turn with no evidence the NPC has
nothing to answer from.

The move comes from the character's `## Recovery` section, walked in written
order and wrapping, so several authored moves are used in turn. A character with
no section gets `self-disclosure` -- never `curt-exit`, which would make every
unwritten character walk away.

A move with nothing behind it is dropped from the menu before selection rather
than attempted. Today that is `gossip`, which is about the player and so needs
the project to have said who the player is. A character whose whole list is
unavailable falls to `self-disclosure`.

## Step 4 -- one override, for going in circles

    if there is no evidence AND the conversation is repeating itself
       AND the reply is not already GOODBYE, REDIRECT, ABSTAIN or RECOVER
           -> RECOVER, using the same move selection as step 3

This is about repetition, not knowledge, which is why it ignores everything
step 2 decided.

It runs after the cap and never undoes it. A turn can be both unclear and
repeating; when it is, the move chosen in step 3 wins, because turning it back
into a clarifying question is the loop this whole design removes. ABSTAIN is
exempt for a different reason: an NPC that should say "I have never heard of
Brindlebear's Book Emporium" must not change the subject instead.

**When this can fire, measured.** "Repeating itself" needs both halves: the
player repeating their message word for word, AND two of the NPC's last three
replies collapsing to one string. A generated reply is never byte-identical to
an earlier one, so the second half only happens when the NPC is already on the
deterministic canned path -- no lore page, no evidence. Driven against a live
gateway on 2026-08-30, an NPC with a page never triggered it across six
identical player turns; an NPC without one triggered it on the fourth.

So this branch only ever affects characters nobody has written a page for. What
it changes is what the interrupting turn says: it stops asking a player who is
plainly out of words to supply more, and hands them something to react to. It
does not fix the underlying repetition -- the following turn returns to the
canned path.

## Step 5 -- decide how specific the reply may be

    if nothing grounded the turn (no evidence, no memory, no quest lore)
       AND the reply is GREET, CHAT or ANSWER
           -> "generic-only"    (stay vague, do not reach for detail)
    else   -> "grounded"

RECOVER is not in that list, so a recovery turn is always grounded. That is
load-bearing rather than incidental: a generic-only reply counts toward the
three-strike close, so a borrowed CHAT intent would have closed the conversation
after three recoveries.

KNOWN WRINKLE: `hasPersonaPage` is not in that list either. A turn grounded only
by the NPC's own page is still told to stay generic. Nothing observed has
depended on it, but it is inconsistent with step 2, which does count the page.

## Step 6 -- what Plan hands back

    - the kind of reply       -> becomes "Intent:" in the generate prompt
    - the recovery move       -> present only on a RECOVER turn
    - how specific to be      -> grounded vs generic
    - the goal sentence       -> becomes "Goal:" in the generate prompt
    - who speaks next, what the input box does, its placeholder
    - the repetition state, carried into the next turn

## Five conversations

What the steps above add up to, turn by turn. `count` is the clarifying
questions asked since the last real exchange.

**1. A confused player and a character whose list is `change-subject`,
`playful-probe`.**

| turn | player says | reply | move | count | conversation |
|---|---|---|---|---|---|
| 1 | "qqq zzz" | CLARIFY | -- | 1 | open |
| 2 | "qqq zzz" | RECOVER | `change-subject` | 1 | open |
| 3 | "qqq zzz" | RECOVER | `playful-probe` | 1 | open |
| 4 | "qqq zzz" | RECOVER | `change-subject` | 1 | open |

One question for the whole run of confusion. The list wraps.

**2. The same player, a character whose list is `curt-exit`.**

| turn | player says | reply | move | count | conversation |
|---|---|---|---|---|---|
| 1 | "qqq zzz" | CLARIFY | -- | 1 | open |
| 2 | "qqq zzz" | RECOVER | `curt-exit` | 1 | closes |

The exit sets a close proposal and a 2.2s auto-close. The line is generated from
the character's page; the player never reads one written by the engine.

**3. The same player, a character with no `## Recovery` section.**

| turn | player says | reply | move | count | conversation |
|---|---|---|---|---|---|
| 1 | "qqq zzz" | CLARIFY | -- | 1 | open |
| 2 | "qqq zzz" | RECOVER | `self-disclosure` | 1 | open |
| 3 | "qqq zzz" | RECOVER | `self-disclosure` | 1 | open |

Never closes. Nothing varies the content between turns 2 and 3 -- the novelty
signals that could are computed every turn and branched on by nothing.

**4. Confusion, then the player gets it right.**

| turn | player says | reply | move | count | conversation |
|---|---|---|---|---|---|
| 1 | "qqq zzz" | CLARIFY | -- | 1 | open |
| 2 | "qqq zzz" | RECOVER | `change-subject` | 1 | open |
| 3 | "hello!" | CHAT | -- | **0** | open |
| 4 | "hjkl" | CLARIFY | -- | 1 | open |

The count is HELD by a recovery move and CLEARED by a real exchange. Holding is
what makes one run of confusion yield one question; clearing is what stops the
count going stale, so a player who gets back on track still earns their question
the next time they are lost.

**5. The model goes down.**

| turn | reply | fallback count | conversation |
|---|---|---|---|
| 1 | canned, degraded | 1 | open |
| 2 | canned, degraded | 2 | open |
| 3 | canned, degraded | 3 | closes |

Untouched by any of the above. A fixed line survives here and only here, because
without a model there is nothing to render a character voice with. A recovery
turn never contributes to this counter, per step 5.

## Two questions, not one

Two independent things are asked, and keeping them apart is the whole point:

1. **Did the player name something reality does not recognise?** Then it does
   not exist, and no amount of self-knowledge makes it exist. Asked at the top
   of the ladder, so it wins outright -- over retrieved evidence too, because
   evidence about the rest of the sentence says nothing about the name.
2. **Otherwise, is there anything to answer FROM?** The search, memory, or the
   NPC's own page. This is the knowledge branch near the bottom.

Reality here means the wiki, the quest and the scene. `findUnrecognisedNames`
(`planning.ts`) checks the player's message against what reality supplied: the
NPC's page, the retrieved evidence, the quest context, the NPC's own name, and
its persisted memory of this player.

THE CONVERSATION IS DELIBERATELY NOT IN THAT CORPUS. `provider.ts` pushes the
player's message into history before Plan runs, so including history let the
player's own sentence vouch for itself and the check could never fire on the one
thing it exists to check. The NPC's reply leaks the same way: "never heard of
Brindlebear's Book Emporium" would make that name real for the rest of the
session. A player can type anything; typing it does not make it exist.

THE PLAYER'S OWN NAME IS AN EXCEPTION, and the only one. A player has authority
over who they are and none over what exists, so a self-introduction is reality
and an arbitrary mention is not. `state.playerDeclaredNames` accumulates
Interpret's `declaredIdentityName` -- the "my name is X" / "I'm X" patterns --
as the player offers them, and those names are in the corpus.

The distinction is the whole point, and it is narrow by construction: only the
introduction patterns feed that list. "My name is Mim Featherstone" makes
Featherstone real. "Do you know Brindlebear's Book Emporium?" does not make the
Emporium real, however many times it is said.

### Why the two must stay apart

`hasEvidence` answers "did the search return rows". That is not the same
question as "is the thing the player named real", and collapsing them produces
a bug in whichever direction the flag is set.

Both directions have been observed in play. With only the search consulted, an
NPC refused to confirm it owned a shop that its own page describes -- the search
deliberately excludes the NPC's own page (`RetrieveStage`, `excludeOwnPage`), so
that flag could never speak for it. With the page then counted for world
questions, the same NPC claimed to have visited a building invented for a test,
in 16 of 20 replies.

"Do you have a cheese shop?" and "Have you been to the Brindlewick Observatory?"
arrive identically: same intent (`lore_world`), same target, same empty search.
Interpret cannot tell them apart, so the distinction cannot come from there.
What separates them is whether reality recognised the name.

### The name check is deliberately narrow

`findUnrecognisedNames` fires only on MULTI-WORD capitalised names -- "Gilded
Teacup", "Rackwick City". Single words are ignored on purpose: "Spanish", a
player's name, and every sentence-opening word are all single capitals, and
refusing on those would refuse half a conversation. A missed one-word invention
leaves prior behaviour; a false positive brings back an NPC denying its own
life. The narrow rule fails in the safe direction.

A leading article is stripped so "The Gilded Teacup" and "Gilded Teacup" are one
name. If stripping leaves a single word, the candidate is dropped.

### The refusal names the thing

An ABSTAIN caused by an unrecognised name gets a different goal from an ABSTAIN
for want of context:

    You have never heard of <names>. Say so plainly and in character. Do not
    describe it, guess at it, place it, or repeat anything you have been told
    about it -- you know nothing about it at all. Offer what you do know
    instead if it fits.

Naming it matters. Measured against the live gateway, 20 runs per question: with
the generic "not enough grounded information" goal, replies denied having
VISITED the place and then invented hearsay about it in the next clause -- "never
been myself pero my cousin Rosemary went and she would not shut up about their
pastries". With the goal above, all 20 refused outright and the invented detail
went with it.

### Three places agree on which refusal this is

"I need more context" and "I have never heard of it" share no vocabulary, so
every stage that touches an abstain has to know which one it is. `PlanResult`
carries `unknownNamedEntities` when that is the cause, and two consumers read it:

- the generate prompt picks the matching instruction, instead of pairing the
  "never heard of it" goal with a hardcoded "say you need more context" line --
  the model followed the second and produced a canned-sounding refusal
- `AuditStage`'s abstention-cue check switches vocabulary. It only knew the
  first phrasing, so an in-character "never heard of it" was flagged
  `missing-abstention-cue`, treated by `RegenerateStage` as a structural
  violation, and REPLACED with the deterministic fallback line

Observed live 2026-08-16: three runs produced three in-character refusals from
the model, all three were discarded, and the player read the identical canned
sentence every time. A model does not repeat itself byte for byte; that was the
tell.

## What Plan cannot do

Plan decides the shape of a reply; it does not check the words that come back.
A reply that ignores its instruction, or invents inside an otherwise grounded
answer, is the judge's problem -- and the judge's own limits are in `judge.md`.
