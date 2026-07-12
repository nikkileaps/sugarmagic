---
description: Cheap 3-finder pre-PR review of the current branch (correctness, architecture, tests)
---

Run the saved mini-review workflow on the current branch.

1. Invoke the Workflow tool with `{name: "mini-review"}`. If the user
   passed an argument ($ARGUMENTS), treat it as the base branch and
   pass `{name: "mini-review", args: {base: "$ARGUMENTS"}}`; otherwise
   omit args (the workflow defaults to main).
2. When the workflow completes, triage EVERY finding yourself against
   the actual code (Read the cited files; do not trust finder claims):
   classify each as real / maybe / noise, with one line of evidence
   for the verdict.
3. Report: a short triaged list ordered by severity, real findings
   first with file:line references, then maybes, then a one-line count
   of what was dismissed as noise and why. Recommend fix-before-PR
   items explicitly. Do NOT start fixing anything without being asked.
