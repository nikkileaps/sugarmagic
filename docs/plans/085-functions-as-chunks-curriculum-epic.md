# Plan 085 -- Functions-as-Chunks Curriculum (child epic B of Strategy 002)

Status: Locked (epic-review passed 2026-07-26, 3 rounds)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- child epic B, the curriculum spine ("Functions are chunks")
- Plan 084 (epic H) -- cross-dep: the meta-language item-zero chunks FEED the interpretLexicon contribution (084.5 ships a curated starter list; this epic replaces it from the inventory)
- Plan 087 (epic E) -- consumer: the outer loop schedules functions from this epic's inventory and reads this epic's scene/NPC function tags
- Sugarlang internal proposal 001 (Lexical Chunk Awareness) + internal epic 14
- Ground truth: PARTIALLY verified 2026-07-26 (see the correction in Why now); full re-audit at pickup is story 085.1, not optional -- line refs drift and this doc was written ahead of time

---

## 085.1 Ground-truth findings (amendment, 2026-07-26)

Verified against code at story-ship time:

**Chunk pipeline -- confirmed active end to end:**
- `extract-chunks.ts` (compile/): LLM-backed extractor, schema-validated, status active. Triggered by tier-2 compile scheduler (`config.ts chunkExtraction`, cost-gated) and publish pipeline.
- `chunk-cache.ts`: caches extraction results keyed by scene contentHash + model prompt version.
- `scene-lexicon-store.ts`: joins chunk cache output into `CompiledSceneLexicon.chunks`.
- `envelope-classifier.ts`: `chunkMatcherCache` (Map, now bounded at 32 entries) keyed by `lang:contentHash`; creates a trie-based `ChunkMatcher` per unique scene.
- `coverage.ts`: calls `chunkMatcher.match(tokens, sourceText)` -> `ChunkMatch[]`; returns `matchedChunkTokens` in the CoverageProfile.

**Bugs fixed in this story:**
- `chunkMatcherCache` stale-text bug: `createChunkMatcher` no longer takes `sourceText`; it is passed per-call to `match(tokens, sourceText)`. Regression test added to `envelope-classifier.test.ts`.
- `chunkMatcherCache` unbounded: capped at 32 entries with first-in eviction.
- `ObservationKind` union was missing `"hovered-introduce"` while `LemmaObservation` included it; added to union.

**Observation kinds added for 085.3 (pre-wired here):**
- `"chunk-encountered"` (receptive exposure, no FSRS grade, no productive delta)
- `"chunk-produced"` (string-match floor, FSRS grade "Good", productiveDelta 0.2)

**Confirmed absent (nothing to delete):**
- No dead chunk code found -- every extraction, cache, and match path has an active consumer.
- `CompiledSceneLexicon.chunks` is absent from compileSugarlangScene (chunk-pure, as per epic 14 rule 1) -- chunks join asynchronously via the scheduler / publish pipeline / scene-lexicon-store. This is correct behavior, not a bug.

**Observe middleware (085.3 landing zone):** currently has no chunk matching -- confirmed. The matcher lives in envelope-classifier only. 085.3 adds chunk matching to the observe middleware independently (matcher-cache is now a per-instance concern on EnvelopeClassifier; observe will create its own matcher inline).

---

## Why now

Words only: sugarlang teaches and tracks LEMMAS. There is no teaching of FUNCTIONS (greeting, thanking, requesting) or pragmatics anywhere -- the strategy calls this the single biggest pedagogy gap. The science is settled: the notional-functional syllabus keyed to CEFR can-do descriptors is how CONCEPTS are sequenced; formulaic sequences are stored whole and carry most pragmatic appropriateness (teach "buenos dias" as an unanalyzed whole); situation + ONE light explicit line beats either alone (Taguchi 2015).

