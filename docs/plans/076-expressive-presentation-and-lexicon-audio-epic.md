# Plan 076 -- Expressive Presentation + Lexicon Audio (child epic F of Strategy 001)

Status: DEFERRED -- moved to backlog 2026-07-24.
Owner: nikki + claude
Date: 2026-07-19

Deferral notes:
- Neither thread is needed to complete Strategy 001's sugaragent track right now.
- The lexicon audio / hover pronunciation half (076.4-076.6) belongs in the sugarlang epic
  track, not the sugaragent strategy. Revisit when sugarlang lexicon authoring is a priority.
- The bark bank half (076.1-076.3) is high-charm but not blocking anything. Revisit when
  personality-through-sound becomes a design priority or when a game producer asks for it.
- The plan + epic-review lock are preserved here for when either thread is picked back up.

Related:
- Strategy 001 -- child epic F, the "ease into voice" epic: personality through sound WITHOUT live TTS on any hot path. Bark half depends on Plan 072 only lightly (per-NPC authoring rides the same inspector surfaces); the sugarlang half is independent.
- Plan 041 (sound system) -- the playback substrate. The bark half rides it directly (authored clips/cues fit `playCue` as-is); the lexicon half needs ONE small additive extension it does not have today: a play-clip-by-asset-path + mixer-category API (generated lemma audio has no cue/clip definitions), so hover audio respects the voice bus and game mute. That extension is owned by this epic (076.6), not assumed.
- Ground truth: 2026-07-18 audit. The selector signals for barks already exist FREE on every turn: Plan emits `responseIntent` (greet/chat/answer/redirect/goodbye/clarify/abstain) and Interpret emits `socialMove` (greeting/introduction/acknowledgement/smalltalk/farewell) -- but both are buried in stage diagnostics, not surfaced as first-class envelope data. Sugarlang already compiles scene lexicons with content-hash caching and already emits hover observation events from the game UI (the observe middleware drains them) -- the hover plumbing exists; only the audio is missing. House gotcha that applies directly: FSAccess read-after-write is flaky -- publish generated audio blobs to the asset-source store in-memory, never write-then-re-read.

---

## Why now

Nikki's direction: ease into voice via the bark pattern -- an occasional canned line or sound giving personality and emotion while the text appears in the box -- and start language AUDIO with hover pronunciation of target-language words, owned by sugarlang. Both are cheap, high-charm, zero-marginal-cost-per-turn features: barks are pre-made assets selected by tags the pipeline already computes; lexicon audio is batch-generated once per compiled lexicon and cached. Neither touches the LLM hot path. This is also the plugin-boundary epic in miniature: barks are a GENERIC sugaragent/game feature (any sugarmagic game); pronunciation is sugarlang leaning into the language game.

## Non-goals

Live/full-line TTS (watchlist; the bark seam is designed so full voice can slot in later). Lip-sync/facial animation. Realtime speech-to-speech. STT/pronunciation ASSESSMENT of the player (separate future epic). Barks driven by an emotion simulation (no affect system exists -- Plan 074 proposes deleting the dead ENTITY_AFFECT fact, not yet gated, and a vestigial sugarlang reader exists; regardless, barks key off intent/social tags only in v1 and assume nothing about 074's outcome).

## Design decisions (epic-review ratifies)

- D1 -- Expression tags become first-class on the envelope: a TYPED optional `expression` field on ConversationTurnEnvelope (intent tag + social tag) -- additive, provider-agnostic, and a real contract rather than a metadata-Record convention (review round 1: metadata is an untyped Record read defensively; a typed field is equally additive and actually "first-class"). Populated by sugaragent from what Plan/Interpret already computed, at BOTH provider return sites -- the main return AND the envelope-override path (placement turns run after Plan, so tags exist there too). Scripted/authored dialogue can carry authored expression tags on nodes someday (deferred, not built).
- D2 -- Bark banks are LIBRARY-FIRST (review round 1; Plan 037 mold): a BarkBankDefinition in the content library mapping expression tags -> `soundCueDefinitionId`s -- reusing the sound cue's EXISTING weighted variants, retrigger policy, maxInstances, and `voice` category rather than re-implementing any of it at bank level. NPCDefinition gains a `barkBankId` reference (NPC inspector, beside 072.7's model override once it exists -- adjacency only, no hard dependency); the game project gains a default bank id (the `soundEventBindings` mold) so barks work before per-NPC authoring exists.
- D3 -- Bark playback lives in the game host on top of the sound system (041), consuming D1's field at the same layer as the existing `audioController.emitEvent` call sites: on turn presentation, resolve bank -> tag -> cue, `playCue`, subject to a cross-turn rate governor. The governor's policy is AUTHORED ON THE BANK DEFINITION (always-eligible tags such as greeting/goodbye + a throttle window for the rest), composing with -- never duplicating -- cue-level retrigger/maxInstances. Degrades silent at every layer (no bank, no tag, no cue, sound off). Sugaragent never touches audio.
- D4 -- Lexicon audio generation runs at STUDIO AUTHORING TIME ONLY (review round 1 -- the locus decides the economics): when scene lexicons compile in Studio contexts, sugarlang batch-generates missing per-lemma audio through a gateway TTS route (Studio already talks to the local docker gateway; one handler serves dev and deploy), publishes blobs via the asset-source store as PROJECT ASSETS that ship with the deploy. The PUBLISHED game never calls TTS -- a cache-miss lemma is simply silent. This keeps the cost claim true (one-time per lexicon, not per player), keeps every player session off the TTS vendor, and keyed by the same content hash regeneration happens only on lexicon change. Provider chosen in-story (single-word target-language quality is the bar; viable providers verified to exist).
- D5 -- Hover pronunciation UX: the audio trigger is the dialogue entry decorator's EXISTING `onTermHover` (fires at hover time -- the middleware drain fires at next turn, too late for playback), playing the lemma asset through the 041 path extension named above, alongside the existing highlight/gloss. The sound-on-hover toggle is scoped honestly: it is the FIRST player-facing audio setting in the product -- no learner-settings surface exists today -- and rides the runtime profile (which already anticipates audio preferences) or a SaveParticipant slice, decided in-story with the persistence rule respected.
- D6 -- Secrets/keys: the TTS vendor key is a gateway deployment secret (same DeploymentRequirement machinery as the LLM keys); the browser only ever sees generated audio.

