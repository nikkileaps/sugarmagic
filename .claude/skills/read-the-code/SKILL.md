---
name: read-the-code
description: Survey the actual code before implementing a story or making any claim about what already exists. Use before starting any story or epic work, before saying anything shaped like "X does not exist / is not implemented / the code does not do X", and whenever Nikki says something exists that has not been found yet. Code and tests are evidence; plan docs, tickets, comments, and memory are only claims.
---

# Read the code

Stories get pulled into a codebase that may already contain part of the work.
The only way to know is to read the code. This skill defines what "read the
code" means and what counts as evidence for a claim about the codebase.

## Evidence hierarchy

- Code and tests are ground truth.
- Plan docs, ticket bodies, comments, commit messages, and any memory of the
  repo are claims. They point at places to look. They never settle anything.
- A search that found nothing is evidence about the search, not the codebase.
  "My greps found nothing" and "it does not exist" are different statements.
  Only the first one is ever directly observed.

## When this triggers

1. Before implementing any story or epic work: run the survey below and
   present the findings before writing code.
2. Before saying or writing any sentence shaped like "X does not exist",
   "X is not implemented", "the code does not do X", or "nothing handles X".
3. Whenever Nikki says something exists and it has not been found yet.

## The survey

1. Harvest terms. From the story text, list the domain nouns, plus synonyms,
   plausible identifier spellings (camelCase, kebab-case, abbreviations), and
   older names. A partial implementation may predate the current vocabulary:
   check `git log -S <term>` and the docs for renames.
2. Sweep. Grep every spelling from the repo root, not from a guessed
   subdirectory. Include tests: partial implementations show up most reliably
   in test files. Check the exports of any package that hits.
3. Read. Read the whole files that hit, not just the matched lines. Follow
   the call graph one hop out from anything relevant. Matched-line skimming is
   how partial implementations get missed.
4. If Explore agents are used for breadth, their findings are leads. Verify
   every load-bearing quote at the producing file and line before it drives a
   claim or an edit.

## The report

Present findings in three buckets before implementation starts, every time,
even when all three sweeps come up empty.

- EXISTS: quote the code, with file and line.
- PARTIAL: quote what is there, name what the story still needs.
- ABSENT: list the searches actually run (terms and roots). Phrase it as
  "these searches found nothing", never "it does not exist".

If prior art turned up, stop and reconcile with Nikki before implementing.
Building alongside an existing partial implementation creates a duplicate
enforcer, and deleting either half later loses behavior silently.

## When Nikki says it exists

The working assumption is that the search failed, not that she is wrong. She
wrote this codebase.

- Do not refute. Do not restate the failed search as if repetition made it
  stronger.
- Widen the search: new terms, `git log -S` across all branches, `gh` search
  of the repo, older names.
- Ask her for a seed: a file, a function name, a UI location, or roughly when
  it was built, and search from there.
- Disagreement is only permitted after the full ABSENT standard is met, and
  it is presented as "here is everywhere I looked", never as a rebuttal.
