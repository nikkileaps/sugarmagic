# Plan 001: Welcome to Wordlark Hollow — Station Manager Placement Experience

**Status:** Proposed
**Date:** 2026-04-09
**Derived from:** [Proposal 001: Adaptive Language Learning Architecture](../proposals/001-adaptive-language-learning-architecture.md) § Cold Start Sequence, § Placement Interaction Contract

## Context

This plan describes the first authored language-learning experience a new player encounters in the game: a diegetic CEFR placement interaction with the **Station Manager** NPC in **Wordlark Hollow**, the game's opening region. The architecture in Proposal 001 specifies *how* sugarlang's placement capability works (capability contract via NPC metadata tag, Bayesian posterior sharpening, completion signal via quest flag and event). This plan specifies *what* the actual authored experience looks like on top of that capability — the NPC, the quest, the voice, the question bank, and the editor affordances required to wire it all together.

This is content work plus a small set of plumbing extensions. No changes to the core sugarlang architecture are proposed here; this plan is strictly an implementation of the already-specified Placement Interaction Contract.

## Why This Plan Exists

Proposal 001 handwaved the placement experience with a generic description ("the first quest is meeting a tutorial-shaped NPC — the village dockhand, the innkeeper, whoever fits the world"). That generic description is correct as architecture but unspecific as content. For the player, the placement experience is their *first impression* of both the game and sugarlang — it sets expectations for tone, pacing, difficulty, language ratio, and "is this game going to teach me or just test me." Getting it wrong loses players in the first five minutes.

This plan locks in the concrete first-impression experience and identifies the specific implementation work required to ship it.

## Design Goals for the Experience

1. **Diegetic, never ceremonial.** The player should never feel they are being assessed. They should feel they are arriving somewhere and being greeted.
2. **Calibrated in ~8 exchanges, ≤5 minutes of wall time.** Longer than that and the player will bounce before the game proper starts.
3. **Character-voiced, not clinical.** The Station Manager has a personality; his questions reflect who he is, not a generic CEFR probe.
4. **Bilingual naturalism explains the difficulty ramping.** A station manager in a hub world reasonably code-switches because travelers come from everywhere. This gives the character an in-world reason to probe higher and lower difficulty within the same conversation.
5. **Replayable without re-placement.** Once placement completes, the Station Manager becomes a normal conversational NPC. The player can chat with him later for flavor without re-running the questionnaire.
6. **Works identically in Preview and Published.** Per `AGENTS.md` and the compile-profile discipline from Proposal 001, the Station Manager's content, question bank, and compiled scene lexicon all follow the one-compiler-three-profiles pattern. No editor-only fakes.

## Cast

### The Station Manager

**Working name:** *Orrin Lark* (placeholder; can rename without changing anything mechanical)

**Role:** The Station Manager of Wordlark Hollow Station, the arrival point for every new traveler in the game. He greets new arrivals, takes their manifests, orients them, and usually points them toward the village proper.

**Voice and character:**

- Warm, curious, unflappable. The kind of person who has seen a thousand travelers and is still genuinely interested in the thousand-and-first.
- A polyglot out of necessity, not snobbery. He asks in the target language first, switches to the support language if he senses the traveler isn't keeping up, and quietly notes the traveler's level for his records.
- Professionally nosy in a friendly way. He asks follow-ups because it's his job to know who's passing through, not because he's interrogating.
- Dry sense of humor; occasional aphorisms about travelers. "Everyone arrives tired. Most leave rested. A few leave wiser." This is the seam for later narrative callbacks.