## Stories (EXECUTION ORDER)

### 076.1 Expression contract (D1)

Typed optional `expression` field on ConversationTurnEnvelope + sugaragent population from existing Plan/Interpret outputs at BOTH return sites (main + envelope-override). Exit: unit test -- every agent turn INCLUDING placement envelope-override turns carries expression tags matching its diagnostics; contract documented.

### 076.2 Bark bank authoring (D2)

BarkBankDefinition in the content library (tag -> soundCueDefinitionId map + governor policy fields per D3), authored in the Build > Audio workspace (the existing mold for content-library sound authoring -- it already authors SoundCueDefinition records; the bank editor is a new panel there, not a new workspace); NPCDefinition.barkBankId + inspector field (both normalize paths gain the field), game-project default bank id. Exit: an authored bank round-trips through save/load of the CONTENT LIBRARY + GAME PROJECT documents (NPC definitions live on GameProject, not the region document); inspector renders per house UI norms.

### 076.3 Bark playback (D3)

Game-host consumer at the audio-controller layer: expression field -> bank resolve (NPC bank, else game default) -> governor -> `playCue`; degrade-silent tests for every missing layer. Exit: integration test with a stub sound system asserting selection + throttling (always-eligible vs throttled tags); preview smoke -- an NPC with a bank chirps on greeting and goodbye, stays quiet mid-chatter per bank policy.

### 076.4 Gateway TTS route (D4, D6)

Gateway TTS handler (provider pick + secret via the DeploymentRequirement mold + vendor base-URL env override for testability), post-071.9 harness tests (auth gate, happy path, vendor-error). One handler serves Studio dev (local docker gateway) and deploy. Exit: route green in harness tests + docker smoke.

### 076.5 Studio-time batch generation + publish (D4, sugarlang)

Sugarlang compile-step integration IN STUDIO CONTEXTS ONLY: batch-generate missing lemma audio on lexicon compile, content-hash keyed. Persist mechanism named (review round 2 -- `setSource` alone only serves the current session): generated audio is (a) published to the asset-source store for immediate use, (b) FSAccess-written under the project's assets/ dir, and (c) made enumerable by BOTH asset maps -- the Studio store and the published boot.json fallback -- by extending `collectFileBackedAssetPaths` with the lemma-audio input (the navmesh precedent) or registering per-lemma AudioClipDefinitions; the deploy already ships the whole assets/ dir, so enumeration is the only missing link. The published-RUNTIME compile path NEVER generates (cache-miss = silent lemma). Failure-tolerant: generation failure leaves lemmas silent, never blocks compile. Exit: compile integration test (generate-once, cache-hit-second-time, failure tolerated, published-runtime compile path never calls the route); generated assets present in a deploy's assetSources map.

### 076.6 Hover pronunciation + playback path (D5)

The 041 additive extension (play-clip-by-asset-path + mixer category, voice bus); hover trigger at the decorator's `onTermHover`; settings toggle per D5's scoped decision; missing-audio silent. Exit: preview smoke -- hovering a known lemma pronounces it through the voice bus (game mute silences it); toggle works and persists; unknown/silent lemmas degrade to today's behavior.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Preview with a bark-bank NPC: greeting plays a chirp, goodbye plays one, mid-conversation stays mostly quiet (policy), muting game sound silences everything gracefully.
3. An NPC with NO bank behaves exactly as today.
4. Open a scene with a compiled lexicon: hover a target-language word -- it highlights, glosses, and pronounces. Toggle the learner setting off: silent hover. Recompile an unchanged scene: no TTS calls (cache hit, check gateway logs).
5. Break the TTS key in local config: lexicon compile still succeeds; hovers are silent for new lemmas; log line says why.

## Epic wrap

docs/api: expression metadata contract, bark bank authoring, TTS route, lexicon-audio cache semantics. Measured one-time TTS cost per lexicon in the wrap notes. Backlog sweep.

## Deferred (with revisit triggers)

- Full-line character TTS: the D1 metadata + D3 playback seam is exactly where it slots (a "voiced line" is a bark with dynamic audio); revisit when voice budget/priority says so.
- Authored expression tags on scripted dialogue nodes: revisit when a scripted scene wants barks; the D1 field is provider-agnostic already.
- Affect-driven barks: revisit at the C+F confluence noted in 074's deferred list.
- Player STT / pronunciation assessment: separate epic when speaking practice enters the design (two-lane per Strategy 001 research: robust STT for comprehension, scripted-moment scoring only).
