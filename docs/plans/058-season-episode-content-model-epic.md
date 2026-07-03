# Plan 058 — Season / Episode content model + progress persistence

Status: placeholder / not yet designed
Owner: nikki + claude
Date: 2026-07-01

Related: Plan 055 (SaveParticipant model — the persistence mechanism this plan will plug into). Downstream users: quest authoring, dialogue authoring, world/region authoring, content release / gating.

## Framing (from 2026-07-01 discussion)

The game is structured as **Seasons**, each containing ~6 **Episodes**. Episodes are chunks of authored content that unlock and release sequentially over calendar time — not all at once. Narrative content (quests, dialogues, story-facing characters) is scoped by Season -> Episode. But shared assets and definitional libraries (art, audio, mechanical vocab, standing-cast NPC definitions) are NOT episode-scoped — they're pulled from a common catalog.

**Regions are sets, not narrative units.** A given region (Town Square, Cave, Player House) may appear in Ep 1, Ep 3, and Ep 5, with different casts, quests, and ambient dialogue layered on top each time. Regions live in the shared library; episodes cast them.

TV precedent: episodes are narrative beats, standing sets get reused, wardrobe/prop catalog is drawn from a shared library.

## Goal

After this epic:

- Content authors can create Episodes and slot them into Seasons in a well-defined way, without cloning shared regions or standing-cast characters.
- Runtime knows which content is currently unlocked for the player and gates loading/visibility accordingly.
- Player progression (which episode they're on, which they've completed) persists across sessions via a `SaveParticipant` (per Plan 055).
- Additive-only content contract: shipping Ep N doesn't break saves from mid-Ep (N-1).

## Central design tensions

### 1. Composition, not scoping

Regions/dialogues/NPCs need to be *composed* onto by an episode, not owned by one. If Region X is used in Ep 1, 3, and 5, each episode adds/replaces the cast, active quests, and ambient dialogue *in that region* without cloning the region. Additive-layer model rather than nested namespaces.

Concrete: an Episode is likely a bundle of *presence definitions*, *quest definitions*, *dialogue definitions* that reference existing library entries (regions, NPC definitions) by id. The runtime composes them onto the shared world when the episode is active.

### 2. Unlock / release mechanics

Two viable models, cascading tradeoffs:

- **Bake-everything, gate at runtime.** All episode content ships in the deployed bundle; the game refuses to surface content whose episode isn't yet unlocked for the player. Simpler distribution, requires runtime gating logic everywhere content is loaded. Risk: leakage (savvy players can peek at unreleased content).
- **Load-per-episode.** Only the episodes currently unlocked are loaded / fetched. Cleaner separation but complicates content addressing, save-load-time, and rollback.

Pick one before authoring tools start expanding.

### 3. Save safety across content deploys

If Ep 3 ships while a player is mid-Ep 2, their save must not break. Implies an **additive-only content contract**: existing content definition IDs cannot be renamed or deleted, only added to. Renames become deprecations with content-layer aliases. This is a rule for both engine internals and content-authoring UX (Studio should refuse destructive edits on shipped content).

### 4. Cross-episode presence state (link to Plan 055)

Plan 055's `world.presence` slice is currently episode-agnostic (`Record<regionId, string[]>`). If a future episode needs to un-collect a presence in a shared region to re-story it, this needs an episode dimension. See Plan 055 open-question. Decision goes here, back-migrates 055.

### 5. What persists in the save

At minimum, a new `campaign.progression` SaveParticipant carrying:

- `currentSeasonId`, `currentEpisodeId`
- `completedEpisodeIds`
- Possibly per-episode chapter markers, if quests-within-an-episode need finer-grained "you've read past this beat" tracking beyond what `quest.manager` already gives us

Everything else stays where it is per 055's participant model.

## Not yet decided

- Do "Seasons" carry mechanical state, or are they purely a grouping for release cadence?
- How do episodes end / transition? (Cutscene? Auto-advance on quest completion? Player-triggered "next episode" call?)
- Authoring-side: does Studio get a first-class Episode workspace, or do episodes appear as a facet on existing workspaces (quest / dialogue / world)?
- Content-library separation: is there a hard boundary between "library asset" (region, standing NPC def) and "episode content" (presences, quests, ambient dialogue), or is everything in one project with episode metadata tagging what belongs where?
- Does unlock respect a wall-clock schedule (Ep 2 unlocks 2026-09-15) or a player-controlled marker (Ep 2 unlocks when you finish Ep 1's finale)?

## Prerequisites

- Plan 055 shipped and stable. This plan's `campaign.progression` participant depends on the participant infrastructure landing first.
- At least one authored Episode as a test bed. Ideally the v1 sandbox nikki is building doubles as "Season 1, Episode 1" so the model has a concrete first customer.

## Defers

- Multi-season release scheduling / calendar UI.
- Per-episode achievements / metrics rollup (adjacent to Plan 020 telemetry).
- Content-side i18n / localization scoping by episode.