CORRECTION to the strategy's premise (verified 2026-07-26, supersedes the 2026-07-24 audit): the chunk EXTRACTOR IS BUILT AND ACTIVE. extract-chunks.ts (compile/) is an LLM-backed extractor with schema validation, marked "Status: active", consumed by the chunk cache, the tier-2 authoring scheduler (config.ts `chunkExtraction`, cost-gated), and the publish pipeline; the classifier holds a per-scene chunk matcher cache (envelope-classifier.ts `chunkMatcherCache`, fed from `sceneLexicon.chunks`). What is verifiably MISSING is everything downstream of extraction:

- Chunks are not FSRS items: card-store.ts has zero chunk awareness -- learner cards are lemma-only, so an extracted chunk is matched by the classifier but never tracked, scheduled, or re-fed.
- No function inventory exists: nothing keys chunks to communicative functions or CEFR can-do descriptors; nothing marks which functions a scene or NPC can realize.
- No explicit-beat surface, no pragmatic feedback rules, no meta-language item zero.

So this epic's spine is NOT "build the extractor" (internal epic 14's runtime half exists) -- it is the inventory, the learner-model integration, and the teaching loop around chunks.

## Non-goals

- No grammar as explicit content (strategy invariant): grammar arrives implicitly via graduated clauses and recasts (epic F owns recasts).
- No outer-loop scheduling of functions -- epic E consumes the inventory; this epic only produces it and its tags.
- No negotiation moves, no probe UI, no reply grading -- epic F.
- No new episode/content authored to serve the syllabus (decoupling invariant: functions are FOUND in content as authored).
- No second language: Spanish first; the inventory schema is language-keyed but only es ships populated.

## Design principles

- Hand-curated inventory, machine-tagged content: the function inventory is authored data (small, reviewable); which scenes/NPCs realize which functions is extracted at bake (the existing extractor pattern).
- Chunks are taught as unanalyzed wholes: one FSRS item per chunk, never decomposed into member lemmas for scheduling.
- The explicit beat is ONE light line, diegetic (journal note or mentor line) -- never a worksheet (anti-edutainment invariant).
- Errors are never socially punished: pragmatic feedback is in-fiction warmth/confusion/delight, cheap retries.
- Audit before build: story 085.1 re-establishes ground truth; every later story's scope adjusts to what it finds (consult code, not plans).

## Stories (EXECUTION ORDER)

### 085.1 Ground-truth audit + chunk-flow true-up

Map the ACTUAL chunk pipeline end to end: extraction (who triggers the tier-2 scheduler, what populates `sceneLexicon.chunks`), classification (what the chunk matcher feeds today -- coverage exemption? telemetry?), observation (does the observe middleware count chunk encounters at all?). Produce a short findings section IN THIS DOC (amendment) pinning what exists, what is dead, what is misdocumented -- the 2026-07-24 strategy audit and this doc disagree with the code in places already; settle it. Delete dead paths found (bias toward deletion).

Known true-up items (epic-review round 1, verified against code 2026-07-26 -- re-verify at pickup):
- BUG: `chunkMatcherCache` (envelope-classifier.ts, keyed `lang:contentHash`) caches a matcher that closes over the FIRST call's source text; every later call (including repair-candidate re-checks WITHIN the first turn) slices `surfaceMatched` (chunk-matcher.ts) from the stale text at new-token offsets, producing garbage strings in `chunk.hit-during-classification` telemetry and violation surfaceForm. Trie matching itself is unaffected. Fix (re-scope what the cache holds vs what closes over text) before 085.3 consumes matcher output.
- `chunkMatcherCache` is an unbounded Map across scenes; bound or accept explicitly.
- Contract inconsistency: `ObservationKind` union (contracts/observation.ts) omits "hovered-introduce" while `LemmaObservation` includes it; true up while extending kinds in 085.3.

- Exit: amendment committed; every later story's assumptions re-anchored; any dead chunk code deleted with tests updated; the matcher-cache bug fixed with a regression test.

### 085.2 The function inventory (data + contracts)

