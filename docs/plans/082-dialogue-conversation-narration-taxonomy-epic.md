# Plan 082 -- Dialogue / Conversation / Narration Taxonomy (epic)

Status: Draft (queued behind Plan 081; needs epic-review gate before any story is built)
Owner: nikki + claude
Date: 2026-07-25

Related:
- Plan 081 (sugarlang foundation completion) -- story 081.3 landed the exhaustive conversationKind gate this epic's Stage A extends; 081 completes before this epic starts
- Origin: 2026-07-25 conversation during 081.3 -- the interactionMode/conversationKind confusion exposed that "conversation" is being used as an umbrella for three distinct content kinds

---

## Why

The dialogue system has evolved into the universal "show authored text in the panel"
mechanism, and the vocabulary rotted along the way. DialogueManager is really the
conversation session manager: it hosts authored scripted trees, live LLM-backed
exchanges, AND presentation text (a spell effect at gameplay-session.ts:2053 calls
`dialogueManager.start(effect.targetId)` because a dialogue tree is the only way to
put text on screen). Three different things share one name and one pipeline, which
is exactly how the 071.5/081.3 bypass bug happened: an NPC-config attribute
(interactionMode) was used as a proxy for a session-structure attribute
(conversationKind) because nobody could say precisely what either meant.

Pinned vocabulary (the contract of this epic):

- **dialogue** -- authored scripted trees; characters speaking to the player
- **conversation** -- live LLM-backed dynamic exchange
- **narration** -- system text describing the world: spell results, item
  descriptions, inspection text. NARRATOR_SPEAKER already exists in the domain
  package; the concept is half-born and never got promoted to a first-class kind.

Interim state this epic corrects: under 081.3, spell-cast dialogue trees run
through the sugarlang conversation pipeline (they are `scripted-dialogue`
structurally). The speaker-level filter (isNonAdaptableSpeaker,
sugar-lang-scripted-middleware.ts) exempts narrator/VO lines from adaptation, so
pure description trees pass through untouched in practice -- the wrongness is
conceptual, not player-visible. No urgency; correctness of the seam is the point.

## Non-goals

- No narration teaching in this epic. Narration WILL eventually get language
  teaching, but it needs a different pedagogy (reading-comprehension shaped:
  leveled glossed text, vocabulary exposure through descriptions, hover-to-learn
  -- no turn-taking, no probes, different constraint shape and telemetry). That
  is its own future epic; this epic only draws the seam it will dispatch from.
- No new presentation UI. Narration keeps rendering through the existing dialogue
  panel until Stage C, which is deferred until a real feature (item inspection,
  spell readouts) pulls on it.
- No renaming of NpcDefinition.interactionMode. It is correctly an NPC authoring
  attribute ("how does this NPC converse by default": agent | scripted) and stays.

## Design principles

- One source of truth: content kind is declared by the entry site (the code that
  starts the session), never inferred from speakers or NPC config downstream.
- Single enforcer: the sugarlang gate remains ONE exhaustive switch
  (shouldRunSugarlangForExecution) -- adding a kind breaks the build at every
  gate until each explicitly handles it. That compiler pressure is the tool this
  epic leans on; do not add defensive checks elsewhere.
- Bias toward deletion: Stage B deletes the old value strings entirely rather
  than aliasing them.
- Additive before structural: Stage A (add narration) is load-bearing and cheap;
  Stage B (rename) is paint; Stage C (structural teardown) waits for a feature.

## Stories (EXECUTION ORDER)

### 082.1 Stage A -- narration becomes a first-class ConversationKind

Add `"narration"` to ConversationKind (runtime-core/src/conversation/index.ts:23).
The exhaustive switches landed in 081.3 will surface every gate that must decide;
handle each explicitly, no default cases.

Entry-site classification (the caller declares, per design principle 1):
- spell effect dialogue (gameplay-session.ts:2053 area) -> `narration`
- quest-narrative .start and scripted-followup .start -> `dialogue`
  (mixed trees with narrator beats stay `dialogue`; the speaker-level filter
  handles narrator lines inside them)
- NPC interact paths -> `dialogue` / `conversation` per existing resolution

Decide-in-story: how the kind reaches DialogueManager.start(), which currently
hardcodes `conversationKind: "scripted-dialogue"` (DialogueManager.ts:151-156) --
likely an options parameter defaulting to dialogue. The scripted-dialogue
provider must accept narration sessions (it plays trees regardless of kind).

Sugarlang gate: `case "narration"` returns false TODAY, with the deferred-trigger
comment at that case (see Deferred below) -- the gate is a dispatch point for a
future narration-teaching pipeline, not a permanent exclusion.

- Exit: build passes with the third kind handled at every switch; spell-cast
  trees run as narration and skip the sugarlang conversation pipeline entirely
  (integration test extends 081.3's execution-gates.test.ts); quest/followup
  trees still adapt; grep shows zero sites inferring content kind from speakers
  or interactionMode.

### 082.2 Stage B -- rename the legacy kind values

`"scripted-dialogue"` -> `"dialogue"`, `"free-form"` -> `"conversation"`.
Mechanical compiler-driven sweep (type is a string union; every literal fails
type-check until renamed).

Precondition audit (decide-in-story): where do the old strings leak beyond
source? Known suspects: telemetry events carry conversationKind into IndexedDB
(and post-081.2, into gateway stdout/Cloud Logging); turn envelopes carry it;
E2E goldens from 081.5 will contain the literals. Saves are believed clean
(selections are session-ephemeral, no SaveParticipant persists one) -- verify.
Old analytic rows with old strings are tolerable; a save-format leak would need
a migration shim and must be ruled out before the rename lands.

- Exit: grep-clean for "scripted-dialogue" and "free-form" across packages and
  apps; tests green; persistence audit documented in the story notes.

### 082.3 Stage C -- narration leaves the dialogue panel (DEFERRED TRIGGER, not scheduled)

When a real narration feature arrives (item inspection, spell readouts), those
almost certainly want their own presentation (a readout surface, not a dialogue
box with an advance button). At that point: pull narration rendering out of
DialogueManager into its own presenter path, leaving DialogueManager genuinely
hosting only dialogue + conversation -- and rename it THEN, once, when the final
shape is visible (candidates: TalkManager, SpeechSessionManager, ExchangeManager;
nikki picks). Renaming a widely-referenced class mid-evolution is churn we would
redo; this story exists so the rename has a designated moment.

- Trigger: first story anywhere that builds item inspection, spell readout UI,
  or any narration-only surface. That story must reference this one.

## Deferred

- **Narration teaching (own future epic).** Narration content gets language
  teaching with a reading-comprehension pedagogy: leveled/glossed description
  text, vocabulary exposure, hover-to-learn -- no turn-taking, no probes,
  different constraint shape and telemetry than the conversation pipeline.
  Revisit triggers: (1) 082.1's `case "narration"` in
  shouldRunSugarlangForExecution -- the code comment there is the load-bearing
  pointer and 082.1 must write it; (2) any design work on item inspection or
  spell readout content, which should raise "do these teach?" before shipping
  untaught text at scale.
- **Spell effects that trigger real character dialogue.** 082.1 defaults spell
  dialogue effects to narration. If an author wants a spell to make a character
  speak (magic is real here), the effect needs a way to declare kind=dialogue.
  Revisit trigger: first authored spell whose tree contains character speakers;
  the 082.1 entry-site code comment marks the spot.
