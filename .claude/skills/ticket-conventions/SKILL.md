---
name: ticket-conventions
description: Conventions for reading and writing Sugarmagic tickets, which live in GitHub Issues on nikkileaps/sugarmagic. Use whenever filing, querying, closing, or re-parenting a ticket, or when working with an epic and its child stories. Not for the design docs under docs/.
---

# Ticket backlog

The backlog is GitHub Issues on `nikkileaps/sugarmagic`. Drive it with the `gh` CLI.
Numbered epic design docs still live in `docs/`; the intent is to remove them and keep
planning out of the code repo entirely.

## Type is a label, not a field

GitHub Issue Types are organization-only and 404 on a personal repo. Type is carried by
a label:

`type:epic` `type:story` `type:task` `type:bug` `type:chore` `type:feature`

Nothing enforces these, so set the label at creation. An issue with no `type:` label is
untyped and will not show up in a type-filtered query.

## Epic titles carry an "epic:" prefix

An epic's title starts with `epic: ` (lowercase), in addition to the `type:epic` label.
The prefix is for humans scanning a title list; the label is for queries. Forward-only:
older epics with inconsistent titles stay as they are. If a ticket is reclassified to an
epic later, fix its title and label at that point.

## Bodies describe the present

A ticket body states what is true now. When rewriting one, do not narrate what an
earlier version said or when a stale claim was corrected -- the issue's edit history
already records that.

## Hierarchy is sub-issues

Epic -> story -> task is modelled with GitHub sub-issues, not labels or naming schemes.
Set the parent when the issue is created so it costs one write instead of two:

```sh
gh issue create --title "..." --body "..." --label type:story --parent 42
```

Re-parent or detach an existing issue:

```sh
gh issue edit 43 --parent 42
gh issue edit 43 --remove-parent
gh issue edit 42 --add-sub-issue 43
gh issue edit 42 --remove-sub-issue 43
```

Limits: 100 children per parent, 8 levels deep. Current use is depth 2.

## Reading

One call returns the whole backlog with its hierarchy:

```sh
gh issue list --limit 200 --json number,title,state,labels,parent,subIssues,subIssuesSummary
```

`gh issue list --label X` runs a GraphQL search rather than the plain issues connection.
It does not touch the 30-per-minute REST search pool, so it is safe to use, but search is
an index and may lag a write you just made. After creating an issue, read it back with
`gh issue view <n>` rather than a label query.

## Limits worth knowing, none of which currently bite

- Issue bodies fail at 65,536 characters with a 422. GitHub does not document this. The
  longest body in the backlog is about 43k, so split only if a body gets unusually large.
- Writes are capped at 500 per hour and 80 per minute, shared with clicks in the web UI.
  Normal use is nowhere near it. A bulk load of a few hundred issues should sleep 1s
  between writes.
- Reads come from a 5,000/hour pool. Effectively free.

Do not build a wrapper script to police these. Raw `gh` is the interface; a 422 or a 429
is a clear, immediate, lossless failure and is handled when it happens.