Hand-curated inventory: function id, display name, CEFR can-do reference, band, realizing chunks per language (chunk text + variants), placement-gating fields. The META-LANGUAGE set is item zero: "Que es...?", "No entiendo", "Mas despacio, por favor", "Como se dice...?" -- flagged placement-gated (known at placement = never taught; true beginner = station-manager-introduced, decaying reminders -- the reminder mechanics land in F, the flags land here). Schema versioned, lives with the sugarlang lexicon assets (data/languages/es + data/schemas, the existing schema-versioned home). Gate predicate honesty (round 2): placement persists a BAND (assessment.evaluatedCefrBand) plus lemma seeds -- there is no per-chunk placement evidence. The placement-gate field is therefore a band threshold ("gated below A2" style), NOT chunk-level known/unknown; epic F inherits that contract, not an unanswerable one.

- Exit: inventory contract + es seed data (item zero + the first ~10 everyday functions: greet, thank, request, ask-what, ask-where, buy, refuse politely...); unit tests pin schema + lookup; docs/api page for the format.

### 085.3 Chunks as first-class FSRS items

Card-store gains a chunk item kind beside lemmas (keyed by chunk id, never by member lemmas); observation kinds extend to chunk encounter/production with grade-table entries; the observe middleware runs the chunk matcher itself over finalized turn text (see blast radius -- NOT a verify-side seam). Persistence rides the existing card store (IndexedDB); no new SaveParticipant unless the audit finds session-scoped state.

Named blast radius (epic-review rounds 1-2):
- Matching runs IN OBSERVE, not via a verify-side seam (round-2 correction): the verify middleware returns BEFORE the classifier in scripted mode and on its other bypasses (verifyEnabled=false, pre-placement), so any verify-to-observe annotation seam would silently drop chunk encounters from scripted dialogue -- contradicting the "functions are FOUND in content as authored" invariant. Instead the observe middleware runs the chunk matcher itself over the finalized turn text (observe already has scene access via sceneLexiconStore; the matcher is cached per contentHash and is a cheap trie -- reuse the classifier's matcher, do not build a second one). This is mode-independent (agent + scripted + deterministic turns) and needs no new middleware seam. Depends on 085.1's matcher-cache fix.
- Key namespacing: the card store's IDB keyPath is "lemmaId" and chunk ids are underscore-normalized ("buenos_dias") while lemma ids legitimately contain underscores (es data ships "recursos_humanos", "fiesta_mayor") -- byte-for-byte collision is possible. Use a "chunk:" key-prefix stored in the lemmaId field (":" is unreachable by both normalizers; NO schema/DB-version change) rather than a composite key (keyPath change = DB version 2 + migration). Collision test required, and it must pin that prefixed chunk cards flowing into profile.lemmaCards consumers (loadLearnerProfile pages ALL cards) stay inert in lemma-keyed lookups -- specifically including the two all-card iterators beyond the profile load: the teacher prompt-builder's due/active/struggling lists (a "chunk:" id must not surface as a lemma in the teacher prompt) and computePendingProvisionalLemmas (a chunk card with provisional evidence must not enter the probe-floor pipeline).
- FSRS priors: getInitialLemmaCard seeds priors from the atlas, which has no chunk entries -- chunk-card priors seed from LexicalChunk.cefrBand instead.
- Single-writer: chunk-card and teach-record writes go through LearnerStateReducer (already serialized via its queue).
- Scope fence: chunk cards get FSRS state, observation updates, and due-queue computability. Feeding chunks into the PRESCRIPTION pipeline (LexicalPrescription / directive / targetVocab / overlay are all LemmaRef-typed) is NOT this story -- that contract ripple belongs to epic E (087), which schedules functions. This story only tracks.

- Exit: encountering a matched chunk in NPC text creates/updates a chunk card in BOTH agent and scripted modes (integration tests for both); produced chunk (string-match floor; LLM grading is F) updates productive strength; chunk cards are due-computable beside lemma cards (no prescription integration); telemetry carries chunk observation events; a debug surface lists chunk cards (verification recipe 3 depends on it).

### 085.4 Function tagging (scene + NPC) -- derived at read, not baked

RE-GROUNDED (epic-review round 1): chunk extraction is NOT in the bake pass -- compileSugarlangScene is chunk-pure (epic 14 rule 1) and chunks join the lexicon asynchronously at three points (scheduler writeback, publish pipeline, scene-lexicon-store). Function tags therefore:

- Scene tags: DERIVED AT READ TIME from `sceneLexicon.chunks` + the function inventory (the chunk-to-function join is deterministic and cheap). Tags are never stored in the compiled artifact -- this sidesteps the invalidation hole where an INVENTORY edit changes no content hash and stored tags silently go stale. One source of truth: the inventory.
- NPC tags: LexicalChunk carries no source attribution (unlike SceneLemmaInfo.npcSourceIds), and extractor surfaceForms are scene-global. Mechanism: re-run the EXISTING chunk matcher deterministically over per-NPC text at tag-read time -- reuse, no LLM call, no extractor prompt-version bump. Attribution detail (round 2): dialogue text blobs carry NO npcDefinitionId (only bio/lore blobs do) -- the NPC join for dialogue goes through `dialogue.interactionBinding.npcDefinitionId`; count only NPC-spoken nodes toward an NPC's tags (player-spoken nodes in a bound dialogue count toward the SCENE tag but not the NPC's "can realize" tag). The discriminator is `DialogueNodeDefinition.speakerId` checked against the built-in player-speaker ids (the same discrimination isPlayerSpokenTurn uses on turns); pin the undefined-speakerId default (= bound NPC) in a test.
- These tags are epic E's whole-board read ("the player is about to meet a lot of people -- this is the moment for greetings").

