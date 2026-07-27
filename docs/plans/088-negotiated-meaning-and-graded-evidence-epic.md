# Plan 088 -- Negotiated Meaning + Graded Evidence (child epic F of Strategy 002)

Status: DRAFT (pre-drafted 2026-07-26 ahead of pickup; pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 -- child epic F ("Immersion, negotiated": micro-exchanges are the adaptive mechanism AND the primary assessment)
- Plan 085 (epic B) -- HARD dep: functions gradable, item-zero chunks exist
- Plan 087 (epic E) -- HARD dep for move POLICY: the outer loop decides when to check; grading + signal-detection halves can start right after B + H
- Plan 084 (epic H) -- HARD dep: target-language player moves must classify at all before they can be graded; this epic EXTENDS the interpretLexicon categories beyond social moves (question stems, non-understanding markers -- 084 defers that set here by name)
- Wire formats that already exist: the constraint's interactionStyle + comprehensionCheckInFlight fields (contracts/pedagogy.ts; consumed by the generator overlay + observe -- verified present 2026-07-26); the probe framework is "framework + triggers, no UI" per the strategy audit
- Strategy 002 Deferred note: learner profile-core cross-session persistence must land NO LATER than this epic (evidence is worthless if the profile resets) -- absorbed here as a story
- Ground truth: re-audit at pickup; this doc was written ahead of time

---

## Why now

Negotiation of meaning -- comprehension checks, confirmation checks, clarification requests, recasts during meaning-focused talk -- is the most experimentally supported mechanism in interactionist SLA, and graduated assistance doubles as assessment: the amount of help a learner needs IS the measurement (dynamic assessment; contingent scaffolding). Repair episodes are the highest-quality learner evidence the model ever gets -- better than any injected quiz. Today none of it exists as behavior: the wire format (interactionStyle, comprehensionCheckInFlight) is built and flowing, the probe framework has triggers but no UI, produced-* observations are string-match-only, and non-understanding has no detector. The NPC is still an oracle, not an interlocutor.

This epic completes the loop from teaching to evidence: the NPC probes, notices, repairs, checks, and moves on -- and every one of those beats feeds the learner model.

## Non-goals

- No quizzes, ever: every check is diegetic (reply chips, yes/no beats, an NPC asking for something that requires a due word). Anti-edutainment invariant.
- No social punishment of errors: reactions are in-fiction warmth/confusion/delight; retries cheap and normalized.
- No move-policy improvisation by the model: the TEACHER decides whether/when/what kind (087's slot); the model only renders the move.
- No STT/pronunciation (strategy watchlist), no full scene-wired deictic grounding (stretch goal -- the floor here is textual/emote reference by name).
- No new gateway routes: the reply labeler rides the existing LLM route with a new purpose value at most.

## Design principles

- The repair ladder is ordered and cheap-first: rephrase in target language with known words -> deictic reference to the entity BY NAME (floor) -> mime/emote -> support-language gloss (last resort) -> check understanding -> move on with life. Help level is recorded per episode: less help after success, more after struggle (the softest adaptive rule there is).
- Evidence quality tiers: repair episodes and graded production are strong signal; passive exposure stays weak-positive; large updates gate on production (existing grade-table posture, extended not replaced).
- Turn budget: the labeler is ONE cheap call riding the observe path, async off the critical render path; negotiation moves ride the existing generate call via constraint fields -- zero added synchronous calls per turn.
- Bands become priors, not law: the envelope target turns per-learner and strain-adjusted; the classifier keeps its teeth as the guardrail.
- Fail-soft everywhere: labeler outage = string-match floor; no detector signal = no move; missing profile store = session-scoped behavior as today.

## Stories (EXECUTION ORDER)

### 088.1 Learner profile-core persistence (the absorbed prerequisite)

FSRS cards already survive reload (IndexedDB); the profile CORE (CEFR posterior, band, placement verdict) lives only in session-scoped blackboard facts and resets on reload. Ship the plugin-owned profile store keyed on userId (the ADR 020 boundary assignment), as a SaveParticipant-shaped slice with no wall-clock values persisted. Placement survives reload; New Game keeps learner knowledge by design.

- Exit: reload restores band/posterior/placement (integration); New Game preserves them; no Date.now() in the slice (pin); reset-learner-data path clears it.

### 088.2 Non-understanding signal detection

The detectors: response latency, hover bursts, incoherent replies (interpret-signal shapes), and explicit "que?" moves -- the interpretLexicon EXTENSION (question stems, non-understanding markers: "que?", "no entiendo", "otra vez?", "mas despacio") lands here as new categories on the 084 mechanism. Detected signals publish as learner-evidence events the teacher and this epic's move policy read.

- Exit: each detector unit-tested; "no entiendo" classifies and publishes (integration through interpret + observe); detector events in telemetry; no-signal = no event (quiet by default).

### 088.3 Negotiation moves as teacher-directed behavior

The move set -- comprehension check, confirmation check, clarification request -- rendered through the existing wire (interactionStyle, comprehensionCheckInFlight) with the teacher's "whether to check" slot (087) deciding; until 087 lands, a deterministic interim policy (strategy: probe on due-teachable + first-use, back off on strain) drives it, clearly marked as the fallback the outer loop replaces. Moves respond to 088.2 signals: a non-understanding signal triggers the repair ladder INSTEAD of a re-probe.

- Exit: each move kind renders in-character through the constraint (prompt pins); signal-triggered repair supersedes probing (integration); interim-policy marked + pinned as replaceable; moves logged with their trigger reason.

### 088.4 The repair ladder + contingent scaffolding measurement

The ordered ladder as directive shapes the renderer executes, with the HELP LEVEL REACHED recorded per repair episode as first-class evidence (dynamic assessment). Deictic floor: reference the scene entity by name in-text/emote (the compile-time scene contents are already readable); full scene-wired pointing stays a stretch goal. Repeated struggle on an item raises its next-encounter support; success lowers it.

- Exit: ladder order pinned (unit); help-level evidence events flow to the learner model and adjust subsequent support (integration pins less-help-after-success); gloss-last-resort pinned; repair episodes visible in telemetry with rung reached.

### 088.5 LLMKT-style reply grading

One cheap labeler call riding the observe path (async, fail-soft to string-match): tags player utterances with (item or function, demonstrated correctly?) -- produced-* observations stop being string-match-only and FUNCTIONS become trackable skills. Grades feed the existing grade table through new observation kinds; the labeler's rubric includes the taught-chunk inventory (085) so chunk production grades whole.

- Exit: mock-gateway labeler test (utterance -> tagged evidence -> card update); labeler-down = string-match floor (pin); grading events in telemetry with model-vs-floor provenance; no synchronous render-path call (turn-budget pin).

### 088.6 Recasts + adoption tracking

Recast as a first-class directive: on a detected player error, the NPC's natural reply models the correct form (never names the error); whether the player ADOPTS the recast in subsequent turns is itself evidence (adoption observations). Rides the same constraint surfaces; the labeler (088.5) detects adoption.

- Exit: recast directive renders as natural modeling (prompt pins, no meta-commentary); adoption within the session updates the item (integration); non-adoption is neutral, never punished (pin).

### 088.7 Reply chips + comprehension-probe UI

The probe framework gets its UI: reply chips (comprehension-graded choices) and probe rendering per probeStyle, as diegetic beats. Chip selections are graded evidence (produced-chosen exists in observe -- extend to probe outcomes). UI copy minimal; tool-overlay conventions respected.

- Exit: a scheduled probe renders chips in preview; selection grades and updates the card (integration); probe-declined/timeout degrades gracefully (move on with life, weak-negative at most); probe outcomes in telemetry.

### 088.8 Strain-adjusted envelope + anti-skimming enforcement

(a) Bands to priors: the envelope target becomes per-learner and strain-adjusted (comprehension degrades gradually -- no cliff), bounded within the posture's band; the classifier stays the enforcer, only its TARGET moves. (b) Anti-skimming: the quest-critical-info-in-L2 authoring affordance (questEssentialLemmas graduates from exemption list to enforced affordance) + a compile check that quest-critical facts travel in the target-language portion at deep-end postures.

- Exit: strain-adjusted target pinned (bounded movement, never below frustration floor); compile check flags an authored line whose quest-critical fact only appears in English at target-dominant (fixture); skim-proof integration: the quest answer is only extractable from the L2 portion.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Persistence probe (088.1): place at a band, reload the page -- band and placement survive; New Game keeps them.
3. Negotiation probe: converse at A2; when a due word lands, the NPC probes diegetically (chips or in-fiction ask); answer wrong -- the NPC rephrases with known words FIRST, glosses only as last resort, then moves on. No quiz screens anywhere.
4. "Que?" probe: reply "no entiendo" -- the NPC repairs instead of repeating; telemetry shows the signal + the ladder rung.
5. Grading probe: type a taught chunk ("gracias por la ayuda") -- the labeler tags it and the card updates (debug surface); kill the gateway -- string-match floor still updates on exact use.
6. Recast probe: type a close-but-wrong form -- the NPC's reply models the correct form naturally; using the correct form next turn shows an adoption event.
7. Skim probe: at target-dominant, try to complete a quest reading only the English -- the critical detail is not there.

## Epic wrap

docs/api: negotiation/evidence page (move kinds, ladder, help-level evidence, labeler contract); learner-model page (new observation kinds, profile store); telemetry page. Strategy 002 epic F status. Interim-policy comment closed by 087 or carried explicitly. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Full scene-wired deictic grounding (NPC points at the cheese wheel): strategy stretch goal; revisit when the presentation channel (gesture tags -> entity refs, emote/camera) exists -- 083.3's gesture channel is the syntax seam (code comment at the deictic floor).
- STT / listening-speaking probes: strategy watchlist; the probe framework's modality field is the seam.
- Labeler model tuning / distillation: revisit at real volume with telemetry.
- Social multiplayer interdependence: strategy watchlist.
- Meta-language reminder decay tuning: ships with pinned defaults; revisit on playtest annoyance reports.
