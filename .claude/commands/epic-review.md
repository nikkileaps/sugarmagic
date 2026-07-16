---
description: Adversarial, code-grounded design gate for an EPIC plan + its stories (1 reviewer x up to 3 rounds); locks the plan when sound. Epics only -- not one-off stories, bugs, or tasks.
---

Run the epic-review gate on an epic's plan doc + stories BEFORE any story
is built. `$ARGUMENTS` is the epic plan doc path (or an epic number ->
resolve to `docs/plans/<n>-*.md`). **This gate is for EPICS ONLY** -- do
NOT use it for one-off stories, bug fixes, or tasks; those proceed
normally without a gate.

Loop up to **3 rounds**, stopping early on convergence. Each round:

1. Spawn **ONE** independent adversarial reviewer (Agent, subagent_type
   `general-purpose`). Brief it to do the following IN ORDER -- the first
   three are mandatory groundwork before any judgment, because skipping
   them is the recurring failure this gate exists to stop:

   **FIRST -- read ALL the relevant code.** Read the epic plan + stories,
   then INDEPENDENTLY read *all* the code the epic touches, end to end,
   across every affected package -- not a sample, not just the files the
   doc cites. DISTRUST the doc's claims and its `file:line` references;
   open the producing code yourself. You cannot critique what you have not
   read; do not form a single conclusion before this is done.

   **SECOND -- read the relevant documentation.** For every external
   library / framework / API / SDK the epic relies on, read its ACTUAL
   docs and verify behavior against the **installed version** in
   `node_modules` (never recite from memory). Also read the referenced
   ADRs and any linked design sources. Missing this is the other constant
   failure (e.g. reciting an engine's behavior wrong, or missing a
   built-in primitive the framework already ships).

   **THIRD -- establish patterns, norms, and existing components.** Name
   the relevant software design patterns for this problem, AND the
   existing architectural norms + reusable components already in THIS repo
   (and the framework). The plan must REUSE them wherever possible; flag
   anywhere it reinvents something the repo or framework already provides,
   and name the existing component/pattern/primitive it should use
   instead. (This gate was created after a plan proposed a hand-rolled
   primitive while the framework shipped `BatchedMesh` and the repo
   already had an instanced-node path.)

   **THEN critique, grounded in the above:**
   - Verify EVERY load-bearing claim against the **terminal producing
     line**: quote `file:line`, rate CONFIRMED / OVERSTATED / WRONG /
     UNVERIFIABLE, attempt to falsify it, assign confidence.
   - (a) Architecture decisions -- is each right, and what better
     alternative / existing component does it ignore? (b) Story/task
     decomposition -- complete? correctly ordered / dependency-sane? each
     task independently verifiable? missing tasks? (c) Verify/acceptance
     steps -- sufficient and falsifiable, or hand-wavy?
   - Find anything wrong, overclaimed, missing, or reinvented. If the
     design is genuinely sound, SAY "converged" -- do NOT manufacture
     nits; three rounds should approach a fixed point. You are held to the
     standard you audit: quote terminal code / cite the doc you read for
     every load-bearing claim.
   - Output: what code + docs you read (so gaps are visible), prioritized
     findings (`file:line` + verdict + confidence), reuse/pattern notes,
     then an explicit convergence verdict.

2. When it returns, **triage every finding yourself against the actual
   code** (Read the cited producing lines -- findings are leads, not
   facts). Classify real / maybe / noise with one line of evidence each.
   Relay the triaged result to the user honestly, including where the
   plan was wrong.

3. **Apply the real fixes** to the epic plan + stories (and any referenced
   ADRs) in place, matching the existing plan/story/ADR conventions.

4. Convergence check: if the reviewer returned "converged" AND your
   triage found no real (non-noise) issues this round, STOP the loop --
   the epic is sound. Otherwise run another round (max 3).

After the loop:
- **If converged:** stamp the epic plan doc with a header line
  `Status: Locked (epic-review passed <current date>, <N> rounds)`. That
  header is the contract -- stories are now executed as written.
- **If NOT converged after 3 rounds:** do NOT lock. Report the remaining
  open issues and stop for the user to decide.

Do NOT start implementing any story. This gate produces a sound, locked
plan; building is a separate, later step. See the `epic-review-gate`
feedback memory for the locked-plan execution contract.