- Exit: a tag-resolver function returns scene + NPC function tags from lexicon + inventory; unit tests pin the join + per-NPC attribution; an inventory edit changes resolver output with NO recompile (test); a fixture scene shows greet/thank tagged from its authored dialogue.

### 085.5 The explicit beat (teach-record + dialogue-line floor)

RE-GROUNDED (epic-review round 1): there is NO journal/notebook/phrasebook system in the repo -- the only "journal" is the quest journal (runtime-core QuestJournal.ts), a quest-view renderer with no free-note write API. The original "journal entry visible in the journal UI" floor presumed a surface that does not exist. Re-scoped floor:

- Trigger ("first taught" defined IN THIS EPIC): the first classifier-matched encounter of a realizing chunk that CREATES its chunk card (085.3's creation event) counts as the function's first teach. No scheduling involved -- epic E owns scheduling; this is purely reactive to encounters.
- Record: a per-function teach-record persists in the sugarlang learner store beside the cards (functionId, taughtAtMs, realizingChunkId). The record is the no-rewrite guard and the data any future journal/phrasebook UI renders.
- Delivery floor (round-2 correction -- the round-1 "labeled line append" was ALSO fiction; DialoguePanel's public surface is show/hide/showTurn/showPending/clearHistory, showTurn wipes the active container, and plugins cannot touch the panel directly): sugarlang writes a teach-line ANNOTATION on the finalized turn, and DialoguePanel renders it as a labeled sub-line -- the same annotation-driven render pattern as the existing dialogueHighlight seam (observe writes the annotation, the panel reads it). The panel's dead `enrichmentContainer` (created and cleared but never populated) is the natural render slot. This is a SMALL runtime-core change owned by this story: annotation contract + render, respecting the plugin contract boundary (no plugin reaches into the panel). UI copy minimal: label + the one line -- "That was a greeting. The polite form is..."
- Storage detail: the teach-record store is either a new object store in the version-1 card-store DB (requires DB version bump + upgrade handler) or a sibling profile-scoped store; either way it MUST be covered by the learner-data reset enforcer (which deletes by the card-store DB-name prefix). Wall-clock taughtAtMs is fine here: the store is profile-scoped (not a save slot), sits beside FSRS cards that already persist real timestamps, and the no-rewrite guard keys on record existence, not time.
- Browsable phrasebook/journal UI: DEFERRED to epic 089 (diegetic review) -- see Deferred section for the trigger.

- Exit: first realized teach of a function writes exactly one teach-record + one teach-line annotation, and the panel renders it as a labeled sub-line (integration incl. the runtime-core render); re-encounters write neither (no-rewrite test); teach-records visible on the learner debug surface; reset enforcer clears teach-records (test).

### 085.6 In-fiction pragmatic feedback rules + interpretLexicon feed

(a) Pragmatic feedback: when the player uses/misuses a taught function, the NPC's reaction guidance rides the existing constraint prompt surfaces (and epic H's contribution surfaces where they fit) -- warmth on success, gentle confusion on misuse, NEVER correction-as-punishment; recast mechanics stay in F. (b) The inventory feeds the interpretLexicon contribution (replacing 084.5's curated starter list) so NPCs mechanically recognize the moves the game teaches -- the 084 cross-dep, closed from this side.

BOUNDARY (epic-review round 1): interpretation.ts consumes exactly FOUR lexicon categories (farewell, greeting, gratitude, acknowledgement); unknown categories are silently ignored by design, and 084's Deferred section assigns "que?"-style non-understanding moves to epic F's negotiation detection (the DEFERRED comment sits in interpretation.ts at the category seam). So: 085.6 feeds ONLY the four existing categories from inventory data. Item-zero RECOGNITION (new categories + non-understanding detection) lands in epic F -- item zero still ships as inventory DATA in 085.2 and is taught/tracked via 085.3/085.5; only its interpret-side recognition waits for F.

- Exit: prompt-level tests pin the feedback guidance shapes; the interpretLexicon contribution for the four existing categories is generated from the inventory (unit); "gracias" recognition path now sources from inventory data (integration, extends 084.5's tests); a test pins that item-zero chunks do NOT leak into the four categories.

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean; the 085.1 amendment section exists in this doc.
2. Inventory probe: open the es inventory data; item zero + starter functions present and readable.
3. Learner probe: talk to an NPC until a greeting chunk appears in NPC speech; the chunk card shows up in the learner store (debug surface, shipped in 085.3) and is due-computable later.
4. Beat probe: first taught function appends one light line in the dialogue panel and writes one teach-record; neither duplicates on the next conversation.
5. Recognition probe: type "gracias" -- NPC acknowledges (inventory-sourced, not the 084 starter list; verify via the contribution debug dump).
6. Tag probe: edit the inventory (add a chunk variant), reload WITHOUT recompiling the scene -- the tag resolver reflects the edit (085.4 derive-at-read).

## Epic wrap

docs/api: function-inventory format page; learner-model page (chunk items, new observation kinds); middlewares page (feedback guidance). Strategy 002 epic B status. The 085.1 amendment folded in. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Mentor-line delivery of the explicit beat: revisit when epic E's scheduler can pick the mentor + moment (code comment at the teach-record emitter).
- Browsable phrasebook/journal UI for taught functions: no journal system exists in the repo; the teach-record (085.5) is the data it would render. Revisit in epic 089 (diegetic review), which owns the review surface (code comment at the teach-record store).
- Item-zero interpret-side recognition (new lexicon categories + non-understanding detection): epic F's negotiation detection; the category seam is marked DEFERRED in interpretation.ts. Item zero ships as data + teach flow in this epic.
- Chunks in the prescription pipeline (LemmaRef-typed LexicalPrescription/directive/targetVocab): epic E (087) when the outer loop schedules functions; 085.3 only tracks (code comment at the chunk-card kind).
- Chunk decomposition ("decompose much later or never"): revisit only on playtest evidence that whole-chunk knowledge fails to transfer.
- Function inventory beyond the starter set: grow with episodes; the schema is the deliverable, not coverage.
- LLM-graded chunk production: epic F's reply grading; string-match is the floor here.
- Italian inventory: with the Italian pack decision (A left it finish-or-hide).
