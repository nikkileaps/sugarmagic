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

## Step 3 -- one override, for going in circles

    if there is no evidence AND the conversation is repeating itself
       AND the reply is not already GOODBYE or REDIRECT
           -> force CLARIFY

This is about repetition, not knowledge, which is why it ignores everything
step 2 decided.

## Step 4 -- decide how specific the reply may be

    if nothing grounded the turn (no evidence, no memory, no quest lore)
       AND the reply is GREET, CHAT or ANSWER
           -> "generic-only"    (stay vague, do not reach for detail)
    else   -> "grounded"

KNOWN WRINKLE: `hasPersonaPage` is not in that list. A turn grounded only by the
NPC's own page is still told to stay generic. Nothing observed has depended on
it, but it is inconsistent with step 2, which does count the page.

## Step 5 -- what Plan hands back

    - the kind of reply       -> becomes "Intent:" in the generate prompt
    - how specific to be      -> grounded vs generic
    - the goal sentence       -> becomes "Goal:" in the generate prompt
    - who speaks next, what the input box does, its placeholder
    - the repetition state, carried into the next turn

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