**Bio (lore page draft, ~120 words — this is what sugarlang's Director will actually see):**

> Orrin Lark has been the Stationmaster of Wordlark Hollow for nineteen years. Before that, he was a courier, and before that, a child who grew up in four towns and picked up scraps of every tongue they spoke. He keeps the station's manifest, sorts the incoming mail, stamps the travel papers, and — most importantly to him — greets every new arrival personally. He says a first impression of a place is the most honest one a traveler will ever have of it, and he wants Wordlark Hollow's first impression to be a good one. He is rarely surprised, frequently amused, and quietly proud of the fact that in nineteen years he has never once misjudged which language to greet a traveler in.

**Presentation:** model height 1.75m, weathered station uniform, holds a clipboard (authorable later). Idle animation: shifting his weight, glancing at the clipboard. Walk animation: steady, unhurried. No combat animations needed.

**Interaction mode:** `"agent"` (free-form SugarAgent-backed conversation).

**Metadata:** `{ sugarlangRole: "placement" }` — this is the tag that activates sugarlang placement mode.

**Lore page:** The bio above, plus ~3 additional paragraphs of back-story (his family, his favorite station story, his opinion of the village proper) so SugarAgent's retrieval stage has enough material to ground off-topic player questions. Standard lore-page authoring, nothing special.

## The Quest: Welcome to Wordlark Hollow

**Quest definition:**

- **Display name:** Welcome to Wordlark Hollow
- **Start stage:** `arrival`
- **Stages:**

### Stage 1: `arrival` — "Meet the Stationmaster"

Single objective node:

- **Node kind:** `objective` / `talk`
- **targetId:** the Station Manager's NPC definition ID
- **Display name:** "Meet the Stationmaster"
- **Description:** "The Stationmaster is waiting on the platform. He wants to say hello."
- **eventName:** `"sugarlang.placement.completed"` — the objective closes automatically when sugarlang fires this event, which happens when the placement posterior sharpens past the confidence threshold or the turn ceiling is reached
- **showInHud:** `true`
- **autoStart:** `true`
- **onCompleteActions:** none — the stage transitions automatically because this is the only objective

### Stage 2: `orientation` — "Find the Village"

Triggers when Stage 1 closes. The Stationmaster points the player toward the village proper; the player walks off the platform into the first gameplay loop. This stage is normal authored quest content — it has nothing to do with sugarlang. Once the placement is done, the placement capability is fully out of the picture; normal sugarlang budgeting takes over and the player's ongoing experience flows through the regular pipeline.

Sugarlang involvement ends at the transition between Stage 1 and Stage 2. The Station Manager remains a normal conversational NPC with his `sugarlangRole: "placement"` tag still attached, but the tag is inert because `SUGARLANG_PLACEMENT_STATUS_FACT` is now `"completed"` (per the Proposal 001 contract, "Once completed, the tag becomes inert"). The player can come back and chat with him anytime for flavor.

## The Placement Questionnaire (plugin-shipped, not project-authored)

**Important:** the placement question bank is **plugin-shipped content** per Proposal 001 § Cold Start Sequence — not authored by this project. Every project that uses sugarlang inherits the same canonical questionnaire per language from `packages/plugins/src/catalog/sugarlang/data/languages/<lang>/placement-questionnaire.json`. The Wordlark Hollow project does NOT need to author or customize the questions.

What Wordlark Hollow DOES need to author:

1. **The dialog wrapper lines** that Orrin speaks before and after the questionnaire (~4–6 lines total of in-character warm dialog)
2. **The arrival scene** (the station, the platform, the airship, the visual and spatial setup)
3. **The NPC card** for Orrin Lark with his lore page and presentation profile
4. **The "Welcome to Wordlark Hollow" quest definition** that closes on the `sugarlang.placement.completed` event

The questionnaire UI itself is a plugin primitive — when the placement flow enters its `questionnaire` phase, the conversation host switches from the normal dialog panel to the `PlacementQuestionnairePanel` component (Epic 11 Story 11.2) and shows the shipped form.

### Why plugin-shipped not project-authored

Earlier drafts of this plan had Wordlark Hollow authoring its own character-voiced question set. That approach was dropped because:

- Every project repeating the same content authoring work is waste
- Ensuring native-speaker review for each project is unrealistic for indie dev
- The standard questions feel like an arrival form anyway, which is a universal diegetic framing
- Per-project customization is a v1.1 feature with a clear extension point (`NPCDefinition.metadata.sugarlangPlacementQuestionnaireOverrideId`, currently ignored by v1)

If Wordlark Hollow ever wants to override the questions (e.g. to add world-specific lore references), that's a v1.1 content capability, not a v1 engineering one.

### Questionnaire structure (plugin-shipped; documented here for reference)

The question bank for **Wordlark Hollow specifically** is the set of authored lines the Station Manager can deliver during placement. They are voiced for him (dry, warm, curious) rather than generic CEFR probes. The Director picks which question to use next based on the current Bayesian posterior.

### Structure

```jsonc
{
  "placementQuestions": [
    {
      "questionId": "greet_arrival_a1",
      "targetBand": "A1",
      "probeKind": "recognition",
      "speakerLines": [
        { "language": "es", "text": "Bienvenido a Wordlark Hollow. ¿Cómo te llamas?" },
        { "language": "it", "text": "Benvenuto a Wordlark Hollow. Come ti chiami?" }
      ],
      "expectedLemmas": ["bienvenido", "llamarse", "nombre"],
      "fallbackToSupportLanguage": "Welcome to Wordlark Hollow. What's your name?",
      "characterNote": "Warm opener, clipboard already in hand."
    },
    {
      "questionId": "travel_purpose_a2",
      "targetBand": "A2",
      "probeKind": "production",
      "speakerLines": [
        { "language": "es", "text": "¿Qué te trae por aquí, viajero?" },
        { "language": "it", "text": "Cosa ti porta qui, viaggiatore?" }
      ],
      "expectedLemmas": ["traer", "viajero", "aquí"],
      "fallbackToSupportLanguage": "What brings you here, traveler?",
      "characterNote": "Genuinely curious, not interrogating. Tone is 'I'd like to know you'."
    }
    // ... ~15 questions per language, A1 → A2 → B1 → B2, with 2–4 per band
  ]
}
```

### Content coverage target for v1

For each language (ES and IT at v1 per Proposal 001):

- **A1 probes (~4 questions):** greetings, name, origin, simple yes/no orientations ("are you tired," "first time here")
- **A2 probes (~4 questions):** reason for travel, short narratives about the journey, weather small talk, present-tense preferences ("do you like the sea," "do you prefer mornings")
- **B1 probes (~4 questions):** past-tense travel stories, hypothetical plans, slightly more abstract questions ("what are you hoping to find here," "have you been to places like this before")
- **B2 probes (~3 questions):** opinion-shaped questions, multi-clause responses expected, subjunctive territory ("if you could change one thing about the last place you stayed, what would it be")

Each question is authored to feel like something *Orrin specifically* would ask — dry, curious, slightly weathered. This is character voice work, not CEFR engineering. The CEFR grading of the question itself is what sugarlang cares about; the character grading is what the player cares about.

### Authoring workflow

**The question bank is plugin-shipped content, authored once per language by whoever ships the plugin, and consumed by every project.** Wordlark Hollow does NOT author its own questions. The plugin ships `data/languages/es/placement-questionnaire.json` and `data/languages/it/placement-questionnaire.json` (Epic 4 Story 4.2 and 4.3). Wordlark Hollow's content authors write Orrin's dialog wrapper lines — the ~4–6 lines of warm character dialog that bracket the questionnaire — but not the questionnaire itself.

## Placement Flow Walkthrough

The player's experience, phase by phase, for the Wordlark Hollow arrival. Italian learner example, but the flow is identical for every language.

### Phase 1: Opening dialog (pipeline BYPASSED, ~2 turns, zero LLM calls)

Player spawns in the Wordlark Hollow station platform. The airship has just arrived. Orrin is standing at a small wooden counter with a clipboard. The player approaches and initiates conversation.

> **Orrin:** *"Welcome to Wordlark Hollow. First time through here, I take it? Good — everyone's first time is worth marking. Come on up to the counter, no one bites."*

Behind the scenes: the full sugarlang pipeline is **bypassed** for the opening dialog phase per Proposal 001 § Pre-Placement Opening Dialog Policy. There is NO Budgeter call, NO Director call, and NO LLM call. The Context middleware detects `phase === "opening-dialog"`, selects one of Orrin's authored opening lines from the NPC's content data (written by the Wordlark Hollow content team in English, the player's support language), and stages it in `constraint.prePlacementOpeningLine`. The Generator splice reads the field and returns the line verbatim — no prompt assembly, no Claude call, no envelope check, no observation extraction. Orrin's voice is whatever the author wrote, and the line is spoken as-is.

This is the correct behavior because the learner's CEFR level is unknown at this point — the Director has no real pedagogical decision to make, so an LLM call here would be wasted cost at best and actively wrong at worst (it would calibrate to the A1 cold-start default, which might be wildly miscalibrated for a fluent learner). Speaking English from an authored line is honest and respectful: "I don't know what you know yet, so I'm defaulting to your first language until you tell me."

Player taps to continue.

> **Orrin:** *"Here — take this. Harbor rules: every arriving traveler fills out the form. Doesn't take long, no wrong answers, skip what you don't know. I'll stamp it for you when you're done and you can be on your way."*

Orrin slides a clipboard across the counter. The UI transitions from the conversation panel to the placement questionnaire panel. After 2 opening-dialog turns (the default `placement.openingDialogTurns`), the Context middleware advances the phase from `"opening-dialog"` to `"questionnaire"`.

### Phase 2: Questionnaire (plugin UI, no LLM calls, ~2-4 minutes of player time)

The questionnaire appears as a diegetic arrival form — paper/parchment-style background, Orrin's station logo in the corner, the form title "Arrival Declaration" in English. Below the title:

> *"Harbor authorities request the following information from all incoming travelers. Please answer in the target language where possible. You may skip questions you don't understand — just mark them with 'N/A' or leave them blank. Submit when finished."*

The form contains ~10–15 questions in Italian, shipped from `data/languages/it/placement-questionnaire.json`. Mix of question kinds:

- **Multiple choice** (A1 recognition): *"¿Come ti chiami?"* → [Mi chiamo Sam / Sam is my name / I am Sam]
- **Free text** (A1 production): *"Scrivi il tuo nome e il tuo paese."*
- **Yes/no** (A2 comprehension): *"Hai già visitato Wordlark?"* (yes / no buttons)
- **Fill in the blank** (A2 structure): *"Mi ___ Sam."* (expected: chiamo)
- **Free text** (A2 production): *"Scrivi una frase sul tuo viaggio."*
- **Multiple choice** (B1 comprehension): *"Cosa significa 'de vez en cuando'?"* → [from time to time / a moment ago / every day / never]
- **Free text** (B1 production): *"Descrivi un viaggio memorabile in due frasi."*
- *...etc., spanning up to B2...*

The player fills out whatever they can and hits "Submit." No LLM calls during the form. No timer, no pressure, no per-question validation pops. The player controls pacing.

On submission, the scoring engine (Epic 11 Story 11.1) runs deterministically:

- Tallies correct answers per CEFR band
- Finds the highest band where the learner hit ≥70% accuracy
- Computes confidence based on `answeredCount / totalCount`
- Collects all lemmatized content lemmas from free-text answers for FSRS seeding
- Writes `SUGARLANG_PLACEMENT_STATUS_FACT = { status: "completed", cefrBand: "A2", confidence: 0.72, completedAt: <ts> }`
- Fires `questManager.notifyEvent("sugarlang.placement.completed")` and `questManager.setFlag("sugarlang.placement.status", "completed")`
- Seeds FSRS cards for every lemma the player produced in free-text answers (as `produced-typed` observations)

Time elapsed: ~2–4 minutes. LLM calls: zero.

### Phase 3: Closing dialog (normal SugarAgent pipeline, ~2 turns)

The UI transitions back to the conversation panel. Orrin picks up the clipboard, glances at it, and makes a small in-character remark about the traveler based on what the scoring engine determined.

Behind the scenes: the Director now runs with a known CEFR estimate (A2, confidence 0.72). Orrin's closing lines are constrained by the learner's level — supported posture, parenthetical glossing for any A2+ word, target-language ratio ~0.5. The Director may pick from authored closing lines or generate a short in-character reply. For the Wordlark Hollow authoring, the project provides 2–3 canonical closing lines that the Director selects from.

> **Orrin:** *"Mm. Not bad. You've got a bit of Italian in you already — enough to get by in the village. The path down there (giù per il sentiero) will take you to the square. Ask for Maren (the innkeeper) when you arrive. She's expecting you."*

Player taps to continue.

> **Orrin:** *"Oh — and buona fortuna (good luck), Sam. Wordlark Hollow rewards the curious. Don't be a stranger."*

Orrin gestures toward the station exit. The player walks off the platform. The Welcome to Wordlark Hollow quest's Stage 1 objective ("Meet the Stationmaster") closes automatically because the `sugarlang.placement.completed` event fired during Phase 2. Stage 2 ("Find the Village") activates.

### Total

- **Wall time:** ~4–6 minutes of player time (1 min opening dialog + 2–4 min form + 1 min closing dialog)
- **LLM calls:** **2** — both during the closing-dialog phase (one Director call + one Generate call), using the now-known CEFR estimate. Opening dialog and questionnaire phases make zero LLM calls per Proposal 001 § Pre-Placement Opening Dialog Policy.
- **Cost at Claude Sonnet pricing:** ~$0.015 per placement
- **Outcome:** CEFR committed to A2 with confidence 0.72; FSRS cards seeded for ~5-10 lemmas the player typed in free-text fields; first quest visibly progressing.

**Compare to the earlier Director-driven draft:** the old flow was 8 LLM-driven turns (~20+ Claude calls total, ~$0.10 per placement, 5+ minutes of wall time, stochastic convergence, hard to test). The questionnaire flow with the Pre-Placement Opening Dialog Policy bypass is ~7x cheaper, 2x faster, byte-deterministic for the opening and questionnaire phases, and testable with frozen fixtures. The only loss is the "fully conversational" feel — but a customs form is a universally-legible diegetic framing that actually lands better than "this friendly NPC is secretly testing you."

The character voice and tone are the whole experience from the player's perspective. The Bayesian math is invisible. The fact that Orrin is making a careful judgment about your Italian is something you discover on reflection, not something you feel as a test.

## Required Editor / UX Affordances

Implementation work needed in the editor to make authoring this experience first-class. Each is a small ticket.

### 1. NPC inspector: "Sugarlang role" dropdown

A new dropdown on the NPC definition inspector (shown only when the sugarlang plugin is installed) with options `None` / `Placement`. Setting it to `Placement` writes `metadata.sugarlangRole = "placement"` onto the NPC definition. This is the UI affordance for the tag mechanism described in the Proposal 001 Placement Interaction Contract.

Lives under a new `design.section` plugin contribution in the sugarlang plugin, injected into the NPC inspector workspace.

### 2. Quest node editor: prefilled `eventName` autocomplete

When authoring an `"objective"` quest node, the `eventName` field should offer an autocomplete suggestion for `sugarlang.placement.completed` when the target NPC has `sugarlangRole: "placement"`. This is purely a convenience affordance so the author doesn't have to remember the magic string.

Lives on the sugarlang side as a contribution to the quest authoring workspace (via the existing `design.section` contribution kind).

### 3. Placement questionnaire viewer (read-only)

A dedicated editor view for the `placement-questionnaire.json` file — shown only when the project targets a supported language. **Read-only in v1.** The view shows the shipped questionnaire with each question's CEFR band, kind (multiple-choice / free-text / yes-no / fill-in-blank), and expected answers, so authors can see what the questionnaire contains without opening JSON. Per-NPC override and editing are v1.1 features.

This viewer exists primarily so Wordlark Hollow's writers can see what questions Orrin will be "handing over" so they can calibrate the dialog wrapper's tone — if the questionnaire asks the player to describe their journey, Orrin's opening line can anticipate that by mentioning the journey.

Lives as a `design.workspace` or `design.section` contribution.

### 4. Scene lexicon density histogram (reused from Proposal 001)

Not specific to this plan but relevant: the design-workspace density histogram from Proposal 001 § Scene Lexicon Compilation surfaces "this scene has 40% C1-band lemmas, consider simplifying" warnings. The Wordlark Hollow arrival scene — the physical platform where Orrin greets the player — should be checked against this histogram at authoring time to catch any mismatched difficulty in the surrounding dialogue or lore.

## Prerequisites (What Must Exist Before This Plan Can Ship)

Ordered from smallest to largest:

1. **`NPCDefinition.metadata?: Record<string, unknown>` field** added to `packages/domain/src/npc-definition/index.ts`, with normalization, serialization, and a passthrough from the conversation host into `ConversationSelectionContext.metadata`. This is the one domain-model change this plan requires. Small: ~30 lines plus a test. **Prerequisite for Proposal 001 implementation too — sugarlang's placement contract needs this regardless of whose NPC the Station Manager is.**
2. **Sugarlang plugin v1 shipped** per Proposal 001, specifically including Epic 11 (Cold Start and Placement Capability) with its questionnaire UI primitive, deterministic scoring engine, and flow orchestrator. The Director is NOT involved in placement — the plugin ships a questionnaire and a scoring function, not a calibration-mode prompt pathway.
3. **Placement question banks** authored for ES and IT (~15 questions each, character-voiced for Orrin or a generic placement voice — per-NPC voice overrides are a v2 feature).
4. **`NPCDefinition` editor UI extension** per the "Sugarlang role dropdown" ticket above.
5. **Lore page** for the Station Manager authored by the project (3–5 paragraphs, used by SugarAgent retrieval).

## Implementation Tickets

In suggested sequencing order.

| # | Ticket | Scope | Depends on |
|---|---|---|---|
| 1 | Add `metadata` field to `NPCDefinition` | Domain model | — |
| 2 | Propagate NPC metadata into `ConversationSelectionContext.metadata` | Conversation host | 1 |
| 3 | Sugarlang `SugarLangContextMiddleware` placement-mode branch | Sugarlang plugin | Proposal 001 v1 base, 2 |
| 4 | Sugarlang placement question bank loader | Sugarlang plugin data layer | Proposal 001 v1 base |
| 5 | ~~Sugarlang Director calibration-mode prompt variant~~ — **REPLACED** by Epic 11 stories 11.1–11.3 (scoring engine, questionnaire UI, flow orchestrator) | Sugarlang plugin placement | Epic 11 |
| 6 | Sugarlang `SUGARLANG_PLACEMENT_STATUS_FACT` blackboard fact + reducer | Sugarlang plugin learner layer | Proposal 001 v1 base |
| 7 | Sugarlang → QuestManager integration (setFlag + notifyEvent on placement completion) | Sugarlang plugin quest adapter | 6 |
| 8 | Author Station Manager NPC card (Orrin Lark, lore page, presentation profile) | Project content | 1 |
| 9 | Author Welcome to Wordlark Hollow quest definition | Project content | 8 |
| 10 | Author Wordlark Hollow arrival scene content (platform, station props, Orrin placement) | Project content | — |
| 11 | Author placement question bank for ES + IT (~30 questions total, character-voiced) | Sugarlang plugin data | — |
| 12 | Editor UI: "Sugarlang role" dropdown on NPC inspector | Studio + sugarlang shell contribution | 1 |
| 13 | Editor UI: `eventName` autocomplete hint in quest node editor for placement completion | Studio + sugarlang shell contribution | 7 |
| 14 | Editor UI: Placement question bank read-only viewer | Studio + sugarlang shell contribution | 11 |
| 15 | End-to-end smoke test: boot into a fresh profile, walk to Orrin, complete placement, verify quest advances | Test | 1–13 |

Tickets 1, 2, 6, 7, and 15 are strictly on sugarlang's critical path. Tickets 8, 9, 10 are content work that can happen in parallel by the project author. Tickets 12, 13, 14 are studio UX polish that can ship after v1 if needed.

## Acceptance Criteria

1. **Boot path works.** Starting a new player profile drops the player into the Wordlark Hollow arrival scene. Orrin is on the platform. The quest "Welcome to Wordlark Hollow" is active with objective "Meet the Stationmaster" visible in the HUD.
2. **Placement converges.** A B1-ish synthetic test learner (simulated inputs with roughly correct A1/A2 responses and stumbling B1) completes placement in ≤10 Orrin turns with `cefrConfidence > 0.65`. An A1-ish synthetic learner completes in ≤8 turns at confidence > 0.70.
3. **Quest advances.** When the placement posterior sharpens, Stage 1 of the quest closes via the `sugarlang.placement.completed` event, Stage 2 activates, and the HUD updates.
4. **Learner state persists.** After placement, `LEARNER_PROFILE_FACT` contains a CEFR estimate and seeded FSRS cards for every lemma encountered during the placement conversation. Reloading the save preserves all of it.
5. **Replay inertness.** Starting a fresh conversation with Orrin after placement does NOT re-run the questionnaire — sugarlang observes `PLACEMENT_STATUS_FACT.status === "completed"` and treats him as a normal `agent` NPC. Orrin responds in character about station life, weather, gossip, his nineteen years of manifest-keeping, etc. No questionnaire UI appears.
6. **No sugarlang imports from content.** The Station Manager NPC card, the quest definition, and the region content all reference sugarlang only via the magic strings (`"placement"`, `"sugarlang.placement.completed"`, `"sugarlang.placement.status"`). No TypeScript imports from the sugarlang plugin package cross into project content.
7. **Character voice passes review.** A reviewer unfamiliar with sugarlang's CEFR mechanics reads the 16-turn transcript (or plays it live) and reports the experience as "warm, naturalistic, felt like meeting a person" — not "I felt assessed."
8. **Works identically in Preview and Published.** The same Orrin, the same quest, the same question bank, the same compiled scene lexicon. No editor-only variation.

## v1 Scope Boundaries

This plan assumes the Epic 11 v1 placement contract exactly as shipped.

### In scope

- One plugin-shipped questionnaire per supported language
- Placement activation through `metadata.sugarlangRole = "placement"`
- Opening-dialog -> questionnaire -> closing-dialog flow
- Deterministic scoring with CEFR estimate and confidence
- FSRS seeding from correct free-text answers
- Replay inertness after completion
- Quest completion through `sugarlang.placement.completed`
- Global placement disable through plugin config

### Out of scope

- Per-NPC questionnaire overrides
- Per-project questionnaire editing
- Re-placement after first completion
- Adaptive branching question selection
- Multi-session partial-form persistence
- Audio or image-based question types
- Per-learner customized forms
- Partial-credit scoring

## Open Questions

- **Per-NPC placement question overrides.** Can a project override the shipped question bank with NPC-specific lines without forking the plugin's data file? Probably yes via a future NPCDefinition `metadata.sugarlangPlacementQuestionOverrideId` pointer. Out of scope for v1; v1 uses the shipped plugin-level bank for all placement NPCs regardless of character.
- **Non-Orrin placement NPCs in the same project.** If the player's save file gets reset and they're now in a different region of the same game, can placement run with a *different* NPC (say, a librarian in a different town)? The contract says yes — any NPC tagged `sugarlangRole: "placement"` qualifies. But in a single game, only one placement NPC should ever fire. This is an authoring rule (don't tag two NPCs as placement in the same project), not a runtime enforcement. Worth flagging in the editor as a lint rule eventually.
- **Orrin in other languages.** This plan is written for ES and IT. When the game adds French or German in a future release, Orrin's question bank needs new language entries. This is content work, not a plan change.
- **What happens if the player refuses to engage with Orrin?** They can walk past him on the platform. The quest objective is `autoStart: true` but the conversation is not *forced*. If the player never talks to Orrin, placement never runs and sugarlang falls back to CEFRLex priors with the default A1 assumption. This is acceptable degradation — the player who refuses to talk to NPCs is already opting out of the game's core loop.
- **Character rename.** "Orrin Lark" is a working name. The project may rename him. This plan doesn't care — nothing in the sugarlang contract references his name, and his in-world dialogue uses whichever name is on the NPC definition.

## Verification and Rollout

Ship order:

1. Prereqs 1 and 2 (domain-model metadata field + conversation host passthrough) land in a small domain PR and get test coverage. This unblocks both this plan and the sugarlang plugin v1 itself.
2. Sugarlang plugin v1 base ships per Proposal 001, including the placement-mode branch in `SugarLangContextMiddleware` and the quest integration.
3. Station Manager NPC card, lore page, and placement question bank ship together as a content PR. Authored in the studio using the new "Sugarlang role" dropdown.
4. Welcome to Wordlark Hollow quest ships in the same content PR.
5. End-to-end smoke test is added to the testing package; CI validates it on every build.
6. Manual playtest: a reviewer who has never seen the architecture plays from a fresh profile and reports character voice and wall-time. Tune Orrin's dialog wrapper lines (the plugin-shipped questionnaire itself is out of scope for Wordlark Hollow content work) based on feedback.

The whole experience is a thin layer on top of the architecture. Most of the work is content authoring and character voice, not engineering. The engineering is bounded to the prerequisite domain-model field, the middleware branch, and the quest integration — all of which are already scoped in Proposal 001.
