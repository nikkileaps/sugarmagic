# Sugarlang Domain Model — after Epic 090

Status: PROPOSED. Nothing here is built.
Source: `docs/plans/090-concept-opportunity-scanner-epic.md` (restructured 2026-07-28, epic-review 3 rounds, NOT locked)
Companion: [`domain-model.md`](./domain-model.md) — the model as it exists today

Same domain, same reading convention (*the Teacher decides a Directive*). This
one shows what Epic 090 proposes to add and change.

The headline: **the Teacher gains a `SITUATION` to read.** Everything else is
either what produces that Situation, or what changes downstream once the Teacher
is making a real judgment instead of consuming a pre-sliced list.

---

## What is new

```mermaid
erDiagram
    AUTHORED_CONTENT ||--o{ CONTEXT_SOURCE : "projects into"
    RUNTIME_FACTS ||--o{ CONTEXT_SOURCE : "projects into"
    CONTEXT_EXTRACTOR ||--o{ SITUATION : "extracts"
    CONTEXT_SOURCE ||--o{ SITUATION : "feeds"

    SITUATION ||--|| PROSE_DESCRIPTION : "describes itself as"
    SITUATION ||--o{ CONCEPT : "names"
    CONCEPT ||--|| PROVENANCE : "points back through"
    CONCEPT }o--o| LEMMA : "resolves to"
    LEXICAL_ATLAS ||--o{ CONCEPT : "is the bridge for"

    CONCEPT_LEMMA ||--o{ SCENE_LEXICON : "is projected into"
    CONCEPT ||--|| CONCEPT_LEMMA : "becomes"

    SITUATION ||--o{ TEACHER : "is judged by (the new edge)"
    SITUATION ||--|| SITUATION_KEY : "is fingerprinted by"
    SITUATION_KEY ||--o{ DIRECTIVE : "invalidates"
```

| New entity | Domain meaning |
|---|---|
| `CONTEXT_EXTRACTOR` | One lifecycle-agnostic module. Given sources, extracts a Situation. Does not know whether it is called at compile or at runtime. |
| `CONTEXT_SOURCE` | What it reads. Authored content projects in; live facts project in. Same interface. |
| `SITUATION` | What is going on here: prose description + a list of concepts, each with provenance. |
| `CONCEPT` | An English word plus its part of speech. Support-language, never target-language. |
| `PROVENANCE` | Which authored source a concept came from. |
| `CONCEPT_LEMMA` | A concept resolved to a target lemma through the atlas, stored in a side field and projected into the scene lexicon at read. |
| `SITUATION_KEY` | A fingerprint over (scene, present NPCs, quest stage, time band). Changes invalidate the cached Directive. |

---

## The Teacher, after 090

The Teacher has **two primary inputs**: a `SITUATION` and a `LEARNER`. Nothing
else is handed to it directly. Everything the old model passed in piecemeal —
who is speaking, what this scene contains, which lemmas the quest needs — is a
CONTEXT SOURCE, and it is the ContextExtractor's job to turn those into a
Situation.

```mermaid
erDiagram
    NPC ||--o{ CONTEXT_SOURCE : "is"
    SCENE ||--o{ CONTEXT_SOURCE : "is"
    QUEST ||--o{ CONTEXT_SOURCE : "is"
    ITEM ||--o{ CONTEXT_SOURCE : "is"
    LORE ||--o{ CONTEXT_SOURCE : "is"
    RUNTIME_FACTS ||--o{ CONTEXT_SOURCE : "is"

    CONTEXT_EXTRACTOR ||--o{ SITUATION : "extracts"
    CONTEXT_SOURCE ||--o{ CONTEXT_EXTRACTOR : "is read by"

    SITUATION ||--o{ TEACHER : "is judged by"
    LEARNER ||--o{ TEACHER : "is judged by"

    TEACHER ||--o{ DIRECTIVE : "decides"
    TEACHER ||--o{ LADDER_RUNG : "chooses"
    LADDER_RUNG }o--|| LEMMA : "acts on"
    TEACHER }o--o{ BUDGETER : "consults"

    DIRECTIVE ||--|| POSTURE : "sets"
    DIRECTIVE ||--o{ LADDER_RUNG : "carries"
    DIRECTIVE ||--o| COMPREHENSION_CHECK : "may fire"
    DIRECTIVE ||--|| CONSTRAINT : "is merged into"

    SITUATION ||--|| SITUATION_KEY : "is fingerprinted by"
    SITUATION_KEY ||--|| DIRECTIVE_CACHE : "keys"
    DIRECTIVE_CACHE ||--o{ DIRECTIVE : "reuses until the key moves"
```

### The two inputs are facades

Both are composites. That is the point — the Teacher should not be handed seven
things when two will do.

| Input | Composed of |
|---|---|
| `SITUATION` | prose description, concepts (+ provenance), who is present, what this place is, quest stage, time of day, what has been said so far |
| `LEARNER` | band, lemma cards, encounter debts, comprehension rate, fatigue, probe-floor state |

### The one relationship that matters

`SITUATION ||--o{ TEACHER` is the whole epic. Today the Teacher gets an NPC name
and the last few turns; it cannot see what this place *is*, who else is present,
or what a character is *about*. Routing those through the extractor is what lets
a cheese-obsessed NPC teach `queso` instead of quest vocabulary.

### What the Budgeter is, in this picture

