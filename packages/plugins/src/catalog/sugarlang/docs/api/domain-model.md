# Sugarlang Domain Model

Status: active
Last verified against code: 2026-07-28

The sugarlang plugin at the DOMAIN level -- the concepts the teaching model is
written in, and who produces what. Deliberately not a class or module diagram:
several of these entities are produced by more than one module, and a few
modules produce nothing that belongs here at all.

Read the relationship labels as sentences: *the Teacher decides a Directive*,
*the Budgeter prescribes a Prescription*.

---

## The whole model

```mermaid
erDiagram
    LEARNER ||--o{ LEMMA_CARD : "holds"
    LEARNER ||--o{ ENCOUNTER_DEBT : "owes"
    LEARNER ||--o| SESSION : "is in"

    LEXICAL_ATLAS ||--o{ LEMMA : "catalogues"
    LEMMA_CARD }o--|| LEMMA : "tracks"

    AUTHORED_CONTENT ||--o{ SCENE_LEXICON : "compiles into"
    SCENE_LEXICON ||--o{ LEMMA : "surfaces"
    SCENE_LEXICON ||--o{ QUEST_ESSENTIAL_LEMMA : "marks"
    FUNCTION_INVENTORY ||--o{ FUNCTION : "catalogues"
    FUNCTION ||--o{ CHUNK : "is realized by"

    BUDGETER ||--o{ PRESCRIPTION : "prescribes"
    LEARNER ||--o{ PRESCRIPTION : "is prescribed for"
    SCENE_LEXICON ||--o{ PRESCRIPTION : "supplies candidates to"
    PRESCRIPTION ||--o{ LEMMA : "introduces, reinforces, avoids"
    PRESCRIPTION ||--|| RATIONALE : "explains itself with"

    SCHEDULER ||--o{ SCHEDULE : "paces"
    BOARD_VIEW ||--|| SCHEDULE : "is computed into"
    LEARNER ||--o{ BOARD_VIEW : "is summarised on"
    SCENE_LEXICON ||--o{ BOARD_VIEW : "is summarised on"
    FUNCTION_INVENTORY ||--o{ BOARD_VIEW : "is summarised on"
    SCHEDULE ||--o{ TEACHABLE : "orders"

    TEACHER ||--o{ DIRECTIVE : "decides"
    LEARNER ||--o{ DIRECTIVE : "is taught by"
    PRESCRIPTION ||--o{ DIRECTIVE : "constrains"
    SCENE_LEXICON ||--o{ DIRECTIVE : "informs"
    NPC ||--o{ DIRECTIVE : "colours"
    DIRECTIVE ||--o| COMPREHENSION_CHECK : "may fire"
    DIRECTIVE ||--|| POSTURE : "sets"
    DIRECTIVE ||--o{ LEMMA : "targets"

    DIRECTIVE ||--|| CONSTRAINT : "is merged into"
    CONSTRAINT ||--o{ TURN : "shapes"
    NPC ||--o{ TURN : "speaks"
    TURN ||--o{ OBSERVATION : "yields"

    GRADED_TEXT ||--o{ TURN : "may replace"
    AUTHORED_CONTENT ||--o{ GRADED_TEXT : "is adapted into"
    POSTURE ||--o{ GRADED_TEXT : "decides the form of"

    OBSERVATION }o--|| LEMMA : "is about"
    OBSERVATION ||--o{ LEMMA_CARD : "updates"
    OBSERVATION ||--o{ ENCOUNTER_DEBT : "settles"
    VERIFIER ||--o{ TURN : "checks"
```

---

## The Teacher, specifically

The Teacher is the decision-maker. Everything below it is either an input it
reads or an output it is responsible for.

