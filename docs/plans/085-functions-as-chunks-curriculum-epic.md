# Plan 085 -- Functions-as-Chunks Curriculum (child epic B of Strategy 002)

Status: DRAFT (pre-drafted 2026-07-26 ahead of pickup; pending epic-review)
Owner: nikki + claude
Date: 2026-07-26

Related:
- Strategy 002 (docs/plans/strategy/002-sugarlang-adaptive-language-acquisition-strategy.md) -- child epic B, the curriculum spine ("Functions are chunks")
- Plan 084 (epic H) -- cross-dep: the meta-language item-zero chunks FEED the interpretLexicon contribution (084.5 ships a curated starter list; this epic replaces it from the inventory)
- Plan 087 (epic E) -- consumer: the outer loop schedules functions from this epic's inventory and reads this epic's scene/NPC function tags
- Sugarlang internal proposal 001 (Lexical Chunk Awareness) + internal epic 14
- Ground truth: PARTIALLY verified 2026-07-26 (see the correction in Why now); full re-audit at pickup is story 085.1, not optional -- line refs drift and this doc was written ahead of time

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

- Exit: amendment committed; every later story's assumptions re-anchored; any dead chunk code deleted with tests updated.

### 085.2 The function inventory (data + contracts)

Hand-curated inventory: function id, display name, CEFR can-do reference, band, realizing chunks per language (chunk text + variants), placement-gating fields. The META-LANGUAGE set is item zero: "Que es...?", "No entiendo", "Mas despacio, por favor", "Como se dice...?" -- flagged placement-gated (known at placement = never taught; true beginner = station-manager-introduced, decaying reminders -- the reminder mechanics land in F, the flags land here). Schema versioned, lives with the sugarlang lexicon assets.

- Exit: inventory contract + es seed data (item zero + the first ~10 everyday functions: greet, thank, request, ask-what, ask-where, buy, refuse politely...); unit tests pin schema + lookup; docs/api page for the format.

### 085.3 Chunks as first-class FSRS items

Card-store gains a chunk item kind beside lemmas (keyed by chunk id, never by member lemmas); observation kinds extend to chunk encounter/production with grade-table entries; the observe middleware counts chunk encounters via the existing classifier chunk matcher output. Persistence rides the existing card store (IndexedDB); no new SaveParticipant unless the audit finds session-scoped state.

- Exit: encountering a matched chunk in NPC text creates/updates a chunk card (integration through observe); produced chunk (string-match floor; LLM grading is F) updates productive strength; FSRS due queue interleaves chunk + lemma items; telemetry carries chunk observation events.

### 085.4 Bake-time function tagging (scene + NPC)

Extend the bake pass so extracted chunks map to inventory functions, and scenes/NPCs get "can realize function X" tags -- the extractor already authors chunk metadata at bake; this adds the function join + artifact plumbing with the usual content-hash invalidation. These tags are epic E's whole-board read ("the player is about to meet a lot of people -- this is the moment for greetings").

- Exit: compiled scene artifacts carry function tags; cache round-trip + invalidation-on-edit tests; a fixture scene shows greet/thank tagged from its authored dialogue.

### 085.5 The explicit beat (journal note floor)

One light explicit line when a function is first taught: floor is a journal entry ("That was a greeting. The polite form is..."), emitted from the teaching event; mentor-line delivery is a ceiling (needs E's scheduling, deferred there). UI copy minimal: label + the one line.

- Exit: first realized teach of a function writes exactly one journal entry (integration); re-encounters do not re-write it; entry visible in the journal UI.

### 085.6 In-fiction pragmatic feedback rules + interpretLexicon feed

(a) Pragmatic feedback: when the player uses/misuses a taught function, the NPC's reaction guidance rides the existing constraint prompt surfaces (and epic H's contribution surfaces where they fit) -- warmth on success, gentle confusion on misuse, NEVER correction-as-punishment; recast mechanics stay in F. (b) The item-zero + taught-function chunks feed the interpretLexicon contribution (replacing 084.5's curated starter list) so NPCs mechanically recognize the moves the game teaches -- the 084 cross-dep, closed from this side.

- Exit: prompt-level tests pin the feedback guidance shapes; the interpretLexicon contribution is generated from the inventory (unit); "gracias" recognition path now sources from inventory data (integration, extends 084.5's tests).

## Verification recipe (nikki)

1. `pnpm test` green, `pnpm lint` clean; the 085.1 amendment section exists in this doc.
2. Inventory probe: open the es inventory data; item zero + starter functions present and readable.
3. Learner probe: talk to an NPC until a greeting chunk appears in NPC speech; the chunk card shows up in the learner store (debug surface) and re-appears in the due queue later.
4. Beat probe: first taught function writes one journal line; it does not duplicate on the next conversation.
5. Recognition probe: type "gracias" -- NPC acknowledges (inventory-sourced, not the 084 starter list; verify via the contribution debug dump).

## Epic wrap

docs/api: function-inventory format page; learner-model page (chunk items, new observation kinds); middlewares page (feedback guidance). Strategy 002 epic B status. The 085.1 amendment folded in. Backlog sweep of DEFERRED SEAM comments.

## Deferred / out of scope (with revisit triggers)

- Mentor-line delivery of the explicit beat: revisit when epic E's scheduler can pick the mentor + moment (code comment at the journal-entry emitter).
- Chunk decomposition ("decompose much later or never"): revisit only on playtest evidence that whole-chunk knowledge fails to transfer.
- Function inventory beyond the starter set: grow with episodes; the schema is the deliverable, not coverage.
- LLM-graded chunk production: epic F's reply grading; string-match is the floor here.
- Italian inventory: with the Italian pack decision (A left it finish-or-hide).