A **tool**, not an input. The Teacher consults it for facts — what is in band,
what is due, what is too hard, what the quest cannot proceed without. It reads
the raw `SCENE_LEXICON` directly to compute those, because eligibility is
arithmetic over the lexicon and does not route through the extractor.

So the accurate rule is not "the extractor is the only thing that reads
sources". It is:

> The ContextExtractor is the only producer of **context for the Teacher**.
> Other machinery still reads raw content to compute **facts**.

That keeps the Teacher's inputs to two without pretending the Budgeter reads the
world through a straw.

### Facts versus judgment

The Budgeter answers the Teacher in two registers, and they behave differently:

| What it supplies | Binding? | Meaning |
|---|---|---|
| **Filters** | **Binding** | Band envelope, `avoid`, quest-essential exclusions, effective budget. The Teacher may not violate these, and a separate enforcer checks the returned Directive against them. |
| **Ranking** | **Advisory** | `introduce` stops being "the answer" and becomes "the default recommendation" — the Teacher may prefer a lower-scored candidate when the situation justifies it. |

That distinction is the point. The scoring function cannot see that the learner
is standing in front of a cheesemonger; the Teacher can.

Note this is *why* the Budgeter is a tool rather than an input. An input would
imply the Teacher simply receives a slate and renders it — which is exactly the
behaviour 090 is trying to end.

### Quest-essential vocabulary, specifically

It appears twice, deliberately, and the two are not the same thing:

- **as context** — quest stage and objectives are a CONTEXT_SOURCE, so the
  Situation carries what the quest is currently about and the Teacher can reason
  with it.
- **as a filter** — "do not let a quest-essential lemma leak into `targetVocab`,
  and force glossing when one is present" stays a binding rule enforced against
  the returned Directive.

Judgment about relevance is the Teacher's; enforcement of the obligation is not.

---

## What changes about existing concepts

| Concept | Change |
|---|---|
| `SCENE_LEXICON` | Gains `conceptLemmas` as a side field, **projected into** `lemmas` at read time. Both are required: storing inside `lemmas` breaks content-hash determinism, but a side field alone never reaches the Budgeter, which only iterates `lemmas`. |
| `DIRECTIVE_CACHE` | Gains a `SITUATION_KEY` digest. Today it invalidates *everything* on any quest or location event, comparing nothing — 090 makes invalidation situation-aware. Precedence against the existing turn-count expiry has to be stated. |
| `TEACHER` vs `SCHEDULE` | The default flips. LLM judgment on situation change becomes primary; the deterministic schedule path becomes the fallback for gateway-down, unchanged situation, or strain-suppressed. This deliberately reverses 087.6. |
| `TEACH_REASON` / `PROBE_TRIGGER_REASON` | Both are closed unions today and must widen — "reinforce ahead of due" and "probe this now" are not currently expressible. |
| `PRESCRIPTION` budget | Becomes an *effective* cap: opening band cap, plus a depth ramp over conversation turns, minus a function-chunk reserve, clamped by strain. |
| `TEACHABLE` slots | Gain rotation. A word prescribed repeatedly but never graded yields its slot, so a full `introduce` list can turn over at all. |

---

## Where the Situation comes from

The Extractor is a **sibling of the compiler, not a dependency of it** — both
consume the same `SceneAuthoringContext`, neither calls the other.

```mermaid
erDiagram
    SCENE_AUTHORING_CONTEXT ||--o{ SCENE_LEXICON : "compiles into (pure, sync)"
    SCENE_AUTHORING_CONTEXT ||--o{ CHUNK : "extracts into (async)"
    SCENE_AUTHORING_CONTEXT ||--o{ LINE_INTENT : "extracts into (async)"
    SCENE_AUTHORING_CONTEXT ||--o{ SITUATION : "extracts into (async, NEW)"

    SITUATION ||--o| RUNTIME_OVERLAY : "is thickened by"
    RUNTIME_OVERLAY ||--|| MET_UNMET : "adds"
    RUNTIME_OVERLAY ||--|| QUEST_STAGE : "adds"
    RUNTIME_OVERLAY ||--|| TIME_OF_DAY : "adds"
```

Most of a Situation is compile-derivable — who is placed where, what the place
is, what characters are about. Only met/unmet, quest stage and time of day are
runtime, and all three are cheap deterministic reads. **The dynamic layer is a
thin film over a rich static model.**

---

## Invariants this model must preserve

- **Authors write English.** No authored surface ever requires a target-language
  word. Concepts are English; the atlas is the bridge; a concept that resolves
  to nothing is dropped with telemetry, never invented.
- **One extractor owns context mining**, and it is lifecycle-agnostic. Where it
  is called from is the caller's concern and must not leak into its API.
- **The lexical scrub is not replaced.** Extraction *adds*. Where both find the
  same lemma the projection must merge — union the NPC sources, keep the greater
  weight, retain both provenances. Last-write-wins silently costs the NPC
  affinity boost, which is the exact mechanism that ranks cheese above quest
  words.
- **Facts stay deterministic, judgment stays with the model.** Never ask the
  Teacher to infer something the Budgeter already computed; never let it
  override a filter.

---

## Caveats

This is a proposal, and the epic did **not** converge after three review rounds.
Six decisions are open (see "Open at gate exit" in the plan), and two of them
would change this diagram:

- Whether the Teacher LLM gets its own gateway `purpose` — today it silently
  runs on the cheap dialogue model, which undercuts the whole "the Teacher
  decides" premise.
- Which signal is authoritative for "have they met" — there are already two
  answers that disagree.

Treat the edges above as intent, not as settled contract.