```mermaid
erDiagram
    LEARNER ||--o{ DIRECTIVE : "is taught by"
    PRESCRIPTION ||--o{ DIRECTIVE : "constrains"
    SCENE_LEXICON ||--o{ DIRECTIVE : "informs"
    NPC ||--o{ DIRECTIVE : "colours"
    RECENT_TURNS ||--o{ DIRECTIVE : "give context to"
    PROBE_FLOOR ||--o{ DIRECTIVE : "forces a check on"
    QUEST_ESSENTIAL_LEMMA ||--o{ DIRECTIVE : "obliges"

    TEACHER ||--o{ DIRECTIVE : "decides"
    TEACHER ||--o| SITUATION : "SHOULD read (missing -- Plan 090)"

    DIRECTIVE ||--|| POSTURE : "sets"
    DIRECTIVE ||--|| GLOSSING : "sets"
    DIRECTIVE ||--|| COMPLEXITY_CAP : "sets"
    DIRECTIVE ||--o{ LEMMA : "targets"
    DIRECTIVE ||--o| COMPREHENSION_CHECK : "may fire"
    DIRECTIVE ||--|| LIFETIME : "expires by"

    DIRECTIVE_CACHE ||--o{ DIRECTIVE : "reuses"
    DIRECTIVE ||--|| CONSTRAINT : "is merged into"
```

### What the Teacher reads

| Input | Domain meaning |
|---|---|
| `LEARNER` | Who this is: band, cards, confidence, fatigue |
| `PRESCRIPTION` | What the Budgeter says is teachable here, ranked |
| `SCENE_LEXICON` | What vocabulary this scene contains at all |
| `NPC` | Who is speaking |
| `RECENT_TURNS` | What has just been said |
| `PROBE_FLOOR` | Whether a comprehension check is overdue |
| `QUEST_ESSENTIAL_LEMMA` | Words the quest cannot proceed without |

### What the Teacher decides

One `DIRECTIVE` per decision, carrying posture, interaction style, glossing
strategy, sentence-complexity cap, target vocabulary, an optional comprehension
check, and a lifetime. The Directive is then merged into a `CONSTRAINT`, which
is what actually reaches the generator.

---

## Three things worth knowing

**1. The Teacher and the Scheduler are alternatives, not a pipeline.**
`SCHEDULE` and `DIRECTIVE` both answer "what should this turn teach". The
scheduler-driven path deliberately bypasses the Teacher for cost and
determinism; the Teacher path calls a model. They meet at `CONSTRAINT`.

**2. The Teacher is runtime-only, and that is forced.**
Its question is "what is worth teaching THIS learner right now". At compile time
there is no learner -- graded text is produced per BAND, not per person. So
`GRADED_TEXT` has no edge to `TEACHER`: it is the *rendering* half, precomputed
where precomputation is possible.

**3. `SITUATION` does not exist yet.**
The Teacher can see who is speaking and what was just said, but not what this
place *is*, who else is present, or what the moment is about. That missing
entity is the whole subject of Plan 090, and it is why a cheese-obsessed NPC
teaches quest vocabulary instead of `queso` -- nothing in the model above can
express "this character is about cheese" unless an author wrote the literal
word.

---

## Where these live

| Domain concept | Contract |
|---|---|
| `LEARNER`, `LEMMA_CARD`, `SESSION` | `contracts/learner-profile.ts` |
| `LEMMA`, `LEXICAL_ATLAS` | `contracts/providers.ts`, atlas data |
| `SCENE_LEXICON`, `QUEST_ESSENTIAL_LEMMA` | `contracts/scene-lexicon.ts` |
| `FUNCTION`, `CHUNK`, `FUNCTION_INVENTORY` | `contracts/function-inventory.ts` |
| `PRESCRIPTION`, `RATIONALE` | `contracts/lexical-prescription.ts` |
| `SCHEDULE`, `TEACHABLE` | `scheduler/teach-schedule.ts` |
| `BOARD_VIEW` | `scheduler/scheduler-board-view.ts` |
| `DIRECTIVE`, `POSTURE`, `GLOSSING`, `COMPREHENSION_CHECK`, `CONSTRAINT` | `contracts/pedagogy.ts` |
| `OBSERVATION` | `contracts/observation.ts` |
| `ENCOUNTER_DEBT` | `learner/encounter-debt-ledger.ts` |
| `GRADED_TEXT` | `contracts/graded-text.ts` |
| `TEACHER` | `teacher/sugar-lang-teacher.ts` |
| `BUDGETER` | `budgeter/lexical-budgeter.ts` |
| `SCHEDULER` | `scheduler/outer-loop-scheduler.ts` |
