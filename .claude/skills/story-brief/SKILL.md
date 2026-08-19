---
name: story-brief
description: Explain a story in plain English before building it -- what it does, which terms are new, whether the domain model changes, how it serves its epic, which design patterns it uses, and exactly how Nikki will verify it. Use before starting ANY story, and whenever Nikki asks what a story means or what she is about to get. Not for epics (see epic-review) and not a substitute for read-the-code.
---

# Story brief

Nikki reads this before agreeing to build a story. It is a briefing, not a plan and
not a status report. Write it after the code survey, before any implementation.

Every brief answers the same six questions, in this order, under these headings.

## 1. What this story does

Plain English. Short sentences. Describe the change as a person using Studio or the
game would experience it, then the mechanical change underneath.

Say what is being replaced or deleted, not only what is added.

## 2. New terms

List every term the story uses that is NOT already a domain term and NOT ordinary
software engineering vocabulary. For each: the term, what it means, and why a term
already in use would not do. If a term comes from a third-party library, say so and
say whether it stops at our boundary or leaks into our code.

If the story introduces no new terms, say exactly that. Do not pad the section.

Grep the repo and docs before claiming a term is new -- and before introducing one.
Never overload a word that already means something here.

## 3. Domain model impact

State plainly whether this story changes the domain model: new entity, new field on an
existing entity, a changed relationship, or a changed lifecycle. Name the files.

If it changes nothing in `packages/domain`, say "no domain change" and say which
layers it does touch. Most UI and runtime-wiring stories are no-domain-change; a story
that quietly adds a persisted field is not, and Nikki must hear about it here.

If a persisted field IS added, say what happens to projects saved before it existed.

## 4. How it serves the epic

One paragraph. What the epic is trying to achieve, and why this story is a step toward
it. If the story is a foundation others depend on, say which ones and what they cannot
do until it lands. If the story delivers something usable on its own, say what.

## 5. Design patterns

Name the patterns by their standard names and say what each one is doing here, in one
line each. Prefer patterns and components that already exist in this repo -- name them
and point at the existing example. Flag anything being built that the framework or the
repo already provides.

Pattern names are terms too, so draw them in the same precedence order used everywhere
else in this repo:

1. A term already used here. `boundary` and `contract` are established (six
   `tooling/check-*-boundary.mjs` scripts, ADRs 004 and 006), so say "boundary" rather
   than "anti-corruption layer".
2. The Domain-Driven Design lexicon -- this project is essentially doing DDD, so those
   terms are precise and welcome when tier 1 has no word for the idea.
3. General software engineering vocabulary.
4. Invent a term only as a last resort, and raise it with Nikki rather than slipping it
   into a brief.

Anything from tier 2 or below that is not already in use here gets flagged in section
2, like any other new term.

## 6. How Nikki verifies it

The most important section. Two parts:

**By hand** -- literal click paths. Where to click, what to do, what she should see,
and where relevant what she sees today so the difference is obvious. No abstractions
like "exercise the flow". If she cannot verify some part by hand, say so plainly.

**Automated** -- what tests or checks will exist, what command runs them, and what
they actually prove. Distinguish what is genuinely covered from what only looks
covered.

Then: **what this story does NOT let her verify yet**, and which story delivers it.

## Rules

- Plain ASCII. No unicode.
- Domain terms, general software engineering terms, or plain English. Nothing else
  without flagging it in section 2.
- Claims about existing behavior are code-verified, with file references, not
  remembered.
- Do not start implementing after writing the brief. The brief is handed over and
  Nikki decides.
