# Plan 089 -- Diegetic Review + Pronunciation (child epic G of Strategy 002)

Status: DRAFT (pre-drafted 2026-07-26 ahead of pickup; pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 -- child epic G; absorbs Plan 076.4-076.6 (076 was deferred; its sugarlang half moved here -- the bark/expression stories 076.1-076.3 did NOT move and stay deferred with 076)
- Plan 076 (expressive presentation + lexicon audio) -- the audio stories are re-planned here largely AS DESIGNED there, including the review-round decisions its doc already ratified (persist mechanism, published-runtime never generates); re-verify those decisions against current code at pickup rather than re-litigating them
- Plan 085 (epic B) -- soft dep for review content: chunk/function items appear in review once they exist; lemma-only review ships without B
- Plan 041 (audio playback foundations) -- 076.6 named the play-clip extension + mixer category seam
- Ground truth: re-audit at pickup; this doc was written ahead of time. FSAccess read-after-write flakiness is a KNOWN hazard for the batch-generation story (publish in-memory blobs to the asset-source store instead of re-reading -- house note)

---

## Why now

Two gaps, one epic, both independent of the heavy epics:

1. REVIEW: Nation's four-strands audit shows meaning-focused input, output, and fluency covered or planned -- but DELIBERATE STUDY has no surface. The FSRS due queue exists and schedules; the player has nowhere to review. The strategy's answer is diegetic: the JOURNAL is the deliberate-study surface -- review rides the fiction (your own notes from conversations), not a flashcard app bolted on.
2. PRONUNCIATION: every hover-glossable lemma is silent. 076 designed the full path (gateway TTS route, Studio-time batch generation, hover playback) and deferred it; nothing about the design rotted -- it just never got built. Audio is also groundwork the strategy's listening-modality watchlist items sit on.

Both ship visible value alone and neither blocks nor is blocked by B/C/E/F -- the strategy sequences G "any time after A".

## Non-goals

- No barks / expression contract (076.1-076.3 stay deferred with Plan 076; revisit note there stands).
- No quiz mechanics in review: the journal reviews by re-reading, re-listening, and light retrieval-in-fiction prompts -- never graded drills with rewards (anti-edutainment: extrinsic rewards around drills kill intrinsic motivation).
- No STT, no speaking assessment (strategy watchlist).
- No TTS at published runtime: generation is Studio-time only; published cache-miss = silent lemma (the 076.5 review-ratified rule).
- No new voices/vendors exploration beyond what the 076.4 route pins; vendor tuning is post-ship.

## Design principles

- Diegetic or not at all: the journal is the player-character's notebook; entries are things that happened ("Rosa taught you: queso"), review is rereading your own notes with the audio and glosses live.
- The due queue drives placement, the player drives pace: due items surface first in the journal's review view; nothing nags, nothing streaks (anti-metric posture).
- Studio-time cost, runtime silence: all audio is generated at compile in Studio contexts, content-hash keyed, shipped as assets; the published runtime never calls a TTS route.
- Reuse the proven seams: 041's playback + mixer categories; the 076.5 persist mechanism (asset-source store + FSAccess write + BOTH asset maps enumerable); the observe path for review evidence.
- Review IS evidence: journal interactions (reveal, replay, retrieval prompt outcomes) flow as observations at the existing weak/strong tiers -- deliberate study updates the same model.

## Stories (EXECUTION ORDER)

### 089.1 Journal review loop (the deliberate-study surface)

The journal gains a review view fed by the FSRS due queue: due lemmas/chunks appear as the player's own notes (source context: which NPC, which scene -- the encounter history already knows), with hover gloss live and audio (089.4) when present. Light retrieval-in-fiction: a due item can render as a covered-gloss note ("what did this mean again?") the player reveals; reveal/recall outcomes feed observations at the appropriate weak tiers. Entry ordering: due-first, then recency. UI copy minimal.

- Exit: due items render as journal notes with source context (integration); reveal-before-gloss records a retrieval observation, reveal-after records exposure-tier (pins); empty due queue = normal journal, no review section; New Game keeps the journal's learner-derived entries consistent with surviving learner knowledge.

### 089.2 Gateway TTS route

As 076.4: gateway TTS handler -- provider pick + secret via the DeploymentRequirement mold, vendor base-URL env override for testability; harness tests (auth gate, happy path, vendor-error). One handler serves Studio dev (local gateway) and deploy. Gateway change: compiled-source rebuild + freshness test apply.

- Exit: route green in harness tests + docker smoke; auth-gated; vendor error surfaces as a typed failure the compile step can tolerate.

### 089.3 Studio-time batch generation + publish

As 076.5, review-ratified mechanism kept: on lexicon compile IN STUDIO CONTEXTS ONLY, batch-generate missing lemma audio, content-hash keyed. Persist: (a) publish in-memory blobs to the asset-source store for immediate use (ALSO the mitigation for the known FSAccess read-after-write flake -- never re-read what was just written), (b) FSAccess-write under the project's assets/ dir, (c) make enumerable by BOTH asset maps (extend collectFileBackedAssetPaths per the navmesh precedent, or per-lemma AudioClipDefinitions -- decide-in-story, 076 leaned to the former). The published-runtime compile path NEVER generates; failure leaves lemmas silent, never blocks compile.

- Exit: compile integration test (generate-once, cache-hit-second-time, failure tolerated, published-runtime path never calls the route); generated assets present in a deploy's assetSources map; a second compile of an unchanged lexicon generates nothing.

### 089.4 Hover pronunciation + playback

As 076.6: the 041 additive extension (play-clip-by-asset-path + mixer voice category), hover trigger at the decorator's onTermHover, settings toggle, missing-audio silent. Also wired into 089.1's journal notes (tap a note's word to hear it).

- Exit: preview smoke -- hovering a known lemma pronounces it through the voice bus (game mute silences it); toggle works and persists; unknown/silent lemmas degrade silently; journal note playback works.

### 089.5 Celebration polish

The light touch 076 carried: small diegetic acknowledgements of real milestones (first function used cold, an encounter debt fully paid, a band graduation) -- journal flourish or NPC warmth, never confetti-per-action, no streaks, no XP. Scope deliberately small; decide-in-story the exact milestone set from what telemetry can already detect.

- Exit: milestone events render once each (pins against re-fire); nothing fires on routine actions; all celebration copy in-fiction.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean.
2. Gateway note: 089.2 is a gateway change -- compiled-source rebuild committed (freshness test enforces), local gateway redeployed (Studio -> Deploy -> local env) before probing audio generation. 089.1/089.4/089.5 are plugin-side: dev server restart only.
3. Review probe: learn a few words in conversation, open the journal -- they appear as your notes with source ("Rosa, the dock"); a due word shows the covered-gloss prompt; revealing it updates the card (debug surface).
4. Audio probe: compile the lexicon in Studio (watch the batch generate on first run, skip on second); hover a lemma in dialogue -- it pronounces; toggle off in settings -- silent; game mute silences it.
5. Offline probe: published/preview build with the gateway down -- everything plays, generated audio works from assets, missing audio is silently absent.
6. Restraint probe: play normally for a while -- no streaks, no badges, no per-action celebration; one milestone (if reached) acknowledges once, in fiction.

## Epic wrap

docs/api: journal/review page (due-queue integration, observation tiers for review interactions); audio page (TTS route, generation lifecycle, asset enumeration, playback seam); settings page entry. Strategy 002 epic G status; Plan 076 updated to point its absorbed stories here. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Barks + expression contract (076.1-076.3): stay with Plan 076; revisit per its own trigger (strategy names barks "later").
- Listening-modality probes over generated audio ("what did she say?" beats): epic F's probe framework + this epic's audio are the two halves; revisit when both exist (code comment at the journal playback).
- Chunk/function audio (multi-word TTS): revisit when 085 populates chunks the journal reviews; lemma audio is the floor (code comment at the batch generator input).
- Sentence-level TTS for full NPC lines: out of scope entirely (cost/quality posture unchanged from 076); revisit only with a product decision.
- Review-surface expansion (search, filters, stats): floor is due-first notes; revisit on playtest demand -- stats views risk the anti-metric failure modes.
